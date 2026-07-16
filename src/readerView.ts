import * as vscode from 'vscode';
import type { HappyReadingController } from './extension';

export class HappyReadingViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'happyReading.reader';
  private view?: vscode.WebviewView;

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly controller: HappyReadingController
  ) {}

  public resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')]
    };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage(message => this.controller.handleMessage(message));
  }

  public refresh(): void {
    void this.view?.webview.postMessage({ type: 'state', state: this.controller.state() });
  }

  public openSettings(): void {
    void this.view?.webview.postMessage({ type: 'openSettings' });
  }

  private html(webview: vscode.Webview): string {
    const nonce = getNonce();
    const css = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'reader.css'));
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'reader.js'));
    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${css}">
  <title>Happy Read book</title>
</head>
<body>
  <main id="app">
    <section id="toolbar">
      <div class="toolbar-row primary-row">
        <button class="icon-button" data-action="open" title="打开书籍或书库" aria-label="打开书籍或书库">${icon('folder')}</button>
        <button class="icon-button" data-action="books" title="小说列表" aria-label="小说列表">${icon('books')}</button>
        <button class="icon-button" data-action="chapters" title="当前章节目录" aria-label="当前章节目录">${icon('chapters')}</button>
        <button class="icon-button" data-action="readingMode" title="阅读模式" aria-label="阅读模式">${icon('reading')}</button>
        <span id="book-title" title=""></span>
        <button class="icon-button" data-action="previous" title="上一页 (Alt+左方向键)" aria-label="上一页">${icon('previous')}</button>
        <button class="icon-button" data-action="next" title="下一页 (Alt+右方向键)" aria-label="下一页">${icon('next')}</button>
        <button class="icon-button settings-button" data-action="toggleSettings" title="阅读设置" aria-label="阅读设置">${icon('settings')}</button>
      </div>
      <div class="toolbar-row navigation-row">
        <button id="exit-reading-mode" class="icon-button" data-action="exitReadingMode" title="退出阅读模式" aria-label="退出阅读模式">${icon('close')}</button>
        <button class="icon-button reading-mode-navigation" data-action="previous" title="上一页 (Alt+左方向键)" aria-label="上一页">${icon('previous')}</button>
        <button class="icon-button reading-mode-navigation" data-action="next" title="下一页 (Alt+右方向键)" aria-label="下一页">${icon('next')}</button>
        <label>跳转 <input id="position" type="number" min="1"></label>
        <label class="location-control" aria-label="阅读位置">
          <select id="location">
            <option value="panel">阅读区</option>
            <option value="statusBar">底部栏</option>
          </select>
        </label>
      </div>
      <section id="settings" class="settings-panel">
        <section class="settings-section">
          <h3 class="settings-section-title">阅读区</h3>
          <div class="settings-grid panel-settings">
          <label>每页行数 <input id="page-lines" type="number" min="1" max="30"></label>
          <label>每行字数 <input id="chars-per-line" type="number" min="8" max="200"></label>
          <label>主题
            <select id="theme">
              <option value="paper">纸书</option>
              <option value="night">暗夜</option>
              <option value="ink">水墨</option>
              <option value="custom">自定义</option>
            </select>
          </label>
          <label>字号 <input id="font-size" type="number" min="10" max="36"></label>
          <label class="wide">字体
            <select id="font-family">
              <option value="var(--vscode-editor-font-family)">VS Code 默认字体</option>
              <option value="Microsoft YaHei">微软雅黑</option>
              <option value="Microsoft JhengHei">微软正黑体</option>
              <option value="SimSun">宋体</option>
              <option value="NSimSun">新宋体</option>
              <option value="SimHei">黑体</option>
              <option value="KaiTi">楷体</option>
              <option value="FangSong">仿宋</option>
              <option value="DengXian">等线</option>
              <option value="Arial">Arial</option>
              <option value="Georgia">Georgia</option>
              <option value="Consolas">Consolas</option>
            </select>
          </label>
          <label>文字 <input id="text-color" type="text" maxlength="7"></label>
          <label>背景 <input id="background-color" type="text" maxlength="7"></label>
          </div>
        </section>
        <section class="settings-section">
          <h3 class="settings-section-title">底部栏</h3>
          <div class="settings-grid status-settings">
            <label class="wide">底栏宽度 <input id="status-width" type="range" min="100" max="1000" step="10"><output id="status-width-value"></output></label>
          </div>
        </section>
        <div class="settings-footer general-settings">
          <label><input id="auto-page" type="checkbox"> 鼠标静止自动翻页</label>
          <span>总字符 <strong id="total-chars">0</strong></span>
          <span>Alt+←/→ 翻页　Alt+↑/↓ 隐藏/显示底部栏</span>
        </div>
      </section>
    </section>
    <div id="toolbar-resizer" title="上下拖动调整阅读工具区高度" aria-hidden="true"></div>
    <section id="reader-shell">
      <textarea id="reader" readonly spellcheck="false" aria-label="阅读正文">请先打开一本书</textarea>
      <div id="status-hint">正文正在 VS Code 底部栏显示。使用 Alt+←/→ 翻页，Alt+↑/↓ 隐藏或显示。</div>
      <div class="record-bar"><button class="icon-button" data-action="bookmarks" id="bookmark-button" title="书签" aria-label="书签">${icon('bookmark')}</button></div>
    </section>
  </main>
  <div id="context-menu" class="floating-menu hidden">
    <button data-action="copySelection">复制</button>
    <button data-action="saveSelection">保存到书签</button>
  </div>
  <div id="bookmark-context-menu" class="floating-menu hidden">
    <button data-action="copyBookmark">复制</button>
    <button data-action="copyAllBookmarks">复制全部</button>
    <button data-action="deleteBookmark">删除</button>
  </div>
  <div id="book-context-menu" class="floating-menu hidden">
    <button data-action="hideBook">从小说列表移除</button>
  </div>
  <dialog id="modal">
    <header><h2 id="modal-title"></h2><button class="icon-button" data-action="closeModal" aria-label="关闭">${icon('close')}</button></header>
    <div id="modal-content"></div>
  </dialog>
  <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}

