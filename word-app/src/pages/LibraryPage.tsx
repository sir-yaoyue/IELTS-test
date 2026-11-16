import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, saveSettings } from '../db';
import { parseCsvBook, parseMdBook } from '../lib/importers';
import type { Word } from '../types';
import { useSettings } from '../App';
import WordDetail from './WordDetail';

export default function LibraryPage() {
  const books = useLiveQuery(() => db.books.toArray(), []);
  const words = useLiveQuery(() => db.words.toArray(), []);
  const states = useLiveQuery(() => db.cardState.toArray(), []);
  const settings = useSettings();
  const fileRef = useRef<HTMLInputElement>(null);
  const backupRef = useRef<HTMLInputElement>(null);
  const mergeRef = useRef<HTMLInputElement>(null);
  const [bookName, setBookName] = useState('');
  const [msg, setMsg] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [detail, setDetail] = useState<Word | null>(null);

  if (!books || !words || !states) {
    return <div className="text-slate-400 py-10 text-center">加载中…</div>;
  }

  const stOf = new Map<number, (typeof states)[number]>();
  for (const s of states) stOf.set(s.wordId, s);

  const onWordFile = async (f: File) => {
    const text = await f.text();
    const lower = f.name.toLowerCase();
    const parsed = lower.endsWith('.md') ? parseMdBook(text) : parseCsvBook(text);
    const name = bookName.trim() || parsed.name || f.name.replace(/\.(md|csv|txt)$/i, '');
    const bookId = await db.books.add({ name, source: 'file', created: Date.now() });
    const seen = new Set<string>();
    const rows: Omit<Word, 'id'>[] = [];
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
        category: w.category || '未分组',
        isPhrase: w.isPhrase,
      });
    }
    await db.words.bulkAdd(rows);
    setMsg(`✅ 已添加词书「${name}」：${rows.length} 条（去重 ${parsed.words.length - rows.length} 条）`);
    setBookName('');
  };

  const removeBook = async (id: number, name: string) => {
    if (!window.confirm(`删除词书「${name}」及其全部记忆数据？`)) return;
    const ids = words.filter((w) => w.bookId === id).map((w) => w.id!);
    const idSet = new Set(ids);
    await db.transaction('rw', db.words, db.cardState, db.reviewLog, db.books, async () => {
      await db.words.where('bookId').equals(id).delete();
      for (const s of states.filter((s) => idSet.has(s.wordId))) await db.cardState.delete(s.wordId);
      if (ids.length) await db.reviewLog.where('wordId').anyOf(ids).delete();
      await db.books.delete(id);
    });
    setMsg(`已删除词书「${name}」`);
  };

  const exportJson = async () => {
    const data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      books: await db.books.toArray(),
      words: await db.words.toArray(),
      cardState: await db.cardState.toArray(),
      reviewLog: await db.reviewLog.toArray(),
      settings: await db.settings.toArray(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `wordbook-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    setMsg('✅ 备份已导出');
  };

  const importJson = async (f: File) => {
    try {
      const data = JSON.parse(await f.text());
      if (!data || data.version !== 1 || !Array.isArray(data.books)) throw new Error('不是有效的备份文件');
      if (!window.confirm('恢复备份将替换当前全部数据，继续？')) return;
      await db.transaction('rw', db.books, db.words, db.cardState, db.reviewLog, db.settings, async () => {
        await db.books.clear();
        await db.words.clear();
        await db.cardState.clear();
        await db.reviewLog.clear();
        await db.settings.clear();
        if (data.books?.length) await db.books.bulkAdd(data.books);
        if (data.words?.length) await db.words.bulkAdd(data.words);
        if (data.cardState?.length) await db.cardState.bulkAdd(data.cardState);
        if (data.reviewLog?.length) await db.reviewLog.bulkAdd(data.reviewLog);
        if (data.settings?.length) await db.settings.bulkAdd(data.settings);
      });
      window.location.reload();
    } catch (e) {
      setMsg(`❌ 恢复失败：${String(e)}`);
    }
  };

  /** M7：合并导入——保留本地数据，按「词书名+词」去重，把备份里新的词/记忆合并进来。
   *  备份的 word.id 与新库冲突时重映射：cardState/reviewLog 的 wordId 跟随新 id。 */
  const mergeImport = async (f: File) => {
    try {
      const data = JSON.parse(await f.text());
      if (!data || data.version !== 1 || !Array.isArray(data.books)) throw new Error('不是有效的备份文件');
      if (!window.confirm('合并导入：保留本地数据，把备份里新的词与记忆进度合并进来（按词书名+词去重）。继续？')) return;

      // 现有数据
      const curBooks = await db.books.toArray();
      const curWords = await db.words.toArray();
      const curStates = await db.cardState.toArray();
      const curLog = await db.reviewLog.toArray();

      // 本地「词书名→id」与「bookId|word小写→wordId」索引
      const bookByName = new Map(curBooks.map((b) => [b.name, b.id!]));
      const wordKey = (bookId: number, w: string) => `${bookId}|${w.trim().toLowerCase()}`;
      const wordIndex = new Map(curWords.map((w) => [wordKey(w.bookId, w.word), w.id!]));

      const newBooks = [];
      const newWords = [];
      const idRemap = new Map<number, number>(); // 备份 wordId → 本地 wordId
      const newStates: typeof curStates = [];
      const newLog: typeof curLog = [];

      // 1. 词书：同名复用本地 id，新名分配
      const bookIdMap = new Map<number, number>(); // 备份 bookId → 本地 bookId
      for (const b of data.books ?? []) {
        const existing = bookByName.get(b.name);
        const localId = existing ?? (await db.books.add({ name: b.name, source: 'file', created: b.created ?? Date.now() }));
        bookIdMap.set(b.id, localId);
        if (!existing) newBooks.push(b.name);
      }

      // 2. 词：已存在→复用本地 id（记入 remap）；新词→插入
      for (const w of data.words ?? []) {
        const localBookId = bookIdMap.get(w.bookId) ?? w.bookId;
        const key = wordKey(localBookId, w.word);
        const existingId = wordIndex.get(key);
        if (existingId != null) {
          idRemap.set(w.id, existingId);
        } else {
          const nid = await db.words.add({ bookId: localBookId, word: w.word, phonetic: w.phonetic, definition: w.definition, example: w.example, category: w.category, isPhrase: w.isPhrase, audio: w.audio });
          idRemap.set(w.id, nid);
          newWords.push(w.word);
        }
      }

      // 3. 记忆档案：备份里对应词本地没有 cardState 才并入（本地进度优先）
      const localStateByWord = new Map(curStates.map((s) => [s.wordId, s]));
      for (const s of data.cardState ?? []) {
        const localWordId = idRemap.get(s.wordId);
        if (localWordId == null || localStateByWord.has(localWordId)) continue;
        newStates.push({ ...s, wordId: localWordId });
      }

      // 4. 复习日志：全部并入（重映射 wordId），id 由 ++id 重新分配
      for (const l of data.reviewLog ?? []) {
        const localWordId = idRemap.get(l.wordId);
        if (localWordId == null) continue;
        newLog.push({ wordId: localWordId, ts: l.ts, stage: l.stage, grade: l.grade, sessionType: l.sessionType });
      }

      if (newStates.length) await db.cardState.bulkAdd(newStates);
      if (newLog.length) await db.reviewLog.bulkAdd(newLog);

      setMsg(`✅ 合并完成：新词书 ${newBooks.length} · 新词 ${newWords.length} · 记忆档案 ${newStates.length} · 日志 ${newLog.length}`);
    } catch (e) {
      setMsg(`❌ 合并失败：${String(e)}`);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">词库与设置</h1>

      {msg && <div className="text-sm bg-slate-100 text-slate-600 rounded-xl px-4 py-2.5">{msg}</div>}

      <section className="space-y-3">
        <div className="text-sm font-medium text-slate-600">词书</div>
        {books.map((b) => {
          const bw = words.filter((w) => w.bookId === b.id);
          const bl = bw.filter((w) => stOf.get(w.id!)?.firstStudy != null).length;
          const isOpen = expanded === b.id;
          // 按话题组分组（保持原顺序）
          const byCat = new Map<string, Word[]>();
          for (const w of bw) {
            const arr = byCat.get(w.category) ?? [];
            arr.push(w);
            byCat.set(w.category, arr);
          }
          return (
            <div key={b.id} className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="p-4 flex items-center justify-between gap-3">
                <button onClick={() => setExpanded(isOpen ? null : b.id!)} className="min-w-0 text-left flex-1">
                  <div className="font-medium truncate flex items-center gap-1.5">
                    <span className="text-slate-400 text-xs">{isOpen ? '▾' : '▸'}</span>
                    {b.name}
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5 tabular-nums">
                    {bw.length} 条 · 已学 {bl} · {b.source === 'built-in' ? '内置' : '导入'} · 点词看复习轨迹
                  </div>
                </button>
                <button onClick={() => removeBook(b.id!, b.name)} className="text-xs text-slate-400 hover:text-rose-500 shrink-0 px-2 py-1 rounded-lg hover:bg-rose-50">
                  删除
                </button>
              </div>
              {isOpen && (
                <div className="border-t border-slate-100 max-h-[420px] overflow-y-auto divide-y divide-slate-50">
                  {[...byCat.entries()].map(([cat, catWords]) => (
                    <div key={cat} className="px-4 py-2">
                      <div className="text-[11px] font-medium text-slate-400 mb-1.5">
                        {cat} · {catWords.length}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {catWords.map((w) => {
                          const s = stOf.get(w.id!);
                          const tag = s?.mastered ? 'bg-emerald-100 text-emerald-700' : s?.firstStudy != null ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-500';
                          return (
                            <button
                              key={w.id}
                              onClick={() => setDetail(w)}
                              className={`text-xs px-2 py-1 rounded-lg ${tag} hover:opacity-80`}
                              title={w.definition}
                            >
                              {w.word}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
          <div className="text-sm font-medium text-slate-600">导入新词书</div>
          <input
            value={bookName}
            onChange={(e) => setBookName(e.target.value)}
            placeholder="词书名称（可选，默认取文件名）"
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm"
          />
          <input
            ref={fileRef}
            type="file"
            accept=".md,.csv,.txt"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onWordFile(f);
              e.target.value = '';
            }}
          />
          <button onClick={() => fileRef.current?.click()} className="w-full py-2.5 rounded-xl border border-slate-300 text-sm hover:bg-slate-50">
            选择文件（.md / .csv / .txt）
          </button>
          <p className="text-xs text-slate-400">
            CSV 列：单词,音标,中文,例句,分类（首行可写表头）；md 需含「单词/短语 + 中文」表头的表格。
          </p>
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-2xl p-4 space-y-4">
        <div className="text-sm font-medium text-slate-600">设置</div>
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="text-sm space-y-1 block">
            <span className="text-slate-500">每日新词配额</span>
            <input
              type="number"
              min={1}
              max={200}
              value={settings.dailyNew}
              onChange={(e) => saveSettings({ dailyNew: Math.max(1, Number(e.target.value) || 30) })}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 bg-white"
            />
          </label>
          <label className="text-sm space-y-1 block">
            <span className="text-slate-500">记忆策略</span>
            <select
              value={settings.strategy}
              onChange={(e) => saveSettings({ strategy: e.target.value as 'ebbinghaus' | 'sm2' })}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 bg-white"
            >
              <option value="ebbinghaus">艾宾浩斯固定 1-3-7-15-30</option>
              <option value="sm2">SM-2 动态间隔（Anki 式）</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={settings.showDefDefault}
              onChange={(e) => saveSettings({ showDefDefault: e.target.checked })}
              className="w-4 h-4"
            />
            默认显示释义（关 = 先记词再翻转）
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={settings.autoSpeak}
              onChange={(e) => saveSettings({ autoSpeak: e.target.checked })}
              className="w-4 h-4"
            />
            自动朗读
          </label>
          <label className="text-sm space-y-1 block sm:col-span-2">
            <span className="text-slate-500">朗读语速 {settings.ttsRate.toFixed(1)}x</span>
            <input
              type="range"
              min={0.5}
              max={1.5}
              step={0.1}
              value={settings.ttsRate}
              onChange={(e) => saveSettings({ ttsRate: Number(e.target.value) })}
              className="w-full"
            />
          </label>
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
        <div className="text-sm font-medium text-slate-600">数据</div>
        <div className="grid grid-cols-2 gap-3">
          <button onClick={exportJson} className="py-2.5 rounded-xl border border-slate-300 text-sm hover:bg-slate-50">
            导出备份（JSON）
          </button>
          <button onClick={() => backupRef.current?.click()} className="py-2.5 rounded-xl border border-slate-300 text-sm hover:bg-slate-50">
            恢复备份（替换）
          </button>
        </div>
        <button onClick={() => mergeRef.current?.click()} className="w-full py-2.5 rounded-xl border border-emerald-300 text-sm text-emerald-700 hover:bg-emerald-50">
          合并导入（保留本地，按词去重）
        </button>
        <input
          ref={backupRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importJson(f);
            e.target.value = '';
          }}
        />
        <input
          ref={mergeRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) mergeImport(f);
            e.target.value = '';
          }}
        />
        <p className="text-xs text-slate-400">备份含全部词库与记忆进度。「恢复」替换当前数据；「合并导入」保留本地、并入备份里新的词与进度（跨设备带进度用合并）。</p>
      </section>

      {detail && <WordDetail word={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}
