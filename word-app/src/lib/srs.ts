import type { CardState, Settings } from '../types';

/** 艾宾浩斯复习日偏移：首学后第 1/3/7/15/30 天 */
export const EBB_OFFSETS = [1, 3, 7, 15, 30];
/** stage 6 = 已掌握 */
export const MASTERED_STAGE = EBB_OFFSETS.length + 1;

const MINUTE = 60_000;
const DAY = 86_400_000;

export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function dueDay(from: number, days: number): number {
  return startOfDay(from) + days * DAY;
}

function stageDue(firstStudy: number, stage: number): number {
  return dueDay(firstStudy, EBB_OFFSETS[stage - 1]);
}

export function freshState(wordId: number): CardState {
  return {
    wordId,
    stage: 0,
    due: null,
    firstStudy: null,
    lastReview: null,
    lastGrade: null,
    reps: 0,
    lapsed: 0,
    mastered: false,
  };
}

/** 错词本：出现过"忘了"，且最近一次评级不是"记得" */
export function isLapsed(st: CardState): boolean {
  return !st.mastered && st.lapsed > 0 && st.lastGrade !== 2;
}

/**
 * 评级：0=忘了 1=模糊 2=记得
 */
export function applyGrade(
  st: CardState,
  grade: number,
  now: number,
  strategy: Settings['strategy'] = 'ebbinghaus',
): CardState {
  const base: CardState = {
    ...st,
    firstStudy: st.firstStudy ?? now,
    lastReview: now,
    lastGrade: grade,
    reps: st.reps + 1,
    mastered: false,
  };
  if (strategy === 'sm2') return applySm2(base, grade, now);

  if (grade === 2) {
    const next = base.stage + 1;
    if (next >= MASTERED_STAGE) {
      base.stage = next;
      base.mastered = true;
      base.due = null;
    } else {
      base.stage = next;
      base.due = stageDue(base.firstStudy!, next);
    }
  } else if (grade === 1) {
    // 模糊：不推进，当天再过一遍（首学阶段 +30 分钟，复习阶段 +1 天）
    base.due = base.stage === 0 ? now + 30 * MINUTE : dueDay(now, 1);
  } else {
    // 忘了：进错词本，当天再过一遍
    base.lapsed = st.lapsed + 1;
    base.due = base.stage === 0 ? now + 10 * MINUTE : dueDay(now, 1);
  }
  return base;
}

function applySm2(st: CardState, grade: number, now: number): CardState {
  const q = grade === 2 ? 5 : grade === 1 ? 3 : 0;
  let ef = st.ef ?? 2.5;
  ef = Math.max(1.3, ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
  let reps = st.sm2Reps ?? 0;
  let interval = st.intervalDays ?? 0;
  if (q < 3) {
    reps = 0;
    interval = 0;
    st.lapsed = st.lapsed + 1;
  } else {
    reps += 1;
    interval = reps === 1 ? 1 : reps === 2 ? 6 : Math.max(interval + 1, Math.round(interval * ef));
  }
  st.ef = ef;
  st.sm2Reps = reps;
  st.intervalDays = interval;
  st.stage = reps === 0 ? 0 : Math.min(MASTERED_STAGE - 1, reps);
  st.mastered = interval >= 30;
  st.due = st.mastered ? null : interval === 0 ? now + 10 * MINUTE : dueDay(now, interval);
  return st;
}
