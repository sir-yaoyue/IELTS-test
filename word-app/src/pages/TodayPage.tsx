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
      const items = await buildSession(scope, opts, settings.dailyNew);
      if (items.length === 0) {
        window.alert('当前范围没有可学内容');
        return;
      }
      onStart(items);
    } finally {
      setBusy(false);
    }
  };

  const primaryCount = dueItems.length + lapsedItems.length + Math.min(unlearned.length, remainingQuota);

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
        <div className="text-xs text-slate-400 tabular-nums">
          范围内：未学 {unlearned.length} · 已掌握 {masteredCount}
        </div>
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
          count={Math.min(unlearned.length, remainingQuota)}
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

function QuickBtn({ label, count, disabled, onClick }: { label: string; count: number; disabled: boolean; onClick: () => void }) {
  return (
    <button
      disabled={disabled || count === 0}
      onClick={onClick}
      className="py-3 rounded-2xl border border-slate-200 bg-white text-sm text-slate-600 disabled:opacity-40 hover:border-slate-300 transition-colors tabular-nums"
    >
      {label} {count}
    </button>
  );
}
