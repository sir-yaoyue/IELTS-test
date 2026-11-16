// 解析器自检：node test-parse.mjs（esbuild 打包后运行）
import { readFileSync } from 'node:fs';
import { parseMdBook, parseCsvBook } from './src/lib/importers.ts';

const r1 = parseMdBook(readFileSync('data/vol1.md', 'utf8'), '核心200词');
const r2 = parseMdBook(readFileSync('data/vol2.md', 'utf8'), '册2');

console.log(`vol1: ${r1.words.length} 条 | vol2: ${r2.words.length} 条`);

const cats = new Map<string, number>();
for (const w of [...r1.words, ...r2.words]) cats.set(w.category, (cats.get(w.category) ?? 0) + 1);
for (const [k, v] of cats) console.log(`  ${k}: ${v}`);

console.log('样例单词:', JSON.stringify(r1.words[0]));
const phrase = r1.words.find((w) => w.word === 'play a role in');
console.log('样例短语:', JSON.stringify(phrase));
const dup = r1.words.filter((w) => w.word.toLowerCase() === 'moreover');
console.log(`moreover 出现次数（应=1，去重后保留单词行）: ${dup.length}`);
const badCat = [...r1.words, ...r2.words].filter((w) => /进度|检查点|排期|策略/.test(w.category));
console.log(`误入的非词表行（应=0）: ${badCat.length}`);
if (badCat.length) console.log(badCat.slice(0, 3));

// CSV 表头模式
const csv = parseCsvBook('单词,音标,中文,例句,分类\nhello,/həˈloʊ/,你好,Hello world.,测试\n');
console.log('CSV 解析:', JSON.stringify(csv.words));
// 纯 txt 模式
const txt = parseCsvBook('apple\nbanana\n');
console.log('TXT 解析:', JSON.stringify(txt.words));