function icon(name: 'folder' | 'books' | 'chapters' | 'reading' | 'settings' | 'close' | 'previous' | 'next' | 'bookmark'): string {
  const paths: Record<typeof name, string> = {
    folder: '<path d="M2.5 5.5v-2h4l1.5 2h5.5v7h-11z"/><path d="M2.5 6.5h11"/>',
    books: '<path d="M3 3.5h2v9H3zM7 3.5h2v9H7zM11 3.5h2v9h-2z"/>',
    chapters: '<path d="M3 3.5h2v2H3zM3 7h2v2H3zM3 10.5h2v2H3zM7 4.5h6M7 8h6M7 11.5h6"/>',
    reading: '<path d="M2.5 3.5h4A2.5 2.5 0 0 1 9 6v6.5A2.5 2.5 0 0 0 6.5 10h-4zM13.5 3.5h-2A2.5 2.5 0 0 0 9 6v6.5a2.5 2.5 0 0 1 2.5-2.5h2z"/>',
    settings: '<circle cx="8" cy="8" r="2.2"/><path d="M8 2.5v1.3M8 12.2v1.3M2.5 8h1.3M12.2 8h1.3M4.1 4.1l.9.9M11 11l.9.9M11.9 4.1l-.9.9M5 11l-.9.9"/>',
    close: '<path d="M4 4l8 8M12 4l-8 8"/>',
    previous: '<path d="M10.5 3.5L6 8l4.5 4.5"/>',
    next: '<path d="M5.5 3.5L10 8l-4.5 4.5"/>',
    bookmark: '<path d="M4 2.5h8v11l-4-2.7-4 2.7z"/>'
  };
  return `<svg class="icon" viewBox="0 0 16 16" aria-hidden="true">${paths[name]}</svg>`;
}
