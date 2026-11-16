import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { Word } from '../types';
import { buildSession, type Scope, type SessionItem, type SessionOpts } from '../lib/session';
import { dayKey, isLapsed, startOfDay } from '../lib/srs';
import { useSettings } from '../App';

const DAY = 86_400_000;

export default function TodayPage({ onStart, onQuiz }: { onStart: (items: SessionItem[]) => void; onQuiz: (words: Word[]) => void }) {
  const [scope, setScope] = useState<Scope>({ bookId: null, category: null });
  const [busy, setBusy] = useState(false);
  const books = useLiveQuery(() => db.books.toArray(), []);
  const words = useLiveQuery(() => db.words.toArray(), []);
  const states = useLiveQuery(() => db.cardState.toArray(), []);
  const log = useLiveQuery(() => db.reviewLog.toArray(), []);
  const settings = useSettings();
  // 本次会话的新词数量（用户可自选，默认取全局配额）
  const [sessionNew, setSessionNew] = useState<number | null>(null);
  const sessionQuota = sessionNew ?? settings.dailyNew;
  // 选词（购物车）—— sessionStorage 持久化，切页/刷新不丢，关浏览器才清
  const [picked, setPickedRaw] = useState<Set<number>>(() => {
    try {
      const raw = sessionStorage.getItem('wordapp-picked');
      return raw ? new Set(JSON.parse(raw) as number[]) : new Set();
    } catch {
      return new Set();
    }
  });
  const setPicked = (updater: Set<number> | ((prev: Set<number>) => Set<number>)) => {
    setPickedRaw((prev) => {
      const next = typeof updater === 'function' ? (updater as (p: Set<number>) => Set<number>)(prev) : updater;
      try {
        sessionStorage.setItem('wordapp-picked', JSON.stringify([...next]));
      } catch {
        /* 忽略存储失败 */
      }
      return next;
    });
  };
  const [showPicker, setShowPicker] = useState(false);
  const [search, setSearch] = useState('');

  if (!books || !words || !states || !log) {
    return <div className="text-slate-400 py-10 text-center">加载中…</div>;
  }

  const now = Date.now();
  const dayStart = startOfDay(now);
  const stOf = new Map<number, (typeof states)[number]>();
  for (const s of states) stOf.set(s.wordId, s);
  const inScope = (w: (typeof words)[number]) =>
    (scope.bookId == null || w.bookId === scope.bookId) &&
    (scope.category == null || w.category === scope.category);
  const scoped = words.filter(inScope);

  const dueItems = scoped.filter((w) => {
    const s = stOf.get(w.id!);
    return s && !s.mastered && s.due != null && s.due <= now && !isLapsed(s);
  });
  const lapsedItems = scoped.filter((w) => {
    const s = stOf.get(w.id!);
    return s && isLapsed(s);
  });
  const unlearned = scoped.filter((w) => !stOf.get(w.id!));
  const masteredCount = scoped.filter((w) => stOf.get(w.id!)?.mastered).length;
  const learnedWords = scoped.filter((w) => {
    const s = stOf.get(w.id!);
    return s && s.firstStudy != null && !s.mastered && w.definition;
  });

  const todayNew = log.filter((l) => l.sessionType === 'new' && l.ts >= dayStart).length;
  const todayTotal = log.filter((l) => l.ts >= dayStart).length;
  const remainingQuota = Math.max(0, settings.dailyNew - todayNew);

  const daySet = new Set(log.map((l) => dayKey(l.ts)));
  let streak = 0;
  let d = dayStart;
  if (!daySet.has(dayKey(now))) d -= DAY;
  while (daySet.has(dayKey(d))) {
    streak += 1;
    d -= DAY;
  }

  const categories = [...new Set(scoped.map((w) => w.category))];

  const start = async (opts: SessionOpts) => {
    setBusy(true);
    try {
      const pickedIds = picked.size > 0 ? [...picked] : undefined;
      const items = await buildSession(scope, { ...opts, pickedIds }, sessionQuota);
      if (items.length === 0) {
        window.alert('当前范围没有可学内容');
        return;
      }
      // 开始学习后清空购物车（这些词已入会话，学完进 cardState）
      // 同步清 sessionStorage，避免 TodayPage 卸载后重新挂载读到旧值
      try {
        sessionStorage.removeItem('wordapp-picked');
      } catch {
        /* 忽略 */
      }
      setPicked(new Set());
      onStart(items);
    } finally {
      setBusy(false);
    }
  };

  // 新词数：有勾选=勾选数；无勾选=按配额顺序取
  const sessionNewCount = picked.size > 0 ? picked.size : Math.min(unlearned.length, sessionQuota);
  const primaryCount = dueItems.length + lapsedItems.length + sessionNewCount;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">今日</h1>
          <p className="text-sm text-slate-500 mt-1 tabular-nums">
            {new Date().getMonth() + 1}月{new Date().getDate()}日 · 今天已学 {todayTotal} 个
          </p>
        </div>
        {streak > 0 && (
          <span className="text-sm bg-orange-50 text-orange-600 px-3 py-1.5 rounded-full font-medium">🔥 连续 {streak} 天</span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="新词剩余" value={remainingQuota} sub={`配额 ${settings.dailyNew}/天`} tone="sky" />
        <Stat label="待复习" value={dueItems.length} sub="含当日巩固" tone="violet" />
        <Stat label="错词本" value={lapsedItems.length} sub="待再确认" tone="rose" />
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
        <div className="text-sm font-medium text-slate-600">学习范围</div>
        <div className="grid sm:grid-cols-2 gap-3">
          <select
            value={scope.bookId ?? ''}
            onChange={(e) => setScope({ bookId: e.target.value ? Number(e.target.value) : null, category: null })}
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white"
          >
            <option value="">全部词书</option>
            {books.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <select
            value={scope.category ?? ''}
            onChange={(e) => setScope((s) => ({ ...s, category: e.target.value || null }))}
            disabled={categories.length === 0}
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white disabled:bg-slate-50 disabled:text-slate-400"
          >
            <option value="">全部话题组</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-xs text-slate-500 shrink-0">本次新词数量</span>
          <input
            type="number"
            min={1}
            max={200}
            value={sessionQuota}
            onChange={(e) => setSessionNew(Math.max(1, Number(e.target.value) || 1))}
            className="w-20 border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm tabular-nums bg-white"
            aria-label="本次新词数量"
          />
          <button
            onClick={() => setShowPicker((v) => !v)}
            className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${
              picked.size > 0 ? 'bg-emerald-500 text-white' : showPicker ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {picked.size > 0 ? `已选 ${picked.size} 词` : '选词'}
          </button>
          <span className="text-xs text-slate-400">{picked.size > 0 ? '学选中的词' : '不选词则按数量顺序取'}</span>
        </div>
        <div className="text-xs text-slate-400 tabular-nums">
          范围内：未学 {unlearned.length} · 已掌握 {masteredCount}
        </div>

        {/* 选词面板（购物车）：只列范围内未学新词 */}
        {showPicker && (
          <div className="border-t border-slate-100 pt-3 mt-1 space-y-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索单词 / 释义…"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
            />
            <PickerList
              words={unlearned}
              search={search}
              picked={picked}
              onToggle={(id) =>
                setPicked((prev) => {
                  const n = new Set(prev);
                  n.has(id) ? n.delete(id) : n.add(id);
                  return n;
                })
              }
            />
            <div className="flex items-center gap-2">
              <button onClick={() => setPicked(new Set())} disabled={picked.size === 0} className="text-xs text-slate-500 px-3 py-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-40">
                清空选择
              </button>
              <button
                onClick={() => {
                  setShowPicker(false);
                  start({ reviews: true, news: true, lapsed: true });
                }}
                disabled={picked.size === 0 || busy}
                className="ml-auto text-xs bg-emerald-500 text-white px-4 py-1.5 rounded-lg hover:bg-emerald-600 disabled:opacity-40"
              >
                开始学选中的词
              </button>
            </div>
          </div>
        )}
      </div>

      <button
        disabled={busy || primaryCount === 0}
        onClick={() => start({ reviews: true, news: true, lapsed: true })}
        className="w-full py-4 rounded-2xl bg-slate-900 text-white text-lg font-semibold disabled:opacity-40 hover:bg-slate-800 transition-colors"
      >
        {busy ? '准备中…' : primaryCount > 0 ? `开始今日学习（${primaryCount} 个）` : '今天没有可学内容 🎉'}
      </button>

      <div className="grid grid-cols-3 gap-3">
        <QuickBtn label="只复习" count={dueItems.length} disabled={busy} onClick={() => start({ reviews: true, news: false, lapsed: false })} />
        <QuickBtn label="错词本" count={lapsedItems.length} disabled={busy} onClick={() => start({ reviews: false, news: false, lapsed: true })} />
        <QuickBtn
          label="只学新词"
          count={sessionNewCount}
          showCount={false}
          subBelow={unlearned.length > 0 ? `范围内 ${unlearned.length} 未学` : ''}
          disabled={busy}
          onClick={() => start({ reviews: false, news: true, lapsed: false })}
        />
      </div>

      <button
        disabled={learnedWords.length === 0}
        onClick={() => onQuiz(learnedWords.sort(() => Math.random() - 0.5).slice(0, 20))}
        className="w-full py-3 rounded-2xl border border-slate-200 bg-white text-sm text-slate-600 disabled:opacity-40 hover:border-slate-300 transition-colors tabular-nums"
      >
        📝 自测（看词选义）· 抽 20 个已学词
      </button>
    </div>
  );
}

const TONES = {
  sky: 'bg-sky-50 text-sky-700',
  violet: 'bg-violet-50 text-violet-700',
  rose: 'bg-rose-50 text-rose-700',
} as const;

function Stat({ label, value, sub, tone }: { label: string; value: number; sub: string; tone: keyof typeof TONES }) {
  return (
    <div className={`rounded-2xl p-4 ${TONES[tone]}`}>
      <div className="text-xs opacity-70">{label}</div>
      <div className="text-3xl font-bold tabular-nums mt-1">{value}</div>
      <div className="text-xs opacity-60 mt-1">{sub}</div>
    </div>
  );
}

/** 选词面板词列表：按话题组分组，可搜索，每词一个勾选框 */
function PickerList({ words, search, picked, onToggle }: { words: Word[]; search: string; picked: Set<number>; onToggle: (id: number) => void }) {
  const q = search.trim().toLowerCase();
  const filtered = q ? words.filter((w) => w.word.toLowerCase().includes(q) || w.definition.toLowerCase().includes(q)) : words;
  // 按 category 分组（保持原顺序）
  const byCat = new Map<string, Word[]>();
  for (const w of filtered) {
    const arr = byCat.get(w.category) ?? [];
    arr.push(w);
    byCat.set(w.category, arr);
  }
  if (filtered.length === 0) return <div className="text-xs text-slate-400 text-center py-4">无匹配的词</div>;
  return (
    <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 rounded-xl border border-slate-100">
      {[...byCat.entries()].map(([cat, catWords]) => (
        <div key={cat}>
          <div className="sticky top-0 bg-slate-50 px-3 py-1.5 text-[11px] font-medium text-slate-500">
            {cat} · {catWords.length}
          </div>
          <div className="px-2 py-1 grid grid-cols-2 sm:grid-cols-3 gap-1">
            {catWords.map((w) => {
              const id = w.id!;
              const on = picked.has(id);
              return (
                <button
                  key={id}
                  onClick={() => onToggle(id)}
                  className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-left text-xs transition-colors ${
                    on ? 'bg-emerald-50 border border-emerald-300' : 'border border-transparent hover:bg-slate-50'
                  }`}
                >
                  <span className={`w-3.5 h-3.5 rounded flex items-center justify-center shrink-0 text-[10px] ${on ? 'bg-emerald-500 text-white' : 'border border-slate-300'}`}>
                    {on ? '✓' : ''}
                  </span>
                  <span className="truncate" title={w.definition}>
                    {w.word}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function QuickBtn({ label, count, sub, subBelow, showCount = true, disabled, onClick }: { label: string; count: number; sub?: string; subBelow?: string; showCount?: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button
      disabled={disabled || count === 0}
      onClick={onClick}
      className="py-2.5 rounded-2xl border border-slate-200 bg-white text-sm text-slate-600 disabled:opacity-40 hover:border-slate-300 transition-colors tabular-nums leading-tight"
    >
      <span className="block">
        {label}
        {showCount && ` ${count}`}
        {sub && <span className="text-xs text-slate-400"> {sub}</span>}
      </span>
      {subBelow && <span className="block text-xs text-slate-400 mt-0.5">{subBelow}</span>}
    </button>
  );
}
