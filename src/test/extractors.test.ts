import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import AdmZip from 'adm-zip';
import * as iconv from 'iconv-lite';
import { detectChapters } from '../chapterDetector';
import { decompressPalmDoc, htmlToText, readEbook, readMobiBuffer } from '../extractors';
import { discoverBooks } from '../libraryScanner';
import { formatStatusPage, statusCellCount } from '../statusFormatter';

test('decompresses PalmDOC literals and space encoding', () => {
  const compressed = Buffer.from(['H'.charCodeAt(0), 'i'.charCodeAt(0), 0xc1]);
  assert.equal(decompressPalmDoc(compressed).toString('utf8'), 'Hi A');
});

test('reads UTF-8 text from an uncompressed MOBI container', () => {
  const text = readMobiBuffer(createMobi('<html><body><h1>第一章</h1><p>测试正文</p></body></html>'));
  assert.match(text, /第一章/);
  assert.match(text, /测试正文/);
});

test('rejects encrypted Kindle books with a clear error', () => {
  assert.throws(() => readMobiBuffer(createMobi('encrypted', 1)), /文件被加密无法打开/);
});

test('reports the encrypted Kindle filename when opening it', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'happy-reading-encrypted-'));
  const filePath = path.join(folder, '加密小说.azw3');
  try {
    await fs.writeFile(filePath, createMobi('encrypted', 1));
    await assert.rejects(() => readEbook(filePath), /加密小说\.azw3：解析失败，文件可能加密/);
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
});

test('reports broken PalmDOC data as encrypted', () => {
  assert.throws(() => decompressPalmDoc(Buffer.from([0x80])), /文件被加密无法打开/);
});

test('detects chapter titles and offsets', () => {
  const content = '序章\n开场正文\n第一章 出发\n章节正文\nChapter 2 Return\n结尾';
  const chapters = detectChapters(content);
  assert.deepEqual(chapters.map(item => item.title), ['序章', '第一章 出发', 'Chapter 2 Return']);
  assert.equal(chapters[1].offset, content.indexOf('第一章 出发'));
  assert.equal(chapters[2].offset, content.indexOf('Chapter 2 Return'));
});

test('does not treat a numbered recommended-book list as chapters', () => {
  const content = [
    '老人与海正文',
    '李继宏世界名著新译系列',
    '01.《小王子》',
    '02.《老人与海》',
    '03.《动物农场》',
    '04.《了不起的盖茨比》'
  ].join('\n');
  assert.deepEqual(detectChapters(content), [{ title: '正文', offset: 0 }]);
});

test('detects long chapters separated by star dividers and ignores front matter dividers', () => {
  const longSection = (label: string) => `${label}${'正文内容'.repeat(500)}`;
  const content = [
    '版权信息', '* * *', '出版说明', '* * *', '献词',
    '* * *', longSection('第一部分'),
    '* * *', longSection('第二部分'),
    '* * *', longSection('第三部分'),
    '* * *', '尾注'
  ].join('\n');
  const chapters = detectChapters(content);
  assert.deepEqual(chapters.map(item => item.title), ['第一章', '第二章', '第三章']);
  assert.equal(chapters[0].offset, content.indexOf('第一部分'));
  assert.equal(chapters[2].offset, content.indexOf('第三部分'));
});

test('formats status text into a fixed number of full-width cells', () => {
  const chinese = formatStatusPage('中文测试', 0, 4, 4);
  const mixed = formatStatusPage('A1!?', 0, 4, 4);
  const short = formatStatusPage('末', 0, 1, 4);
  assert.equal(Array.from(chinese.text).length, 4);
  assert.equal(Array.from(mixed.text).length, 4);
  assert.equal(mixed.text, 'Ａ１！？');
  assert.equal(short.text, `末${'　'.repeat(3)}`);
  assert.equal(statusCellCount(260), 15);
});

test('reconstructs chapters from an inline part table of contents', () => {
  const content = [
    '第一部一二第二部一二译本序',
    '译者说明',
    '一第一部分第一章正文从这里开始，内容足够长以形成有效章节。',
    '二第一部分第二章正文从这里开始，内容足够长以形成有效章节。',
    '一第二部分第一章正文从这里开始，内容足够长以形成有效章节。',
    '二第二部分第二章正文从这里开始，内容足够长以形成有效章节。'
  ].join('\n');
  const chapters = detectChapters(content);
  assert.deepEqual(chapters.map(item => item.title), [
    '第一部 · 第一章', '第一部 · 第二章', '第二部 · 第一章', '第二部 · 第二章'
  ]);
  assert.equal(chapters[2].offset, content.indexOf('一第二部分第一章'));
});

test('converts ebook HTML into readable text', () => {
  assert.equal(htmlToText('<h1>标题</h1><p>第一行<br>第二行</p><script>bad()</script>'), '标题\n\n第一行\n第二行');
});

test('reads GB18030 TXT files', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'happy-reading-'));
  const filePath = path.join(folder, '中文.txt');
  try {
    await fs.writeFile(filePath, iconv.encode('第一章 测试\n这是正文。', 'gb18030'));
    assert.equal(await readEbook(filePath), '第一章 测试\n这是正文。');
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
});

test('reads and orders EPUB HTML entries', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'happy-reading-'));
  const filePath = path.join(folder, 'sample.epub');
  try {
    const zip = new AdmZip();
    zip.addFile('02.xhtml', Buffer.from('<p>第二章</p>', 'utf8'));
    zip.addFile('01.xhtml', Buffer.from('<h1>第一章</h1><p>正文</p>', 'utf8'));
    zip.writeZip(filePath);
    const text = await readEbook(filePath);
    assert.match(text, /^第一章/);
    assert.match(text, /正文\n第二章$/);
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
});

test('recursively scans an opened book folder and ignores unsupported files', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'happy-reading-library-'));
  try {
    await fs.mkdir(path.join(folder, '子目录'));
    await fs.mkdir(path.join(folder, 'node_modules'));
    await fs.writeFile(path.join(folder, '第二本.txt'), '第二本');
    await fs.writeFile(path.join(folder, '子目录', '第一本.epub'), 'placeholder');
    await fs.writeFile(path.join(folder, 'node_modules', 'LICENSE.txt'), 'not a novel');
    await fs.writeFile(path.join(folder, '打包文件.zip'), 'ignored');
    const books = await discoverBooks(folder);
    assert.equal(books.length, 2);
    assert.deepEqual(new Set(books.map(filePath => path.basename(filePath))), new Set(['第一本.epub', '第二本.txt']));
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
});

function createMobi(content: string, encryption = 0): Buffer {
  const text = Buffer.from(content, 'utf8');
  const recordTableEnd = 78 + 2 * 8;
  const mobiHeader = Buffer.alloc(32);
  mobiHeader.writeUInt16BE(1, 0);
  mobiHeader.writeUInt32BE(text.length, 4);
  mobiHeader.writeUInt16BE(1, 8);
  mobiHeader.writeUInt16BE(encryption, 12);
  mobiHeader.write('MOBI', 16, 'ascii');
  mobiHeader.writeUInt32BE(65_001, 28);
  const bytes = Buffer.alloc(recordTableEnd + mobiHeader.length + text.length);
  bytes.writeUInt16BE(2, 76);
  bytes.writeUInt32BE(recordTableEnd, 78);
  bytes.writeUInt32BE(recordTableEnd + mobiHeader.length, 86);
  mobiHeader.copy(bytes, recordTableEnd);
  text.copy(bytes, recordTableEnd + mobiHeader.length);
  return bytes;
}
