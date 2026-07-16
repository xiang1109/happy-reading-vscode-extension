(function () {
  'use strict';

  const vscode = acquireVsCodeApi();
  const elements = {
    reader: document.getElementById('reader'),
    toolbar: document.getElementById('toolbar'),
    toolbarResizer: document.getElementById('toolbar-resizer'),
    title: document.getElementById('book-title'),
    position: document.getElementById('position'),
    location: document.getElementById('location'),
    settings: document.getElementById('settings'),
    pageLines: document.getElementById('page-lines'),
    charsPerLine: document.getElementById('chars-per-line'),
    theme: document.getElementById('theme'),
    fontSize: document.getElementById('font-size'),
    fontFamily: document.getElementById('font-family'),
    textColor: document.getElementById('text-color'),
    backgroundColor: document.getElementById('background-color'),
    autoPage: document.getElementById('auto-page'),
    totalChars: document.getElementById('total-chars'),
    statusWidth: document.getElementById('status-width'),
    statusWidthValue: document.getElementById('status-width-value'),
    bookmarkButton: document.getElementById('bookmark-button'),
    contextMenu: document.getElementById('context-menu'),
    bookmarkContextMenu: document.getElementById('bookmark-context-menu'),
    bookContextMenu: document.getElementById('book-context-menu'),
    modal: document.getElementById('modal'),
    modalTitle: document.getElementById('modal-title'),
    modalContent: document.getElementById('modal-content')
  };

  let state;
  let readingMode = false;
  let settingsVisible = false;
  let modalType = '';
  let selection = { text: '', start: 0 };
  let contextBookmarkId = 0;
  let contextBookPath = '';
  let lastPointerAt = Date.now();
  let webviewState = vscode.getState() || {};
  sanitizeStoredToolbarHeights();
  applyStoredToolbarHeight();

  window.addEventListener('message', event => {
    if (event.data.type === 'state') {
      state = event.data.state;
      render();
    } else if (event.data.type === 'openSettings') {
      settingsVisible = true;
      renderLayout();
    }
  });

  document.addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (button) {
      handleAction(button.dataset.action, button.dataset);
    }
    if (!event.target.closest('.floating-menu')) {
      hideContextMenus();
    }
  });

  document.addEventListener('pointermove', () => { lastPointerAt = Date.now(); });
  document.addEventListener('keydown', () => { lastPointerAt = Date.now(); });

  elements.reader.addEventListener('dblclick', () => {
    if (readingMode) {
      readingMode = false;
      renderLayout();
    }
  });

  elements.reader.addEventListener('contextmenu', event => {
    event.preventDefault();
    const start = elements.reader.selectionStart || 0;
    const end = elements.reader.selectionEnd || 0;
    selection = {
      text: elements.reader.value.slice(start, end).trim(),
      start
    };
    const copyButton = elements.contextMenu.querySelector('[data-action="copySelection"]');
    const saveButton = elements.contextMenu.querySelector('[data-action="saveSelection"]');
    copyButton.disabled = !selection.text && !elements.reader.value;
    saveButton.disabled = !selection.text;
    const left = Math.min(event.clientX, window.innerWidth - 150);
    const top = Math.min(event.clientY, window.innerHeight - 80);
    elements.contextMenu.style.left = `${Math.max(0, left)}px`;
    elements.contextMenu.style.top = `${Math.max(0, top)}px`;
    elements.contextMenu.classList.remove('hidden');
  });

  elements.position.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      vscode.postMessage({ type: 'jump', position: numberValue(elements.position, 1) });
    }
  });
  elements.position.addEventListener('change', () => vscode.postMessage({ type: 'jump', position: numberValue(elements.position, 1) }));
  elements.location.addEventListener('change', sendSettings);
  elements.pageLines.addEventListener('change', sendSettings);
  elements.charsPerLine.addEventListener('change', sendSettings);
  elements.theme.addEventListener('change', () => {
    const colors = themeColors(elements.theme.value);
    if (colors) {
      elements.textColor.value = colors.text;
      elements.backgroundColor.value = colors.background;
    }
    sendAppearance();
  });
  elements.fontSize.addEventListener('change', sendAppearance);
  elements.fontFamily.addEventListener('change', sendAppearance);
  elements.textColor.addEventListener('change', useCustomColors);
  elements.backgroundColor.addEventListener('change', useCustomColors);
  elements.autoPage.addEventListener('change', () => vscode.postMessage({ type: 'autoPage', enabled: elements.autoPage.checked }));
  elements.statusWidth.addEventListener('input', () => {
    updateStatusWidthControl();
  });
  elements.statusWidth.addEventListener('change', () => vscode.postMessage({ type: 'statusWidth', width: numberValue(elements.statusWidth, 260) }));
  elements.modal.addEventListener('cancel', () => { modalType = ''; hideContextMenus(); });
  elements.modal.addEventListener('close', () => { modalType = ''; hideContextMenus(); });
  window.addEventListener('resize', applyStoredToolbarHeight);
  elements.toolbarResizer.addEventListener('pointerdown', event => {
    event.preventDefault();
    if (settingsVisible && !readingMode) return;
    const startY = event.clientY;
    const startHeight = elements.toolbar.getBoundingClientRect().height;
    elements.toolbarResizer.setPointerCapture(event.pointerId);
    const move = moveEvent => {
      const height = Math.max(28, Math.min(Math.max(28, window.innerHeight - 60), startHeight + moveEvent.clientY - startY));
      elements.toolbar.style.height = `${height}px`;
      elements.toolbar.style.overflow = 'auto';
      const key = readingMode ? 'readingModeHeight' : 'toolbarHeight';
      webviewState = { ...webviewState, [key]: height };
      vscode.setState(webviewState);
    };
    const stop = () => {
      elements.toolbarResizer.removeEventListener('pointermove', move);
      elements.toolbarResizer.removeEventListener('pointerup', stop);
      elements.toolbarResizer.removeEventListener('pointercancel', stop);
    };
    elements.toolbarResizer.addEventListener('pointermove', move);
    elements.toolbarResizer.addEventListener('pointerup', stop);
    elements.toolbarResizer.addEventListener('pointercancel', stop);
  });

  setInterval(() => {
    if (state?.autoPage && Date.now() - lastPointerAt >= 2400) {
      lastPointerAt = Date.now();
      vscode.postMessage({ type: 'autoNext' });
    }
  }, 1200);

  function handleAction(action, data) {
    switch (action) {
      case 'open': vscode.postMessage({ type: 'open' }); break;
      case 'previous': vscode.postMessage({ type: 'previous' }); break;
      case 'next': vscode.postMessage({ type: 'next' }); break;
      case 'readingMode':
        readingMode = true;
        settingsVisible = false;
        renderLayout();
        break;
      case 'exitReadingMode': readingMode = false; renderLayout(); break;
      case 'toggleSettings':
        settingsVisible = !settingsVisible;
        if (settingsVisible) elements.settings.scrollTop = 0;
        renderLayout();
        break;
      case 'books': openModal('books'); break;
      case 'chapters': openModal('chapters'); break;
      case 'bookmarks': openModal('bookmarks'); break;
      case 'closeModal': elements.modal.close(); break;
      case 'openBook': vscode.postMessage({ type: 'book', path: data.path }); elements.modal.close(); break;
      case 'hideBook':
        if (contextBookPath) vscode.postMessage({ type: 'hideBook', path: contextBookPath });
        hideContextMenus();
        break;
      case 'openChapter': vscode.postMessage({ type: 'chapter', index: Number(data.index) }); elements.modal.close(); break;
      case 'openBookmark': vscode.postMessage({ type: 'openBookmark', id: Number(data.id) }); elements.modal.close(); break;
      case 'deleteBookmark': {
        const id = Number(data.id) || contextBookmarkId;
        if (id) vscode.postMessage({ type: 'deleteBookmark', id });
        hideContextMenus();
        break;
      }
      case 'copyBookmark': {
        const id = Number(data.id) || contextBookmarkId;
        const record = state?.records.find(item => item.id === id);
        if (record) vscode.postMessage({ type: 'copy', text: bookmarkClipboardText(record) });
        hideContextMenus();
        break;
      }
      case 'copyAllBookmarks': {
        const text = (state?.records || []).map(bookmarkClipboardText).join('\n\n');
        if (text) vscode.postMessage({ type: 'copy', text });
        hideContextMenus();
        break;
      }
      case 'copySelection':
        vscode.postMessage({ type: 'copy', text: selection.text || elements.reader.value });
        hideContextMenu();
        break;
      case 'saveSelection':
        if (selection.text) vscode.postMessage({ type: 'bookmark', text: selection.text, start: selection.start });
        hideContextMenu();
        break;
    }
  }

  function render() {
    if (!state) return;
    elements.reader.value = state.page;
    elements.reader.scrollTop = 0;
    elements.title.textContent = shorten(state.title, 34);
    elements.title.title = state.title || '';
    elements.position.value = String(state.position || 1);
    elements.position.max = String(Math.max(1, state.totalChars));
    elements.location.value = state.settings.location;
    elements.pageLines.value = String(state.settings.pageLines);
    elements.charsPerLine.value = String(state.settings.charsPerLine);
    elements.theme.value = state.appearance.theme;
    elements.fontSize.value = String(state.appearance.fontSize);
    ensureSelectOption(elements.fontFamily, state.appearance.fontFamily);
    elements.fontFamily.value = state.appearance.fontFamily;
    elements.textColor.value = state.appearance.textColor;
    elements.backgroundColor.value = state.appearance.backgroundColor;
    elements.autoPage.checked = state.autoPage;
    elements.totalChars.textContent = String(state.totalChars);
    elements.statusWidth.value = String(state.statusWidth);
    updateStatusWidthControl();
    elements.bookmarkButton.title = state.records.length ? `书签 (${state.records.length})` : '书签';

    const root = document.documentElement.style;
    root.setProperty('--reader-bg', state.appearance.backgroundColor);
    root.setProperty('--reader-fg', state.appearance.textColor);
    root.setProperty('--reader-font', state.appearance.fontFamily);
    root.setProperty('--reader-size', `${state.appearance.fontSize}px`);
    document.body.classList.toggle('status-location', state.settings.location === 'statusBar');
    renderLayout();
    if (modalType && elements.modal.open) renderModal();
  }

  function renderLayout() {
    document.body.classList.toggle('reading-mode', readingMode);
    elements.settings.classList.toggle('visible', settingsVisible && !readingMode);
    applyStoredToolbarHeight();
  }

  function sendSettings() {
    vscode.postMessage({
      type: 'settings',
      pageLines: numberValue(elements.pageLines, 6),
      charsPerLine: numberValue(elements.charsPerLine, 28),
      location: elements.location.value
    });
  }

  function sendAppearance() {
    vscode.postMessage({
      type: 'appearance',
      theme: elements.theme.value,
      fontSize: numberValue(elements.fontSize, 15),
      fontFamily: elements.fontFamily.value,
      textColor: elements.textColor.value,
      backgroundColor: elements.backgroundColor.value
    });
  }

  function useCustomColors() {
    elements.theme.value = 'custom';
    sendAppearance();
  }

  function openModal(type) {
    if (modalType === type && elements.modal.open) {
      elements.modal.close();
      modalType = '';
      return;
    }
    modalType = type;
    renderModal();
    if (!elements.modal.open) elements.modal.show();
    elements.modalContent.scrollTop = 0;
  }

  function renderModal() {
    elements.modalContent.replaceChildren();
    if (!state) return;
    if (modalType === 'books') {
      elements.modalTitle.textContent = '小说列表';
      if (!state.recentBooks.length) return showEmpty('还没有打开过小说');
      state.recentBooks.forEach(book => {
        const button = actionButton('openBook', book.name, { path: book.path }, 'list-item');
        if (book.path === state.currentBookPath) button.classList.add('current');
        const subtitle = document.createElement('span');
        subtitle.className = 'list-subtitle';
        subtitle.textContent = book.folder;
        button.append(subtitle);
        button.addEventListener('contextmenu', event => {
          event.preventDefault();
          event.stopPropagation();
          contextBookPath = book.path;
          showFloatingMenu(elements.bookContextMenu, event, 44);
        });
        elements.modalContent.append(button);
      });
    } else if (modalType === 'chapters') {
      elements.modalTitle.textContent = '章节目录';
      if (!state.chapters.length) return showEmpty('当前书籍没有可识别的章节');
      state.chapters.forEach((chapter, index) => {
        const button = actionButton('openChapter', chapter.title, { index }, 'list-item');
        if (index === state.currentChapterIndex) button.classList.add('current');
        elements.modalContent.append(button);
      });
    } else if (modalType === 'bookmarks') {
      elements.modalTitle.textContent = '书签';
      if (!state.records.length) return showEmpty('还没有保存书签');
      state.records.forEach(record => elements.modalContent.append(bookmarkElement(record)));
    }
  }

  function bookmarkElement(record) {
    const article = document.createElement('article');
    article.className = 'bookmark';
    article.title = '双击跳转，右键复制或删除';
    const title = document.createElement('div');
    title.className = 'bookmark-title';
    title.textContent = `${removeExtension(record.bookTitle)} | ${record.chapterTitle || '正文'}`;
    const text = document.createElement('div');
    text.className = 'bookmark-text';
    text.textContent = record.text;
    article.append(title, text);
    article.addEventListener('dblclick', () => {
      vscode.postMessage({ type: 'openBookmark', id: record.id });
      elements.modal.close();
    });
    article.addEventListener('contextmenu', event => {
      event.preventDefault();
      event.stopPropagation();
      contextBookmarkId = record.id;
      showFloatingMenu(elements.bookmarkContextMenu, event, 104);
    });
    return article;
  }

  function actionButton(action, label, data = {}, className = '') {
    const button = document.createElement('button');
    button.dataset.action = action;
    Object.entries(data).forEach(([key, value]) => { button.dataset[key] = String(value); });
    button.textContent = label;
    button.className = className;
    return button;
  }

  function showEmpty(text) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = text;
    elements.modalContent.append(empty);
  }

  function bookmarkClipboardText(record) {
    return `${removeExtension(record.bookTitle)} | ${record.chapterTitle || '正文'}\n${record.text}`;
  }
  function showFloatingMenu(menu, event, menuHeight) {
    hideContextMenus();
    const left = Math.min(event.clientX, window.innerWidth - 150);
    const top = Math.min(event.clientY, window.innerHeight - menuHeight);
    menu.style.left = `${Math.max(0, left)}px`;
    menu.style.top = `${Math.max(0, top)}px`;
    menu.classList.remove('hidden');
  }
  function hideContextMenu() { elements.contextMenu.classList.add('hidden'); }
  function hideContextMenus() {
    elements.contextMenu.classList.add('hidden');
    elements.bookmarkContextMenu.classList.add('hidden');
    elements.bookContextMenu.classList.add('hidden');
  }
  function numberValue(element, fallback) { const value = Number(element.value); return Number.isFinite(value) ? value : fallback; }
  function updateStatusWidthControl() {
    const minimum = numberValue({ value: elements.statusWidth.min }, 0);
    const maximum = numberValue({ value: elements.statusWidth.max }, 100);
    const value = numberValue(elements.statusWidth, minimum);
    const progress = maximum > minimum ? ((value - minimum) / (maximum - minimum)) * 100 : 0;
    elements.statusWidthValue.textContent = String(value);
    elements.statusWidth.style.setProperty('--range-progress', `${Math.max(0, Math.min(100, progress))}%`);
  }
  function ensureSelectOption(select, value) {
    if (!Array.from(select.options).some(option => option.value === value)) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      select.append(option);
    }
  }
  function sanitizeStoredToolbarHeights() {
    const maximum = Math.max(80, window.innerHeight - 60);
    if (Number.isFinite(webviewState.toolbarHeight)) webviewState.toolbarHeight = Math.max(58, Math.min(maximum, webviewState.toolbarHeight));
    if (Number.isFinite(webviewState.readingModeHeight)) webviewState.readingModeHeight = Math.max(28, Math.min(maximum, webviewState.readingModeHeight));
    vscode.setState(webviewState);
  }
  function applyStoredToolbarHeight() {
    if (settingsVisible && !readingMode) {
      const available = Math.max(120, window.innerHeight - 24);
      const height = Math.min(available, Math.max(150, Math.round(window.innerHeight * 0.72)));
      elements.toolbar.style.height = `${height}px`;
      elements.toolbar.style.overflow = 'hidden';
      return;
    }
    const height = readingMode ? webviewState.readingModeHeight : webviewState.toolbarHeight;
    if (Number.isFinite(height)) {
      elements.toolbar.style.height = `${height}px`;
      elements.toolbar.style.overflow = 'auto';
    } else {
      elements.toolbar.style.removeProperty('height');
      elements.toolbar.style.removeProperty('overflow');
    }
  }
  function shorten(value, max) { return value && value.length > max ? `${value.slice(0, max - 3)}...` : (value || ''); }
  function removeExtension(value) { return value.replace(/\.[^.]+$/, ''); }
  function themeColors(theme) {
    if (theme === 'paper') return { background: '#F5F0E8', text: '#3A3A3A' };
    if (theme === 'ink') return { background: '#DCE1E8', text: '#2C3E50' };
    if (theme === 'night') return { background: '#1E1E1E', text: '#D4D4D4' };
    return undefined;
  }

  vscode.postMessage({ type: 'ready' });
})();
