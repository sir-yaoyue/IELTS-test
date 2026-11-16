import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { dayKey, startOfDay } from '../lib/srs';

const DAY = 86_400_000;

export default function StatsPage() {
  const books = useLiveQuery(() => db.books.toArray(), []);
  const words = useLiveQuery(() => db.words.toArray(), []);
  const states = useLiveQuery(() => db.cardState.toArray(), []);
  const log = useLiveQuery(() => db.reviewLog.toArray(), []);

  if (!books || !words || !states || !log) {
    return <div className="text-slate-400 py-10 text-center">加载中…</div>;
  }

  const stOf = new Map<number, (typeof states)[number]>();
  for (const s of states) stOf.set(s.wordId, s);
  const learned = words.filter((w) => stOf.get(w.id!)?.firstStudy != null).length;
  const mastered = words.filter((w) => stOf.get(w.id!)?.mastered).length;
  const lapsedCount = words.filter((w) => {
    const s = stOf.get(w.id!);
    return s && !s.mastered && s.lapsed > 0 && s.lastGrade !== 2;
  }).length;

  const now = Date.now();
  const dayStart = startOfDay(now);
  const today = log.filter((l) => l.ts >= dayStart).length;
  const week = log.filter((l) => l.ts >= dayStart - 6 * DAY).length;

  const daySet = new Set(log.map((l) => dayKey(l.ts)));
  let streak = 0;
  let d = dayStart;
  if (!daySet.has(dayKey(now))) d -= DAY;
  while (daySet.has(dayKey(d))) {
    streak += 1;
    d -= DAY;
  }

  const bars: { key: string; label: string; count: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const s = dayStart - i * DAY;
    bars.push({ key: dayKey(s), label: String(new Date(s).getDate()), count: log.filter((l) => l.ts >= s && l.ts < s + DAY).length });
  }
  const maxBar = Math.max(1, ...bars.map((b) => b.count));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">统计</h1>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card label="总词量" value={words.length} />
        <Card label="已学习" value={learned} sub={words.length ? `${Math.round((learned / words.length) * 100)}%` : undefined} />
        <Card label="已掌握" value={mastered} />
        <Card label="错词本" value={lapsedCount} />
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-slate-600">近 14 天学习量</span>
          {streak > 0 && <span className="text-xs text-orange-500 font-medium">🔥 连续 {streak} 天</span>}
        </div>
        <div className="flex items-end gap-1.5 h-28">
          {bars.map((b) => (
            <div key={b.key} className="flex-1 flex flex-col items-center gap-1 h-full justify-end" title={`${b.count} 个`}>
              <div
                className="w-full rounded-t bg-slate-200"
                style={{ height: `${Math.max(6, (b.count / maxBar) * 84)}px`, backgroundColor: b.count ? '#0f172a' : undefined }}
              />
              <span className="text-[10px] text-slate-400 tabular-nums">{b.label}</span>
            </div>
          ))}
        </div>
        <div className="text-xs text-slate-400 mt-2 tabular-nums">今天 {today} 个 · 近 7 天 {week} 个</div>
      </div>

      <div className="space-y-3">
        {books.map((b) => {
          const bw = words.filter((w) => w.bookId === b.id);
          const bl = bw.filter((w) => stOf.get(w.id!)?.firstStudy != null).length;
          const bm = bw.filter((w) => stOf.get(w.id!)?.mastered).length;
          return (
            <div key={b.id} className="bg-white border border-slate-200 rounded-2xl p-4">
              <div className="flex justify-between text-sm mb-2">
                <span className="font-medium">{b.name}</span>
                <span className="text-slate-400 tabular-nums">
                  {bl}/{bw.length} 已学 · {bm} 掌握
                </span>
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-2 bg-emerald-500 rounded-full" style={{ width: `${bw.length ? (bl / bw.length) * 100 : 0}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Card({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="text-2xl font-bold mt-1 tabular-nums">
        {value}
        {sub && <span className="text-sm text-slate-400 font-normal"> {sub}</span>}
      </div>
    </div>
  );
}
