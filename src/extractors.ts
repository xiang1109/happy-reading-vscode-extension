import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import AdmZip from 'adm-zip';
import * as cheerio from 'cheerio';
import * as iconv from 'iconv-lite';

export const supportedExtensions = new Set(['.txt', '.epub', '.pdf', '.mobi', '.azw3']);

export function isSupportedBook(filePath: string): boolean {
  return supportedExtensions.has(path.extname(filePath).toLowerCase());
}

export async function readEbook(filePath: string): Promise<string> {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case '.txt':
      return readTextFile(filePath);
    case '.epub':
      return readEpub(filePath);
    case '.pdf':
      return readPdf(filePath);
    case '.mobi':
    case '.azw3':
      return readMobi(filePath);
    default:
      throw new Error(`不支持的文件格式：${extension || '未知'}`);
  }
}

async function readTextFile(filePath: string): Promise<string> {
  const bytes = await fs.readFile(filePath);
  if (hasUtf8Bom(bytes)) {
    return bytes.subarray(3).toString('utf8');
  }
  if (isValidUtf8(bytes)) {
    return bytes.toString('utf8');
  }
  return iconv.decode(bytes, 'gb18030');
}

async function readEpub(filePath: string): Promise<string> {
  const zip = new AdmZip(filePath);
  const entries = zip.getEntries()
    .filter(entry => !entry.isDirectory && /\.(?:x?html?)$/i.test(entry.entryName))
    .sort((left, right) => left.entryName.localeCompare(right.entryName));

  return entries
    .map(entry => htmlToText(decodeHtml(entry.getData())))
    .filter(text => text.trim().length > 0)
    .join('\n');
}

async function readPdf(filePath: string): Promise<string> {
  // pdf-parse 的包入口包含“直接运行时读取测试 PDF”的调试代码；打包后
  // module.parent 会失真并误读 test/data/05-versions-space.pdf。
  // 直接引用正式解析模块可避免触发该调试分支。
  const pdfParse = require('pdf-parse/lib/pdf-parse.js') as (bytes: Buffer) => Promise<{ text: string }>;
  const result = await pdfParse(await fs.readFile(filePath));
  return result.text;
}

export function htmlToText(html: string): string {
  const $ = cheerio.load(html, { xmlMode: false });
  $('script,style,noscript,svg').remove();
  $('br').replaceWith('\n');
  $('p,div,section,article,li,h1,h2,h3,h4,h5,h6,blockquote').each((_, element) => {
    $(element).prepend('\n').append('\n');
  });
  return $.root().text()
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function readMobi(filePath: string): Promise<string> {
  try {
    return readMobiBuffer(await fs.readFile(filePath));
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/加密/.test(message)) {
      throw new Error(`${path.basename(filePath)}：解析失败，文件可能加密`);
    }
    throw new Error(`${path.basename(filePath)}：${message || '文件加密或格式不受支持，无法打开'}`);
  }
}

export function readMobiBuffer(bytes: Buffer): string {
  const palmHeaderSize = 78;
  if (bytes.length < palmHeaderSize) {
    throw new Error('文件不是有效的 MOBI/AZW3');
  }

  const recordCount = readUInt16(bytes, 76);
  if (recordCount < 2) {
    throw new Error('MOBI/AZW3 中没有可读取的正文记录');
  }
  const offsets = readRecordOffsets(bytes, recordCount);
  const header = record(bytes, offsets, 0);
  if (header.length < 16) {
    throw new Error('MOBI/AZW3 的 PalmDOC 头损坏');
  }

  const compression = readUInt16(header, 0);
  const textLength = Math.min(readUInt32(header, 4), 0x7fff_ffff);
  const textRecordCount = Math.min(readUInt16(header, 8), recordCount - 1);
  const encryption = readUInt16(header, 12);
  if (encryption !== 0) {
    throw new Error('文件被加密无法打开');
  }
  if (compression === 17_480) {
    throw new Error('该 MOBI/AZW3 使用 HUFF/CDIC 压缩，当前版本暂不支持');
  }
  if (compression !== 1 && compression !== 2) {
    throw new Error(`不支持的 MOBI/AZW3 压缩方式：${compression}`);
  }

  const output: number[] = [];
  for (let index = 1; index <= textRecordCount && output.length < textLength; index += 1) {
    const source = record(bytes, offsets, index);
    const decoded = compression === 2 ? decompressPalmDoc(source) : source;
    const remaining = textLength - output.length;
    output.push(...decoded.subarray(0, remaining));
  }

  const textBytes = Buffer.from(output);
  const encoding = mobiEncoding(header);
  const rawText = iconv.decode(textBytes, encoding);
  const cleaned = htmlToText(rawText);
  return cleaned.trim() || rawText.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').trim();
}

