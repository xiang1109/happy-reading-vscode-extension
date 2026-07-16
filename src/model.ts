export type ReaderLocation = 'panel' | 'statusBar';
export type ReaderTheme = 'paper' | 'night' | 'ink' | 'custom';

export interface ReaderSettings {
  pageLines: number;
  charsPerLine: number;
  location: ReaderLocation;
}

export interface ReaderAppearance {
  theme: ReaderTheme;
  fontFamily: string;
  fontSize: number;
  textColor: string;
  backgroundColor: string;
}

export interface ReaderChapter {
  title: string;
  offset: number;
}

export interface ReadingRecord {
  id: number;
  bookTitle: string;
  text: string;
  bookPath: string;
  position: number;
  chapterTitle: string;
}

export interface RecentBook {
  name: string;
  path: string;
  folder: string;
}

export interface ReaderViewState {
  title: string;
  page: string;
  position: number;
  totalChars: number;
  currentBookPath: string;
  currentChapterIndex: number;
  chapters: ReaderChapter[];
  recentBooks: RecentBook[];
  records: ReadingRecord[];
  settings: ReaderSettings;
  appearance: ReaderAppearance;
  autoPage: boolean;
  statusBarEnabled: boolean;
  statusWidth: number;
}
