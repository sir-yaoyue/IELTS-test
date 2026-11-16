import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { CardState } from '../types';
import { dayKey, startOfDay } from '../lib/srs';
import { LineChart, HBarChart, Legend, type Series } from '../lib/chart';
import { retentionByCalendarDay, stageDistribution, ebbinghausTheory } from '../lib/memory-stats';

const DAY = 86_400_000;

type Tab = 'overview' | 'memory' | 'books';

const TABS: [Tab, string][] = [
  ['overview', '总览'],
  ['memory', '记忆'],
  ['books', '词书'],
];

export default function StatsPage() {
  const [tab, setTab] = useState<Tab>('overview');
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

  // 近 14 天学习量
  const bars: { key: string; label: string; count: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const s = dayStart - i * DAY;
    bars.push({ key: dayKey(s), label: String(new Date(s).getDate()), count: log.filter((l) => l.ts >= s && l.ts < s + DAY).length });
  }
  const maxBar = Math.max(1, ...bars.map((b) => b.count));

  // 记忆效果 A
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
  const cleanSeries = (s: Series): Series => ({ ...s, points: s.points.filter((p) => Number.isFinite(p.y)) });
  const xLabels = calRet.map((_, i) => i + 1);

  // 记忆效果 D
  const theory = ebbinghausTheory(30);
  const theorySeries: Series = { name: '艾宾浩斯理论遗忘', color: '#94a3b8', kind: 'line', dash: '5 4', points: theory.map((t) => ({ x: t.day, y: t.rate * 100 })) };

  // 记忆效果 B
  const stageBuckets = stageDistribution(words, stOf);
  const hasStage = stageBuckets.some((b) => b.count > 0);

  // 词书进度
  const bookStats = books.map((b) => {
    const bw = words.filter((w) => w.bookId === b.id);
    const bl = bw.filter((w) => stOf.get(w.id!)?.firstStudy != null).length;
    const bm = bw.filter((w) => stOf.get(w.id!)?.mastered).length;
    const blapsed = bw.filter((w) => {
      const s = stOf.get(w.id!);
      return s && !s.mastered && s.lapsed > 0 && s.lastGrade !== 2;
    }).length;
    return { b, total: bw.length, learned: bl, mastered: bm, lapsed: blapsed };
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">统计</h1>
        {streak > 0 && <span className="text-sm bg-orange-50 text-orange-600 px-3 py-1.5 rounded-full font-medium">🔥 连续 {streak} 天</span>}
      </div>

      {/* Tab 切换 */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
        {TABS.map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ===== 总览 ===== */}
      {tab === 'overview' && (
        <div className="space-y-5">
          {/* 紧凑指标条 */}
          <div className="bg-white border border-slate-200 rounded-2xl px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
              <Metric label="总词量" value={words.length} />
              <Divider />
              <Metric label="已学习" value={learned} sub={words.length ? `${Math.round((learned / words.length) * 100)}%` : undefined} />
              <Divider />
              <Metric label="已掌握" value={mastered} />
              <Divider />
              <Metric label="错词本" value={lapsedCount} accent={lapsedCount > 0 ? '#f43f5e' : undefined} />
              <Divider />
              <Metric label="今天" value={today} sub="个" />
              <Metric label="近7天" value={week} sub="个" />
            </div>
          </div>

          {/* 近 14 天学习量 */}
          <div className="bg-white border border-slate-200 rounded-2xl p-4">
            <div className="text-sm font-medium text-slate-600 mb-3">近 14 天学习量</div>
            <div className="flex items-end gap-1.5 h-32">
              {bars.map((b) => (
                <div key={b.key} className="flex-1 flex flex-col items-center gap-1 h-full justify-end" title={`${b.count} 个`}>
                  <div
                    className="w-full rounded-t bg-slate-200"
                    style={{ height: `${Math.max(6, (b.count / maxBar) * 96)}px`, backgroundColor: b.count ? '#0f172a' : undefined }}
                  />
                  <span className="text-[10px] text-slate-400 tabular-nums">{b.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 词书汇总（一行） */}
          <button onClick={() => setTab('books')} className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-3 text-left hover:border-slate-300 transition-colors">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-slate-600">词书进度</span>
              <span className="text-slate-400 tabular-nums">
                {books.length} 册 · 共学 {learned}/{words.length} · {mastered} 掌握 →
              </span>
            </div>
          </button>
        </div>
      )}

      {/* ===== 记忆 ===== */}
      {tab === 'memory' && (
        <div className="space-y-5">
          {/* A 记忆效果总览 */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5">
            <div className="text-sm font-medium text-slate-700 mb-1">记忆效果（近 14 天）</div>
            <p className="text-xs text-slate-400 mb-3">每天评级的「记得 / 忘了」占比。曲线越高，记忆越牢。</p>
            {!hasMemData ? (
              <EmptyNote text="还没有足够复习记录（需每天 ≥3 次评级才显示比率）。先背几天词再来看。" />
            ) : (
              <>
                <LineChart
                  series={[cleanSeries(retainSeries), cleanSeries(forgetSeries)]}
                  opts={{
                    width: 520,
                    height: 240,
                    pad: { top: 16, right: 18, bottom: 30, left: 44 },
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

          {/* B 掌握阶段分布 */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5">
            <div className="text-sm font-medium text-slate-700 mb-1">掌握阶段分布</div>
            <p className="text-xs text-slate-400 mb-3">已学词在间隔重复各阶段的分布——越多词落到「已掌握」越健康。</p>
            {!hasStage ? (
              <EmptyNote text="还没有已学词。" />
            ) : (
              <HBarChart items={stageBuckets.map((b) => ({ label: b.label, value: b.count, color: b.color }))} opts={{ width: 520 }} />
            )}
          </div>

          {/* D 遗忘曲线对照 */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5">
            <div className="text-sm font-medium text-slate-700 mb-1">遗忘曲线（理论参考）</div>
            <p className="text-xs text-slate-400 mb-3">不复习时记忆按艾宾浩斯曲线衰减；1-3-7-15-30 的复习点正是把「快忘」的词捞回来。这张是静态参考，不随你的数据变化。</p>
            <LineChart
              series={[theorySeries]}
              opts={{
                width: 520,
                height: 220,
                pad: { top: 16, right: 18, bottom: 30, left: 44 },
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
            <div className="text-[11px] text-slate-400 mt-2">竖刻度 1/3/7/15/30 天 = 你的复习安排点</div>
          </div>
        </div>
      )}

      {/* ===== 词书 ===== */}
      {tab === 'books' && (
        <div className="space-y-3">
          {bookStats.map(({ b, total, learned: bl, mastered: bm, lapsed: blp }) => (
            <div key={b.id} className="bg-white border border-slate-200 rounded-2xl p-4">
              <div className="flex justify-between text-sm mb-2">
                <span className="font-medium">{b.name}</span>
                <span className="text-slate-400 tabular-nums">
                  {bl}/{total} 已学 · {bm} 掌握{blp > 0 ? ` · ${blp} 错词` : ''}
                </span>
              </div>
              <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-2.5 bg-emerald-500 rounded-full" style={{ width: `${total ? (bl / total) * 100 : 0}%` }} />
              </div>
            </div>
          ))}
          <p className="text-xs text-slate-400 text-center pt-1">点「今日」页可切换词书/话题组范围开始学习。</p>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, sub, accent }: { label: string; value: number; sub?: string; accent?: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-slate-400 text-xs">{label}</span>
      <span className="text-lg font-bold tabular-nums" style={{ color: accent ?? '#0f172a' }}>
        {value}
      </span>
      {sub && <span className="text-xs text-slate-400">{sub}</span>}
    </span>
  );
}

function Divider() {
  return <span className="w-px h-4 bg-slate-200 hidden sm:block" />;
}

function EmptyNote({ text }: { text: string }) {
  return <div className="text-xs text-slate-400 bg-slate-50 border border-dashed border-slate-200 rounded-xl px-4 py-8 text-center">{text}</div>;
}
