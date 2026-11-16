import Dexie, { type Table } from 'dexie';
import type { Book, Word, CardState, ReviewLog, Settings, Collection } from './types';

export class WordDB extends Dexie {
  books!: Table<Book, number>;
  words!: Table<Word, number>;
  cardState!: Table<CardState, number>;
  reviewLog!: Table<ReviewLog, number>;
  collections!: Table<Collection, number>;
  settings!: Table<Settings, string>;

  constructor() {
    super('ielts-words');
    this.version(1).stores({
      books: '++id, name',
      words: '++id, bookId, word, category',
      cardState: 'wordId, due',
      reviewLog: '++id, wordId, ts, sessionType',
      collections: '++id, name',
      settings: 'key',
    });
  }
}

export const db = new WordDB();

export const DEFAULT_SETTINGS: Settings = {
  key: 'app',
  dailyNew: 30,
  showDefDefault: false,
  autoSpeak: true,
  ttsRate: 0.9,
  strategy: 'ebbinghaus',
};

let settingsCache: Settings | null = null;

/** 仅在 App 启动时调用：确保 settings 表有种子。含写操作，勿放进 useLiveQuery。 */
export async function seedSettings(): Promise<void> {
  const s = await db.settings.get('app');
  if (!s) await db.settings.put(DEFAULT_SETTINGS);
  settingsCache = { ...DEFAULT_SETTINGS, ...(s ?? {}) };
}

/** 纯读，可安全用于 useLiveQuery。设置变更经 liveQuery 监听 settings 表刷新缓存。 */
export function getSettingsSync(): Settings {
  return settingsCache ?? DEFAULT_SETTINGS;
}

export async function getSettings(): Promise<Settings> {
  if (settingsCache) return settingsCache;
  const s = await db.settings.get('app');
  settingsCache = { ...DEFAULT_SETTINGS, ...(s ?? {}) };
  return settingsCache;
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const cur = getSettingsSync();
  const next = { ...cur, ...patch };
  await db.settings.put(next);
  settingsCache = next;
}
