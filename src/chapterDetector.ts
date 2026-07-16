import { ReaderChapter } from './model';

const namedChapterHeading = /^(?:第[0-9一二三四五六七八九十百千万零〇两]+[章回节卷部篇](?:[：:·.\-—]?\s*.*)?|(?:chapter|part|book)\s+[0-9ivxlcdm一二三四五六七八九十]+(?:[：:·.\-—]?\s*.*)?|序章(?:\s*.*)?|楔子(?:\s*.*)?|前言(?:\s*.*)?|后记(?:\s*.*)?|尾声(?:\s*.*)?)$/i;
const numberedHeading = /^\d{1,4}[.、．]\s*(\S.{0,60})$/;
const wrappedBookTitle = /^[《〈「『【].+[》〉」』】]$/;

export function detectChapters(content: string): ReaderChapter[] {
  if (!content.trim()) {
    return [];
  }
  const structured = detectInlineTableOfContents(content);
  if (structured.length >= 4) {
    return structured;
  }
  const result: ReaderChapter[] = [];
  let offset = 0;
  for (const line of content.split('\n')) {
    const title = line.trim();
    if (title.length >= 1 && title.length <= 80 && isChapterHeading(title)) {
      result.push({ title, offset });
    }
    offset += line.length + 1;
  }
  const unique = result.filter((chapter, index) => index === 0 || chapter.offset !== result[index - 1].offset);
  if (unique.length > 0) {
    return unique;
  }
  const divided = detectDividerChapters(content);
  return divided.length > 0 ? divided : [{ title: '正文', offset: 0 }];
}

function detectDividerChapters(content: string): ReaderChapter[] {
  const lines: Array<{ text: string; offset: number }> = [];
  let offset = 0;
  for (const rawLine of content.split('\n')) {
    lines.push({ text: rawLine.trim(), offset });
    offset += rawLine.length + 1;
  }
  const dividers = lines
    .map((line, index) => /^(?:\*\s*){3,}$/.test(line.text) ? index : -1)
    .filter(index => index >= 0);
  if (dividers.length < 3) {
    return [];
  }

  const minimumSectionLength = Math.max(1_200, Math.min(5_000, Math.floor(content.length / 100)));
  const usable = dividers.map((lineIndex, dividerIndex) => {
    const sectionStart = nextContentLine(lines, lineIndex + 1);
    const sectionEnd = dividers[dividerIndex + 1] === undefined
      ? content.length
      : lines[dividers[dividerIndex + 1]].offset;
    return { dividerIndex, lineIndex: sectionStart, length: sectionEnd - (lines[sectionStart]?.offset ?? sectionEnd) };
  }).filter(section => section.lineIndex < lines.length && section.length >= minimumSectionLength);

  const run = longestConsecutiveRun(usable);
  if (run.length < 3 || run.length > 20) {
    return [];
  }
  return run.map((section, index) => ({
    title: `第${toChineseNumber(index + 1)}章`,
    offset: lines[section.lineIndex].offset
  }));
}

function nextContentLine(lines: Array<{ text: string }>, start: number): number {
  let index = start;
  while (index < lines.length && !lines[index].text) {
    index += 1;
  }
  return index;
}

function longestConsecutiveRun<T extends { dividerIndex: number }>(items: T[]): T[] {
  let best: T[] = [];
  let current: T[] = [];
  for (const item of items) {
    if (current.length === 0 || item.dividerIndex === current[current.length - 1].dividerIndex + 1) {
      current.push(item);
    } else {
      current = [item];
    }
    if (current.length > best.length) {
      best = [...current];
    }
  }
  return best;
}

function isChapterHeading(title: string): boolean {
  if (namedChapterHeading.test(title)) {
    return true;
  }
  const numbered = title.match(numberedHeading);
  if (!numbered) {
    return false;
  }
  // 出版物常在正文末尾附带“01.《书名》”式推荐书单。它有编号，
  // 但不是当前书籍的章节，不能出现在章节目录中。
  return !wrappedBookTitle.test(numbered[1].trim());
}

