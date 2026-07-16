import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { isSupportedBook } from './extractors';
import { isIgnoredBookPath } from './libraryScanner';
import { ReaderAppearance, ReaderSettings, ReaderTheme, ReadingRecord, RecentBook } from './model';

const prefix = 'happyReading.reader.';

export class ReaderStore {
  public constructor(private readonly state: vscode.Memento) {}

  public get<T>(key: string, fallback: T): T {
    return this.state.get<T>(prefix + key, fallback);
  }

  public async set<T>(key: string, value: T): Promise<void> {
    await this.state.update(prefix + key, value);
  }

  public settings(): ReaderSettings {
    const configuration = vscode.workspace.getConfiguration('happyReading');
    return {
      pageLines: clamp(this.get('pageLines', configuration.get('pageLines', 6)), 1, 30),
      charsPerLine: clamp(this.get('charsPerLine', configuration.get('charsPerLine', 28)), 8, 200),
      location: this.get('location', configuration.get<'panel' | 'statusBar'>('location', 'panel')) === 'statusBar' ? 'statusBar' : 'panel'
    };
  }

  public async saveSettings(settings: ReaderSettings): Promise<void> {
    await Promise.all([
      this.set('pageLines', clamp(settings.pageLines, 1, 30)),
      this.set('charsPerLine', clamp(settings.charsPerLine, 8, 200)),
      this.set('location', settings.location)
    ]);
  }

  public appearance(): ReaderAppearance {
    const theme = this.get<ReaderTheme>('theme', 'night');
    const colors = themeColors(theme);
    return {
      theme,
      fontFamily: this.get('fontFamily', 'var(--vscode-editor-font-family)'),
      fontSize: clamp(this.get('fontSize', 15), 10, 36),
      textColor: this.get('textColor', colors.text),
      backgroundColor: this.get('backgroundColor', colors.background)
    };
  }

  public async saveAppearance(appearance: ReaderAppearance): Promise<void> {
    await Promise.all([
      this.set('theme', appearance.theme),
      this.set('fontFamily', appearance.fontFamily),
      this.set('fontSize', clamp(appearance.fontSize, 10, 36)),
      this.set('textColor', appearance.textColor),
      this.set('backgroundColor', appearance.backgroundColor)
    ]);
  }

  public recentBooks(): RecentBook[] {
    return this.get<string[]>('recentBooks', [])
      .filter(filePath => fs.existsSync(filePath) && fs.statSync(filePath).isFile() && isSupportedBook(filePath))
      .filter(filePath => !isIgnoredBookPath(filePath))
      .filter((filePath, index, values) => values.findIndex(value => value.toLowerCase() === filePath.toLowerCase()) === index)
      .map(filePath => ({ name: path.basename(filePath), path: filePath, folder: path.dirname(filePath) }));
  }

  public async noteOpened(filePath: string): Promise<void> {
    if (!isSupportedBook(filePath)) {
      return;
    }
    const paths = [filePath, ...this.recentBooks().map(book => book.path)]
      .filter((value, index, values) => values.findIndex(item => item.toLowerCase() === value.toLowerCase()) === index)
      .slice(0, 100);
    await this.set('recentBooks', paths);
  }

  public isBookHidden(filePath: string): boolean {
    const normalized = filePath.toLowerCase();
    return this.get<string[]>('hiddenBooks', []).some(item => item.toLowerCase() === normalized);
  }

  public async hideBook(filePath: string): Promise<void> {
    if (!filePath) {
      return;
    }
    const paths = [filePath, ...this.get<string[]>('hiddenBooks', [])]
      .filter((value, index, values) => values.findIndex(item => item.toLowerCase() === value.toLowerCase()) === index)
      .slice(0, 500);
    await this.set('hiddenBooks', paths);
  }

  public async unhideBook(filePath: string): Promise<void> {
    const normalized = filePath.toLowerCase();
    await this.set('hiddenBooks', this.get<string[]>('hiddenBooks', [])
      .filter(item => item.toLowerCase() !== normalized));
  }

  public async unhideBooksUnder(folderPath: string): Promise<void> {
    const prefixPath = folderPath.toLowerCase().replace(/[\\/]+$/, '') + path.sep;
    await this.set('hiddenBooks', this.get<string[]>('hiddenBooks', [])
      .filter(item => !item.toLowerCase().startsWith(prefixPath)));
  }

  public records(): ReadingRecord[] {
    return this.get<ReadingRecord[]>('records', [])
      .filter(record => record && Number.isFinite(record.id) && typeof record.text === 'string')
      .sort((left, right) => right.id - left.id);
  }

  public async addRecord(record: Omit<ReadingRecord, 'id'>): Promise<void> {
    const text = record.text.trim();
    if (!text) {
      return;
    }
    const records = this.records();
    const id = Math.max(Date.now(), (records[0]?.id ?? 0) + 1);
    await this.set('records', [{ ...record, text, id }, ...records].slice(0, 200));
  }

  public async deleteRecord(id: number): Promise<void> {
    await this.set('records', this.records().filter(record => record.id !== id));
  }
}

export function themeColors(theme: ReaderTheme): { background: string; text: string } {
  switch (theme) {
    case 'paper':
      return { background: '#F5F0E8', text: '#3A3A3A' };
    case 'ink':
      return { background: '#DCE1E8', text: '#2C3E50' };
    case 'night':
    case 'custom':
    default:
      return { background: '#1E1E1E', text: '#D4D4D4' };
  }
}

export function clamp(value: number, minimum: number, maximum: number): number {
  const safe = Number.isFinite(value) ? Math.round(value) : minimum;
  return Math.min(maximum, Math.max(minimum, safe));
}
