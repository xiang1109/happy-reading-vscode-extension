import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { detectChapters } from './chapterDetector';
import { readEbook } from './extractors';
import { discoverBooks } from './libraryScanner';
import { ReaderChapter, ReaderSettings, RecentBook } from './model';
import { formatStatusPage, statusCellCount } from './statusFormatter';
import { ReaderStore, clamp } from './store';

export class ReaderSession {
  private files: string[] = [];
  private currentFileIndex = 0;
  private text = '';
  private currentIndex = 0;
  private statusPageEndIndex = 0;
  private lockedStatusPageEndIndex: number | undefined;
  private settingsValue: ReaderSettings;
  private pageStarts: number[] = [0];

  public currentTitle = '';
  public chapters: ReaderChapter[] = [];
  public statusBarEnabled: boolean;
  public statusWidth: number;

  public constructor(private readonly store: ReaderStore, private readonly onChanged: () => void) {
    this.settingsValue = store.settings();
    this.statusBarEnabled = store.get('statusBarEnabled', true);
    const storedStatusWidth = store.get('statusWidth', 260);
    this.statusWidth = clamp(storedStatusWidth > 100 ? Math.round(storedStatusWidth / 10) : storedStatusWidth, 0, 100);
  }

  public get settings(): ReaderSettings { return this.settingsValue; }
  public get currentPosition(): number { return this.text.length === 0 ? 0 : this.currentIndex + 1; }
  public get currentOffset(): number { return this.currentIndex; }
  public get currentBookPath(): string { return this.files[this.currentFileIndex] ?? ''; }
  public get libraryBooks(): RecentBook[] {
    return this.files.map(filePath => ({ name: path.basename(filePath), path: filePath, folder: path.dirname(filePath) }));
  }
  public get totalChars(): number { return this.text.length; }
  public get currentChapterIndex(): number {
    return Math.max(0, findChapterIndex(this.chapters, this.currentIndex));
  }
  public get currentChapterTitle(): string { return this.chapterTitleAt(this.currentIndex); }
  public get showInStatusBar(): boolean {
    return this.statusBarEnabled && this.settingsValue.location === 'statusBar' && this.text.length > 0;
  }

  public chapterTitleAt(position: number): string {
    const index = findChapterIndex(this.chapters, position);
    return index >= 0 ? this.chapters[index].title : '';
  }

  public async open(sourcePath: string, settings = this.settingsValue): Promise<void> {
    const discovered = await discoverBooks(sourcePath);
    if (discovered.length === 0) {
      throw new Error('没有找到支持的电子书文件');
    }
    await this.openDiscovered(sourcePath, discovered, 0, settings);
  }

  public async openLibraryAt(sourcePath: string, filePath: string, settings = this.settingsValue): Promise<void> {
    const discovered = await discoverBooks(sourcePath);
    const targetIndex = discovered.findIndex(candidate => candidate.toLowerCase() === filePath.toLowerCase());
    if (targetIndex < 0) {
      throw new Error(`未能在小说库中打开：${path.basename(filePath)}`);
    }
    await this.openDiscovered(sourcePath, discovered, targetIndex, settings);
  }

  public async restoreLast(settings = this.settingsValue): Promise<void> {
    const sourcePath = this.store.get('path', '');
    if (!sourcePath || !(await exists(sourcePath))) {
      return;
    }
    const discovered = await discoverBooks(sourcePath);
    if (discovered.length === 0) {
      return;
    }
    this.files = discovered;
    this.settingsValue = settings;
    this.currentFileIndex = clamp(this.store.get('fileIndex', 0), 0, discovered.length - 1);
    await this.loadCurrentFile();
    this.currentIndex = clamp(this.store.get('currentIndex', 0), 0, Math.max(0, this.text.length - 1));
    this.resetPageHistory();
    this.onChanged();
  }

  public async openKnownBook(filePath: string): Promise<boolean> {
    const index = this.files.findIndex(candidate => candidate.toLowerCase() === filePath.toLowerCase());
    if (index < 0) {
      return false;
    }
    const prepared = await this.prepareBook(filePath);
    this.currentFileIndex = index;
    this.applyPreparedBook(prepared);
    await this.store.noteOpened(filePath);
    await this.persistProgress();
    return true;
  }

  public async reflow(settings: ReaderSettings): Promise<void> {
    this.settingsValue = settings;
    if (settings.location === 'statusBar') {
      await this.setStatusBarVisible(true);
    }
    this.currentIndex = clamp(this.currentIndex, 0, Math.max(0, this.text.length - 1));
    this.resetPageHistory();
    await this.store.saveSettings(settings);
    await this.persistProgress();
  }

  public async setStatusBarVisible(visible: boolean): Promise<void> {
    this.statusBarEnabled = visible;
    await this.store.set('statusBarEnabled', visible);
    this.onChanged();
  }

  public async setStatusWidth(width: number): Promise<void> {
    this.statusWidth = clamp(width, 0, 100);
    await this.store.set('statusWidth', this.statusWidth);
    this.onChanged();
  }