export function decompressPalmDoc(source: Uint8Array): Buffer {
  const output: number[] = [];
  let index = 0;
  while (index < source.length) {
    const current = source[index++];
    if (current === 0) {
      output.push(0);
    } else if (current >= 1 && current <= 8) {
      if (index + current > source.length) {
        throw new Error('文件被加密无法打开');
      }
      for (let count = 0; count < current; count += 1) {
        output.push(source[index++]);
      }
    } else if (current >= 9 && current <= 0x7f) {
      output.push(current);
    } else if (current >= 0x80 && current <= 0xbf) {
      if (index >= source.length) {
        throw new Error('文件被加密无法打开');
      }
      const pair = (current << 8) | source[index++];
      const distance = (pair & 0x3fff) >>> 3;
      const length = (pair & 0x07) + 3;
      if (distance < 1 || distance > output.length) {
        throw new Error('文件被加密无法打开');
      }
      for (let count = 0; count < length; count += 1) {
        output.push(output[output.length - distance]);
      }
    } else {
      output.push(0x20, current ^ 0x80);
    }
  }
  return Buffer.from(output);
}

function readRecordOffsets(bytes: Buffer, recordCount: number): number[] {
  const tableEnd = 78 + recordCount * 8;
  if (tableEnd > bytes.length) {
    throw new Error('MOBI/AZW3 的记录表损坏');
  }
  const offsets = Array.from({ length: recordCount }, (_, index) => readUInt32(bytes, 78 + index * 8));
  for (let index = 0; index < offsets.length; index += 1) {
    if (offsets[index] < tableEnd || offsets[index] > bytes.length) {
      throw new Error('MOBI/AZW3 的记录偏移无效');
    }
    if (index > 0 && offsets[index - 1] > offsets[index]) {
      throw new Error('MOBI/AZW3 的记录顺序无效');
    }
  }
  return offsets;
}

function record(bytes: Buffer, offsets: number[], index: number): Buffer {
  const start = offsets[index];
  const end = offsets[index + 1] ?? bytes.length;
  if (start > end) {
    throw new Error('MOBI/AZW3 的记录范围无效');
  }
  return bytes.subarray(start, end);
}

function mobiEncoding(header: Buffer): string {
  if (header.length < 32 || header.subarray(16, 20).toString('ascii') !== 'MOBI') {
    return 'utf8';
  }
  return readUInt32(header, 28) === 1252 ? 'windows1252' : 'utf8';
}

function decodeHtml(bytes: Buffer): string {
  const sample = bytes.subarray(0, Math.min(bytes.length, 1024)).toString('ascii');
  const declared = sample.match(/charset\s*=\s*["']?\s*([^\s"'/>;]+)/i)?.[1];
  if (declared && iconv.encodingExists(declared)) {
    return iconv.decode(bytes, declared);
  }
  return hasUtf8Bom(bytes) || isValidUtf8(bytes) ? bytes.toString('utf8').replace(/^\ufeff/, '') : iconv.decode(bytes, 'gb18030');
}

function hasUtf8Bom(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
}

function isValidUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

function readUInt16(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > bytes.length) {
    throw new Error('MOBI/AZW3 数据范围无效');
  }
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUInt32(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.length) {
    throw new Error('MOBI/AZW3 数据范围无效');
  }
  return ((bytes[offset] * 0x1000000) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0;
}