function detectInlineTableOfContents(content: string): ReaderChapter[] {
  const lines: Array<{ text: string; offset: number }> = [];
  let offset = 0;
  for (const rawLine of content.split('\n')) {
    lines.push({ text: rawLine.trim(), offset });
    offset += rawLine.length + 1;
  }

  const numeralCharacters = '一二三四五六七八九十百零〇两';
  const partPattern = new RegExp(`第([${numeralCharacters}]+)部([${numeralCharacters}]+)`, 'g');
  let tableLineIndex = -1;
  let parts: Array<{ part: string; chapters: string[] }> = [];
  for (let index = 0; index < lines.length; index += 1) {
    const matches = [...lines[index].text.matchAll(partPattern)];
    if (matches.length < 2) {
      continue;
    }
    const parsed = matches.map(match => ({ part: match[1], chapters: splitIncreasingNumerals(match[2]) }));
    if (parsed.every(part => part.chapters.length >= 2)) {
      tableLineIndex = index;
      parts = parsed;
      break;
    }
  }
  if (tableLineIndex < 0) {
    return [];
  }

  const expected = parts.flatMap(part => part.chapters.map(chapter => ({ part: part.part, chapter })));
  const result: ReaderChapter[] = [];
  let cursor = tableLineIndex + 1;
  for (let index = 0; index < expected.length; index += 1) {
    const marker = expected[index].chapter;
    const nextMarker = expected[index + 1]?.chapter;
    const candidates = candidateLineIndexes(lines, marker, cursor);
    if (candidates.length === 0) {
      return [];
    }
    let upperBound = lines.length;
    if (nextMarker) {
      const nextCandidate = candidateLineIndexes(lines, nextMarker, cursor)
        .find(candidate => candidate > candidates[0]);
      if (nextCandidate !== undefined) {
        upperBound = nextCandidate;
      }
    }
    const usable = candidates.filter(candidate => candidate < upperBound);
    const selected = (usable.length > 0 ? usable : candidates)
      .reduce((best, candidate) => candidatePenalty(lines[candidate].text, marker) < candidatePenalty(lines[best].text, marker) ? candidate : best);
    result.push({
      title: `第${expected[index].part}部 · 第${marker}章`,
      offset: lines[selected].offset
    });
    cursor = selected + 1;
  }
  return result;
}

function candidateLineIndexes(lines: Array<{ text: string }>, marker: string, start: number): number[] {
  const result: number[] = [];
  for (let index = start; index < lines.length; index += 1) {
    if (lines[index].text.startsWith(marker) && lines[index].text.length > marker.length) {
      result.push(index);
    }
  }
  return result;
}

function candidatePenalty(line: string, marker: string): number {
  const lengthPenalty = line.length >= 20 && line.length <= 250 ? 0 : line.length >= 12 && line.length <= 360 ? 5 : 15;
  const following = line.slice(marker.length);
  const commonContinuation = marker === '一' && /^[个只件次切阵遍提听根]/.test(following) ? 20 : 0;
  const dateLike = marker === '一' && /^九/.test(following) && line.length <= 20 ? 20 : 0;
  return lengthPenalty + commonContinuation + dateLike;
}

function splitIncreasingNumerals(value: string): string[] {
  const result: string[] = [];
  let cursor = 0;
  for (let number = 1; number <= 100 && cursor < value.length; number += 1) {
    const numeral = toChineseNumber(number);
    if (!value.startsWith(numeral, cursor)) {
      break;
    }
    result.push(numeral);
    cursor += numeral.length;
  }
  return result;
}

function toChineseNumber(value: number): string {
  const digits = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (value < 10) return digits[value];
  if (value === 10) return '十';
  if (value < 20) return `十${digits[value - 10]}`;
  if (value < 100) return `${digits[Math.floor(value / 10)]}十${digits[value % 10]}`;
  return '一百';
}