  public currentPage(): string {
    if (!this.text) {
      return '请先打开一本书';
    }
    return this.text.slice(this.currentIndex, this.currentIndex + this.panelPageSize()) || '已读完';
  }

  public statusText(): string {
    if (!this.text) {
      this.statusPageEndIndex = this.currentIndex;
      return '请先打开一本书';
    }
    const maximumEnd = this.lockedStatusPageEndIndex !== undefined && this.lockedStatusPageEndIndex > this.currentIndex
      ? Math.min(this.lockedStatusPageEndIndex, this.text.length)
      : this.text.length;
    const page = formatStatusPage(this.text, this.currentIndex, maximumEnd, statusCellCount(this.statusWidth));
    this.statusPageEndIndex = page.end;
    return page.text;
  }

  public async next(): Promise<void> {
    if (!this.text) {
      return;
    }
    const nextIndex = this.settingsValue.location === 'statusBar'
      ? Math.max(this.statusPageEndIndex, this.currentIndex + 1)
      : this.currentIndex + this.panelPageSize();

    if (nextIndex < this.text.length) {
      this.currentIndex = nextIndex;
      if (this.pageStarts.at(-1) !== this.currentIndex) {
        this.pageStarts.push(this.currentIndex);
      }
      this.lockedStatusPageEndIndex = undefined;
    } else if (this.currentFileIndex < this.files.length - 1) {
      this.currentFileIndex += 1;
      await this.loadCurrentFile();
    } else {
      this.currentIndex = Math.max(0, this.text.length - 1);
    }
    await this.persistProgress();
  }

  public async previous(): Promise<void> {
    if (this.pageStarts.length > 1) {
      const previousPageEnd = this.currentIndex;
      this.pageStarts.pop();
      this.currentIndex = this.pageStarts.at(-1) ?? 0;
      this.lockedStatusPageEndIndex = previousPageEnd;
    } else if (this.currentIndex > 0) {
      this.currentIndex = 0;
      this.resetPageHistory();
    } else if (this.currentFileIndex > 0) {
      this.currentFileIndex -= 1;
      await this.loadCurrentFile();
      this.currentIndex = Math.max(0, this.text.length - 1);
      this.resetPageHistory();
    }
    await this.persistProgress();
  }

  public async jumpTo(position: number): Promise<void> {
    this.currentIndex = clamp(position - 1, 0, Math.max(0, this.text.length - 1));
    this.resetPageHistory();
    await this.persistProgress();
  }

  public async jumpToChapter(chapter: ReaderChapter): Promise<void> {
    this.currentIndex = clamp(chapter.offset, 0, Math.max(0, this.text.length - 1));
    this.resetPageHistory();
    await this.persistProgress();
  }

  private async loadCurrentFile(): Promise<void> {
    const filePath = this.files[this.currentFileIndex];
    const prepared = await this.prepareBook(filePath);
    this.applyPreparedBook(prepared);
    await this.store.noteOpened(filePath);
  }

  private async openDiscovered(sourcePath: string, discovered: string[], targetIndex: number, settings: ReaderSettings): Promise<void> {
    const prepared = await this.prepareBook(discovered[targetIndex]);
    this.files = discovered;
    this.currentFileIndex = targetIndex;
    this.settingsValue = settings;
    this.applyPreparedBook(prepared);
    await this.store.set('path', sourcePath);
    await this.store.noteOpened(discovered[targetIndex]);
    await this.persistProgress();
  }

  private async prepareBook(filePath: string): Promise<PreparedBook> {
    const extracted = await readEbook(filePath);
    if (!extracted.trim()) {
      throw new Error(`未能从 ${path.basename(filePath)} 中读取到文字`);
    }
    const text = normalize(extracted);
    return { title: path.basename(filePath), text, chapters: detectChapters(text) };
  }

  private applyPreparedBook(prepared: PreparedBook): void {
    this.currentTitle = prepared.title;
    this.text = prepared.text;
    this.chapters = prepared.chapters;
    this.currentIndex = 0;
    this.resetPageHistory();
  }

  private panelPageSize(): number {
    return Math.max(1, this.settingsValue.pageLines * this.settingsValue.charsPerLine);
  }

  private resetPageHistory(): void {
    this.pageStarts = [this.currentIndex];
    this.statusPageEndIndex = this.currentIndex;
    this.lockedStatusPageEndIndex = undefined;
  }

  private async persistProgress(): Promise<void> {
    await Promise.all([
      this.store.set('fileIndex', this.currentFileIndex),
      this.store.set('currentIndex', this.currentIndex)
    ]);
    this.onChanged();
  }
}

interface PreparedBook {
  title: string;
  text: string;
  chapters: ReaderChapter[];
}

function normalize(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .join('\n');
}

async function exists(filePath: string): Promise<boolean> {
  return fs.access(filePath).then(() => true, () => false);
}

function findChapterIndex(chapters: ReaderChapter[], position: number): number {
  for (let index = chapters.length - 1; index >= 0; index -= 1) {
    if (chapters[index].offset <= position) {
      return index;
    }
  }
  return -1;
}
