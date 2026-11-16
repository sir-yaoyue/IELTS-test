import { db } from '../db';
import { hashBookWords, parseMdBook } from './importers';
import vol1Raw from '../../data/vol1.md?raw';
import vol2Raw from '../../data/vol2.md?raw';
import vol3Raw from '../../data/vol3.md?raw';
import vol4Raw from '../../data/vol4.md?raw';

const SEEDS = [
  { name: '核心200词', raw: vol1Raw },
  { name: '册2', raw: vol2Raw },
  { name: '册3', raw: vol3Raw },
  { name: '册4', raw: vol4Raw },
];

export interface SeedResult {
  bookName: string;
  total: number;
  skipped: boolean;
  /** 本次新增的词数（增量同步时 >0 表示词书有更新） */
  added: number;
}

/**
 * 首次启动 / 每次加载：导入或**增量同步**内置词书。
 * - 词书不存在 → 新建并写入 contentHash
 * - 已存在且 contentHash 相同 → 跳过（无更新）
 * - 已存在但 contentHash 不同 → 增量同步：补入新词、更新变了的词，**保留所有已有词的记忆数据**（cardState/reviewLog 不动）
 * 这样老用户刷新页面即可拿到新词（如新增册、补全词表），进度不丢。
 */
export async function seedBuiltInBooks(): Promise<SeedResult[]> {
  const out: SeedResult[] = [];
  for (const s of SEEDS) {
    const parsed = parseMdBook(s.raw, s.name);
    const hash = hashBookWords(parsed.words);

    const existing = await db.books.where('name').equals(s.name).first();
    if (!existing) {
      const bookId = await db.books.add({ name: s.name, source: 'built-in', created: Date.now(), contentHash: hash });
      const added = await importWords(bookId, parsed.words);
      out.push({ bookName: s.name, total: added, skipped: false, added });
      continue;
    }

    // 已存在：比对指纹
    if (existing.contentHash === hash) {
      const total = await db.words.where('bookId').equals(existing.id!).count();
      out.push({ bookName: s.name, total, skipped: true, added: 0 });
      continue;
    }

    // 指纹不同 → 增量同步
    const bookId = existing.id!;
    const curWords = await db.words.where('bookId').equals(bookId).toArray();
    const curByKey = new Map(curWords.map((w) => [w.word.trim().toLowerCase(), w]));
    let added = 0;
    let updated = 0;
    for (const w of parsed.words) {
      const key = w.word.trim().toLowerCase();
      if (!key) continue;
      const cur = curByKey.get(key);
      if (!cur) {
        await db.words.add({ bookId, word: w.word, phonetic: w.phonetic, definition: w.definition, example: w.example, category: w.category, isPhrase: w.isPhrase });
        added += 1;
      } else if (
        cur.phonetic !== w.phonetic ||
        cur.definition !== w.definition ||
        cur.example !== w.example ||
        cur.category !== w.category
      ) {
        // 更新词条内容（记忆数据 cardState 按 wordId 关联，不受影响）
        await db.words.update(cur.id!, { phonetic: w.phonetic, definition: w.definition, example: w.example, category: w.category, isPhrase: w.isPhrase });
        updated += 1;
      }
    }
    await db.books.update(bookId, { contentHash: hash });
    const total = await db.words.where('bookId').equals(bookId).count();
    out.push({ bookName: s.name, total, skipped: false, added });
    void updated;
  }
  return out;
}

async function importWords(bookId: number, parsed: ReturnType<typeof parseMdBook>['words']): Promise<number> {
  const seen = new Set<string>();
  let count = 0;
  for (const w of parsed) {
    const key = w.word.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    await db.words.add({ bookId, word: w.word, phonetic: w.phonetic, definition: w.definition, example: w.example, category: w.category, isPhrase: w.isPhrase });
    count += 1;
  }
  return count;
}
