import { db } from '../db';
import { parseMdBook } from './importers';
import vol1Raw from '../../data/vol1.md?raw';
import vol2Raw from '../../data/vol2.md?raw';

const SEEDS = [
  { name: '核心200词', raw: vol1Raw },
  { name: '册2', raw: vol2Raw },
];

export interface SeedResult {
  bookName: string;
  total: number;
  skipped: boolean;
}

/** 首次启动：导入内置词书（已存在则跳过，保留记忆数据） */
export async function seedBuiltInBooks(): Promise<SeedResult[]> {
  const out: SeedResult[] = [];
  for (const s of SEEDS) {
    const parsed = parseMdBook(s.raw, s.name);
    const existing = await db.books.where('name').equals(s.name).first();
    if (existing) {
      const total = await db.words.where('bookId').equals(existing.id!).count();
      out.push({ bookName: s.name, total, skipped: true });
      continue;
    }
    const bookId = await db.books.add({ name: s.name, source: 'built-in', created: Date.now() });
    const seen = new Set<string>();
    const rows: { bookId: number; word: string; phonetic: string; definition: string; example: string; category: string; isPhrase: boolean }[] = [];
    for (const w of parsed.words) {
      const key = w.word.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      rows.push({
        bookId,
        word: w.word,
        phonetic: w.phonetic,
        definition: w.definition,
        example: w.example,
        category: w.category,
        isPhrase: w.isPhrase,
      });
    }
    await db.words.bulkAdd(rows);
    out.push({ bookName: s.name, total: rows.length, skipped: false });
  }
  return out;
}
