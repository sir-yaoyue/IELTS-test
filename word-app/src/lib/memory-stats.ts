import type { CardState, ReviewLog, Word } from '../types';
import { dayKey, startOfDay } from './srs';

const DAY = 86_400_000;

/** 取近 N 天（含今天）的本地日界数组，旧→新 */
function lastNDays(n: number): number[] {
  const dayStart = startOfDay(Date.now());
  const out: number[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(dayStart - i * DAY);
  return out;
}

/** A/D 共用：按「距首学天数」聚合的保持率/遗忘率 */
export interface RetentionPoint {
  day: number; // 距首学天数（1..maxDay）
  total: number; // 当日被复习的词数
  remember: number; // 记得数
  forget: number; // 忘了数
  retainRate: number | null; // 记得/被评级 比例 0..1（total 不足为 null）
  forgetRate: number | null;
}

/**
 * 记忆保持曲线（按距首学天数对齐，用于 A 的"效果总览"与 D 的"遗忘曲线对照"）。
 * 每个复习事件按其「距该词首学天数」归桶，统计该天记得/忘了占比。
 */
export function retentionByDay(log: ReviewLog[], states: Map<number, CardState>, maxDay = 30): RetentionPoint[] {
  const buckets = new Map<number, { total: number; remember: number; forget: number }>();
  for (const l of log) {
    const st = states.get(l.wordId);
    if (!st || st.firstStudy == null) continue;
    const day = Math.round((l.ts - st.firstStudy) / DAY);
    if (day < 1 || day > maxDay) continue;
    let b = buckets.get(day);
    if (!b) {
      b = { total: 0, remember: 0, forget: 0 };
      buckets.set(day, b);
    }
    b.total += 1;
    if (l.grade === 2) b.remember += 1;
    if (l.grade === 0) b.forget += 1;
  }
  const out: RetentionPoint[] = [];
  for (let d = 1; d <= maxDay; d++) {
    const b = buckets.get(d);
    if (!b) {
      out.push({ day: d, total: 0, remember: 0, forget: 0, retainRate: null, forgetRate: null });
      continue;
    }
    out.push({
      day: d,
      total: b.total,
      remember: b.remember,
      forget: b.forget,
      retainRate: b.total >= 3 ? b.remember / b.total : null,
      forgetRate: b.total >= 3 ? b.forget / b.total : null,
    });
  }
  return out;
}

/** A 的「按自然日」变体：每天记忆保持率/遗忘率（最近 N 天） */
export interface DayRetention {
  key: string;
  date: number; // 日界
  total: number;
  remember: number;
  forget: number;
  retainRate: number | null;
  forgetRate: number | null;
}
export function retentionByCalendarDay(log: ReviewLog[], days = 14): DayRetention[] {
  const byDay = new Map<string, { total: number; remember: number; forget: number }>();
  for (const l of log) {
    const k = dayKey(l.ts);
    let b = byDay.get(k);
    if (!b) {
      b = { total: 0, remember: 0, forget: 0 };
      byDay.set(k, b);
    }
    b.total += 1;
    if (l.grade === 2) b.remember += 1;
    if (l.grade === 0) b.forget += 1;
  }
  return lastNDays(days).map((date) => {
    const k = dayKey(date);
    const b = byDay.get(k) ?? { total: 0, remember: 0, forget: 0 };
    return {
      key: k,
      date,
      total: b.total,
      remember: b.remember,
      forget: b.forget,
      retainRate: b.total >= 3 ? b.remember / b.total : null,
      forgetRate: b.total >= 3 ? b.forget / b.total : null,
    };
  });
}

/** B：阶段分布 */
export interface StageBucket {
  stage: number;
  label: string;
  count: number;
  color: string;
}
export function stageDistribution(words: Word[], states: Map<number, CardState>): StageBucket[] {
  const labels = ['S1 · 第1天', 'S2 · 第3天', 'S3 · 第7天', 'S4 · 第15天', 'S5 · 第30天', '已掌握'];
  const colors = ['#38bdf8', '#818cf8', '#a78bfa', '#c084fc', '#e879f9', '#34d399'];
  const buckets = labels.map((label, i) => ({ stage: i, label, count: 0, color: colors[i] }));
  let lapsed = 0;
  for (const w of words) {
    const s = states.get(w.id!);
    if (!s || s.firstStudy == null) continue;
    if (s.mastered) buckets[5].count += 1;
    else if (s.lapsed > 0 && s.lastGrade !== 2) lapsed += 1;
    else if (s.stage >= 1 && s.stage <= 5) buckets[s.stage - 1].count += 1;
    // stage 0（首学当天未过）不计入长期分布
  }
  buckets.push({ stage: 99, label: '错词本', count: lapsed, color: '#fb7185' });
  return buckets;
}

/** C：单词复习轨迹（距首学天数 vs 评级） */
export interface TracePoint {
  day: number;
  grade: number;
  ts: number;
}
export function wordTrace(log: ReviewLog[], wordId: number, st: CardState | undefined): TracePoint[] {
  if (!st || st.firstStudy == null) return [];
  return log
    .filter((l) => l.wordId === wordId)
    .map((l) => ({ day: Math.round((l.ts - st.firstStudy!) / DAY), grade: l.grade, ts: l.ts }))
    .sort((a, b) => a.ts - b.ts);
}

/** D：经典艾宾浩斯遗忘理论曲线（距首学天数 1..30，保持率 0..1） */
export function ebbinghausTheory(maxDay = 30): { day: number; rate: number }[] {
  // 经验衰减：R = exp(-t/S)，S=记忆强度（天），取 S≈4.5 拟合"1-3-7 不复习则大幅遗忘"
  const S = 4.5;
  const out: { day: number; rate: number }[] = [];
  for (let d = 1; d <= maxDay; d++) out.push({ day: d, rate: Math.exp(-d / S) });
  return out;
}

/** 学习量（按自然日，最近 N 天）——已存在于 StatsPage，此处供图表复用 */
export function dailyVolume(log: ReviewLog[], days = 14): { key: string; date: number; count: number }[] {
  const byDay = new Map<string, number>();
  for (const l of log) byDay.set(dayKey(l.ts), (byDay.get(dayKey(l.ts)) ?? 0) + 1);
  return lastNDays(days).map((date) => {
    const k = dayKey(date);
    return { key: k, date, count: byDay.get(k) ?? 0 };
  });
}
