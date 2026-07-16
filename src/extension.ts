import * as path from 'node:path';
import * as vscode from 'vscode';
import { ReaderAppearance, ReaderChapter, ReaderSettings, ReaderViewState, ReadingRecord } from './model';
import { ReaderSession } from './readerSession';
import { ReaderStore, clamp } from './store';
import { HappyReadingViewProvider } from './readerView';

export function activate(context: vscode.ExtensionContext): void {
  const controller = new HappyReadingController(context);
  context.subscriptions.push(controller);
  void controller.restore();
}

export function deactivate(): void {}

export class HappyReadingController implements vscode.Disposable {
  private readonly store: ReaderStore;
  private readonly session: ReaderSession;
  private readonly viewProvider: HappyReadingViewProvider;
  private readonly statusPrevious: vscode.StatusBarItem;
  private readonly statusText: vscode.StatusBarItem;
  private readonly statusNext: vscode.StatusBarItem;
  private readonly disposables: vscode.Disposable[] = [];
  private autoPage = false;

  public constructor(context: vscode.ExtensionContext) {
    this.store = new ReaderStore(context.globalState);
    this.statusPrevious = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 103);
    this.statusText = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 102);
    this.statusNext = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 101);
    this.session = new ReaderSession(this.store, () => this.refresh());
    this.viewProvider = new HappyReadingViewProvider(context.extensionUri, this);

    this.statusPrevious.text = '$(chevron-left)';
    this.statusPrevious.tooltip = '上一页 (Alt+左方向键)';
    this.statusPrevious.command = 'happyReading.previous';
    this.statusNext.text = '$(chevron-right)';
    this.statusNext.tooltip = '下一页 (Alt+右方向键)';
    this.statusNext.command = 'happyReading.next';
    this.statusText.command = undefined;

    this.disposables.push(
      this.statusPrevious,
      this.statusText,
      this.statusNext,
      vscode.window.registerWebviewViewProvider(HappyReadingViewProvider.viewType, this.viewProvider, {
        webviewOptions: { retainContextWhenHidden: true }
      }),
      vscode.commands.registerCommand('happyReading.open', () => this.chooseSource()),
      vscode.commands.registerCommand('happyReading.openView', () => vscode.commands.executeCommand('happyReading.reader.focus')),
      vscode.commands.registerCommand('happyReading.previous', () => this.previous()),
      vscode.commands.registerCommand('happyReading.next', () => this.next()),
      vscode.commands.registerCommand('happyReading.hideStatus', () => this.setReadingLocation('panel')),
      vscode.commands.registerCommand('happyReading.showStatus', () => this.setReadingLocation('statusBar')),
      vscode.commands.registerCommand('happyReading.usePanel', () => this.setReadingLocation('panel')),
      vscode.commands.registerCommand('happyReading.useStatusBar', () => this.setReadingLocation('statusBar')),
      vscode.commands.registerCommand('happyReading.statusWidth', () => this.promptStatusWidth()),
      vscode.commands.registerCommand('happyReading.settings', async () => {
        await vscode.commands.executeCommand('happyReading.reader.focus');
        this.viewProvider.openSettings();
      }),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('happyReading')) {
          void this.session.reflow(this.store.settings());
        }
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.openWorkspaceLibraryIfEmpty())
    );
    this.refresh();
  }

  public dispose(): void {
    this.disposables.forEach(disposable => disposable.dispose());
  }

  public async restore(): Promise<void> {
    await this.runSafely(() => this.session.restoreLast(this.store.settings()), false);
    await this.openWorkspaceLibraryIfEmpty();
    this.refresh();
  }

  public state(): ReaderViewState {
    return {
      title: this.session.currentTitle,
      page: this.session.currentPage(),
      position: this.session.currentPosition,
      totalChars: this.session.totalChars,
      currentBookPath: this.session.currentBookPath,
      currentChapterIndex: this.session.currentChapterIndex,
      chapters: this.session.chapters,
      recentBooks: mergeBooks(this.session.libraryBooks, this.store.recentBooks())
        .filter(book => !this.store.isBookHidden(book.path)),
      records: this.store.records(),
      settings: this.session.settings,
      appearance: this.store.appearance(),
      autoPage: this.autoPage,
      statusBarEnabled: this.session.statusBarEnabled,
      statusWidth: this.session.statusWidth
    };
  }

  public async handleMessage(message: Record<string, unknown>): Promise<void> {
    switch (message.type) {
      case 'ready':
        this.refresh();
        return;
      case 'open':
        await this.chooseSource();
        return;
      case 'previous':
        await this.previous();
        return;
      case 'next':
      case 'autoNext':
        await this.next();
        return;
      case 'jump':
        await this.session.jumpTo(Number(message.position) || 1);
        return;
      case 'chapter':
        await this.openChapter(Number(message.index));
        return;
      case 'book':
        await this.openBook(String(message.path ?? ''));
        return;
      case 'hideBook':
        await this.store.hideBook(String(message.path ?? ''));
        this.refresh();
        return;
      case 'settings':
        await this.updateSettings(message);
        return;
      case 'appearance':
        await this.updateAppearance(message);
        return;
      case 'autoPage':
        this.autoPage = Boolean(message.enabled);
        this.refresh();
        return;
      case 'statusVisible':
        await this.session.setStatusBarVisible(Boolean(message.visible));
        return;
      case 'statusWidth':
        await this.session.setStatusWidth(Number(message.width));
        return;
      case 'bookmark':
        await this.addBookmark(String(message.text ?? ''), Number(message.start) || 0);
        return;
      case 'deleteBookmark':
        await this.store.deleteRecord(Number(message.id));
        this.refresh();
        return;
      case 'openBookmark':
        await this.openBookmark(Number(message.id));
        return;
      case 'copy':
        await vscode.env.clipboard.writeText(String(message.text ?? ''));
        return;
    }
  }

  private async chooseSource(): Promise<void> {
    const selection = await vscode.window.showQuickPick([
      { label: '$(file) 打开单本书籍', description: '选择 TXT、EPUB、PDF、MOBI 或 AZW3 文件', mode: 'file' as const },
      { label: '$(folder-opened) 打开小说书库', description: '选择书库中的任意一本书，自动扫描它所在的文件夹', mode: 'folder' as const }
    ], { title: 'Happy Read book', placeHolder: '请选择打开方式' });
    if (!selection) {
      return;
    }
    const defaultUri = this.store.get<string>('libraryFolder', '') || this.session.currentBookPath;
    const selected = await vscode.window.showOpenDialog({
      title: selection.mode === 'file' ? '打开电子书' : '选择小说库中的任意一本书',
      defaultUri: defaultUri ? vscode.Uri.file(defaultUri) : undefined,
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      openLabel: '开始阅读',
      filters: { '电子书': ['txt', 'epub', 'pdf', 'mobi', 'azw3'] }
    });
    const selectedUri = selected?.[0];
    const selectedPath = selectedUri?.fsPath;
    if (!selectedPath) {
      return;
    }
    const libraryFolder = path.dirname(selectedPath);
    await this.store.set('libraryFolder', libraryFolder);
    if (selection.mode === 'folder') {
      await this.store.unhideBooksUnder(libraryFolder);
    } else {
      await this.store.unhideBook(selectedPath);
    }
    if (selection.mode === 'folder') {
      await this.runSafely(() => this.session.openLibraryAt(libraryFolder, selectedPath, this.session.settings));
    } else {
      await this.openBook(selectedPath);
    }
  }

  private async openBook(filePath: string): Promise<void> {
    if (!filePath) {
      return;
    }
    await this.runSafely(async () => {
      if (!(await this.session.openKnownBook(filePath))) {
        await this.session.open(filePath, this.session.settings);
      }
    });
  }

  private async openWorkspaceLibraryIfEmpty(): Promise<void> {
    if (this.session.totalChars > 0) {
      return;
    }
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      try {
        await this.session.open(folder.uri.fsPath, this.session.settings);
        await this.store.set('libraryFolder', folder.uri.fsPath);
        return;
      } catch {
        // A code workspace commonly contains no ebooks; try the next workspace root silently.
      }
    }
  }

  private async previous(): Promise<void> {
    await this.runSafely(() => this.session.previous());
  }

  private async next(): Promise<void> {
    await this.runSafely(() => this.session.next());
  }

  private async openChapter(index: number): Promise<void> {
    const chapter = this.session.chapters[index];
    if (chapter) {
      await this.session.jumpToChapter(chapter);
    }
  }

  private async updateSettings(message: Record<string, unknown>): Promise<void> {
    const settings: ReaderSettings = {
      pageLines: clamp(Number(message.pageLines), 1, 30),
      charsPerLine: clamp(Number(message.charsPerLine), 8, 200),
      location: message.location === 'statusBar' ? 'statusBar' : 'panel'
    };
    await this.session.reflow(settings);
  }

  private async updateAppearance(message: Record<string, unknown>): Promise<void> {
    const current = this.store.appearance();
    const appearance: ReaderAppearance = {
      theme: ['paper', 'night', 'ink', 'custom'].includes(String(message.theme))
        ? String(message.theme) as ReaderAppearance['theme']
        : current.theme,
      fontFamily: String(message.fontFamily || current.fontFamily),
      fontSize: clamp(Number(message.fontSize), 10, 36),
      textColor: normalizeColor(String(message.textColor || current.textColor), current.textColor),
      backgroundColor: normalizeColor(String(message.backgroundColor || current.backgroundColor), current.backgroundColor)
    };
    await this.store.saveAppearance(appearance);
    this.refresh();
  }

  private async addBookmark(text: string, relativeStart: number): Promise<void> {
    const normalized = text.trim();
    if (!normalized || !this.session.currentBookPath) {
      return;
    }
    const position = this.session.currentOffset + Math.max(0, relativeStart);
    await this.store.addRecord({
      bookTitle: this.session.currentTitle || '未命名书籍',
      text: normalized,
      bookPath: this.session.currentBookPath,
      position,
      chapterTitle: this.session.chapterTitleAt(position)
    });
    this.refresh();
  }

  private async openBookmark(id: number): Promise<void> {
    const record = this.store.records().find(item => item.id === id);
    if (!record?.bookPath) {
      void vscode.window.showWarningMessage('该书签没有可用的小说文件路径');
      return;
    }
    await this.runSafely(async () => {
      const settings: ReaderSettings = { ...this.session.settings, location: 'panel' };
      await this.session.reflow(settings);
      await this.session.open(record.bookPath, settings);
      await this.session.jumpTo(record.position + 1);
    });
  }

  private async promptStatusWidth(): Promise<void> {
    const value = await vscode.window.showInputBox({
      title: '调整底部栏宽度',
      prompt: '请输入 100 到 1000 之间的宽度',
      value: String(this.session.statusWidth),
      validateInput: input => {
        const number = Number(input);
        return Number.isFinite(number) && number >= 100 && number <= 1000 ? undefined : '请输入 100 到 1000 之间的数字';
      }
    });
    if (value !== undefined) {
      await this.session.setStatusWidth(Number(value));
    }
  }

  private async setReadingLocation(location: ReaderSettings['location']): Promise<void> {
    await this.session.reflow({ ...this.session.settings, location });
    await this.session.setStatusBarVisible(location === 'statusBar');
  }

  private refresh(): void {
    if (this.session.showInStatusBar) {
      this.statusPrevious.show();
      this.statusText.text = ` ${escapeStatusText(this.session.statusText())} `;
      this.statusText.tooltip = `${this.session.currentTitle} · ${this.session.currentChapterTitle || '正文'}\n点击打开阅读区`;
      this.statusText.show();
      this.statusNext.show();
    } else {
      this.statusPrevious.hide();
      this.statusText.hide();
      this.statusNext.hide();
    }
    this.viewProvider.refresh();
  }

  private async runSafely(action: () => Promise<void>, notify = true): Promise<void> {
    try {
      await action();
    } catch (error) {
      if (notify) {
        void vscode.window.showErrorMessage(error instanceof Error ? error.message : '无法完成阅读操作');
      }
    } finally {
      this.refresh();
    }
  }
}

function normalizeColor(value: string, fallback: string): string {
  const normalized = value.trim();
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized.toUpperCase() : fallback;
}

function escapeStatusText(value: string): string {
  return value.replace(/\$/g, '\\$').replace(/\r?\n/g, ' ');
}

function mergeBooks(primary: ReaderViewState['recentBooks'], secondary: ReaderViewState['recentBooks']): ReaderViewState['recentBooks'] {
  return [...primary, ...secondary].filter((book, index, values) =>
    values.findIndex(candidate => candidate.path.toLowerCase() === book.path.toLowerCase()) === index
  );
}
