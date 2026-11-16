import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { CardState } from '../types';
import { dayKey, startOfDay } from '../lib/srs';
import { LineChart, HBarChart, Legend, type Series } from '../lib/chart';
import { retentionByCalendarDay, stageDistribution, ebbinghausTheory } from '../lib/memory-stats';

const DAY = 86_400_000;

export default function StatsPage() {
  const books = useLiveQuery(() => db.books.toArray(), []);
  const words = useLiveQuery(() => db.words.toArray(), []);
  const states = useLiveQuery(() => db.cardState.toArray(), []);
  const log = useLiveQuery(() => db.reviewLog.toArray(), []);

  if (!books || !words || !states || !log) {
    return <div className="text-slate-400 py-10 text-center">加载中…</div>;
  }

  const stOf = new Map<number, CardState>();
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

  // 记忆效果（A + D）：最近 14 天日历口径的保持率/遗忘率
  const calRet = retentionByCalendarDay(log, 14);
  const hasMemData = calRet.some((r) => r.retainRate != null);
  const retainSeries: Series = {
    name: '记忆保持率',
    color: '#10b981',
    kind: 'line',
    points: calRet.map((r, i) => ({ x: i + 1, y: r.retainRate == null ? NaN : r.retainRate * 100, label: r.key.slice(5) })),
  };
  const forgetSeries: Series = {
    name: '当日遗忘率',
    color: '#f43f5e',
    kind: 'line',
    points: calRet.map((r, i) => ({ x: i + 1, y: r.forgetRate == null ? NaN : r.forgetRate * 100 })),
  };
  // 过滤掉 NaN 点（SVG polyline 不接受 NaN）
  const cleanSeries = (s: Series): Series => ({ ...s, points: s.points.filter((p) => Number.isFinite(p.y)) });
  const xLabels = calRet.map((_, i) => i + 1);

  // D：距首学天数口径的保持率 + 理论遗忘曲线
  const theory = ebbinghausTheory(30);
  // 用 calendar 数据无法直接对齐"距首学天数"，这里理论曲线单独展示，与 A 的保持率同图对照
  const theorySeries: Series = { name: '艾宾浩斯理论遗忘', color: '#94a3b8', kind: 'line', dash: '5 4', points: theory.map((t) => ({ x: t.day, y: t.rate * 100 })) };

  // B：阶段分布
  const stageBuckets = stageDistribution(words, stOf);
  const hasStage = stageBuckets.some((b) => b.count > 0);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">统计</h1>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card label="总词量" value={words.length} />
        <Card label="已学习" value={learned} sub={words.length ? `${Math.round((learned / words.length) * 100)}%` : undefined} />
        <Card label="已掌握" value={mastered} />
        <Card label="错词本" value={lapsedCount} />
      </div>

      {/* A + D：记忆效果曲线 */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-medium text-slate-600">记忆效果（近 14 天）</span>
          {streak > 0 && <span className="text-xs text-orange-500 font-medium">🔥 连续 {streak} 天</span>}
        </div>
        {!hasMemData ? (
          <EmptyNote text="还没有足够复习记录（需每天 ≥3 次评级才显示比率）。先背几天词再来看。" />
        ) : (
          <>
            <LineChart
              series={[cleanSeries(retainSeries), cleanSeries(forgetSeries)]}
              opts={{
                width: 480,
                height: 200,
                pad: { top: 14, right: 16, bottom: 28, left: 40 },
                xMin: 1,
                xMax: 14,
                yMin: 0,
                yMax: 100,
                xTicks: xLabels.filter((_, i) => i % 2 === 0),
                yTicks: [0, 25, 50, 75, 100],
                xFormat: (v) => `${calRet[v - 1]?.key.slice(5) ?? ''}`,
                yFormat: (v) => `${v}%`,
                xLabel: '日期',
                yLabel: '比例',
              }}
            />
            <Legend items={[{ name: '记忆保持率（记得占比）', color: '#10b981' }, { name: '当日遗忘率（忘了占比）', color: '#f43f5e' }]} />
          </>
        )}
      </div>

      {/* D：理论遗忘曲线对照 */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4">
        <span className="text-sm font-medium text-slate-600 block mb-1">遗忘曲线（理论 vs 复习窗口）</span>
        <p className="text-xs text-slate-400 mb-2">
          不复习时记忆按艾宾浩斯曲线衰减；1-3-7-15-30 的复习点正是把"快忘"的词捞回来。
        </p>
        <LineChart
          series={[theorySeries]}
          opts={{
            width: 480,
            height: 180,
            pad: { top: 14, right: 16, bottom: 28, left: 40 },
            xMin: 1,
            xMax: 30,
            yMin: 0,
            yMax: 100,
            xTicks: [1, 3, 7, 15, 30],
            yTicks: [0, 25, 50, 75, 100],
            xFormat: (v) => `${v}天`,
            yFormat: (v) => `${v}%`,
            refs: [{ y: 40, color: '#f43f5e', label: '记忆≈40%（该复习）' }],
            xLabel: '距首学天数',
            yLabel: '保持率',
          }}
        />
        <div className="text-[11px] text-slate-400 mt-1">竖刻度 1/3/7/15/30 天 = 你的复习安排点</div>
      </div>

      {/* B：掌握阶段分布 */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4">
        <span className="text-sm font-medium text-slate-600 block mb-3">掌握阶段分布</span>
        {!hasStage ? (
          <EmptyNote text="还没有已学词。" />
        ) : (
          <HBarChart items={stageBuckets.map((b) => ({ label: b.label, value: b.count, color: b.color }))} opts={{ width: 480 }} />
        )}
      </div>

      {/* 近 14 天学习量（原柱状图） */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4">
        <div className="text-sm font-medium text-slate-600 mb-3">近 14 天学习量</div>
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

      {/* 词书进度 */}
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

function EmptyNote({ text }: { text: string }) {
  return <div className="text-xs text-slate-400 bg-slate-50 border border-dashed border-slate-200 rounded-xl px-4 py-6 text-center">{text}</div>;
}
