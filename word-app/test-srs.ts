// SRS 自检：node test-srs.ts
import { applyGrade, freshState, isLapsed, startOfDay, dayKey, MASTERED_STAGE, EBB_OFFSETS } from './src/lib/srs.ts';
import type { CardState } from './src/types.ts';

let fail = 0;
function check(name: string, cond: boolean, extra = '') {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`);
  if (!cond) fail++;
}

const day = 86_400_000;
const t0 = startOfDay(Date.now()) + 10 * 3_600_000; // 首学：今天 10:00
const onDay = (n: number) => startOfDay(t0) + n * day + 9 * 3_600_000; // 第 n 天 09:00

// 1. 新词"记得" → stage1，due=明天 00:00
let st = applyGrade(freshState(1), 2, t0);
check('新词记得 → stage 1', st.stage === 1, `stage=${st.stage}`);
check('新词记得 → due 明天', st.due === startOfDay(t0) + 1 * day, `due偏移=${Math.round(((st.due ?? 0) - startOfDay(t0)) / day)}天`);
check('firstStudy 已记录', st.firstStudy === t0);

// 2. 新词"忘了" → 停留 stage0，due +10min，lapsed=1，进错词本
st = applyGrade(freshState(2), 0, t0);
check('新词忘了 → 停留 stage0', st.stage === 0);
check('新词忘了 → due +10min', st.due === t0 + 10 * 60_000);
check('新词忘了 → lapsed=1', st.lapsed === 1);
check('新词忘了 → 错词本', isLapsed(st));

// 3. 阶段推进 1→2→3→4→5→6(掌握)，间隔 = 首学后 1/3/7/15/30 天
st = applyGrade(freshState(3), 2, t0); // s1
for (const targetStage of [2, 3, 4, 5, 6]) {
  st = applyGrade(st, 2, onDay(EBB_OFFSETS[targetStage - 1]));
}
check('连续记得 → 已掌握', st.mastered && st.stage === MASTERED_STAGE, `stage=${st.stage}`);
check('掌握后 due=null', st.due === null);

// 4. 各阶段 due 校验：stage2 的 due = 首学+3天
st = applyGrade(freshState(4), 2, t0);
st = applyGrade(st, 2, onDay(1));
check('stage2 due=首学+3天', st.due === startOfDay(t0) + 3 * day);

// 5. 复习阶段"模糊" → 不推进，due=次日（相对评级日）
st = applyGrade(freshState(5), 2, t0); // s1，due=day1
st = applyGrade(st, 1, onDay(1));
check('模糊不推进', st.stage === 1 && st.due === startOfDay(t0) + 2 * day, `due偏移=${Math.round(((st.due ?? 0) - startOfDay(t0)) / day)}天`);

// 6. 复习阶段"忘了" → 停留，due=次日，错词本
st = applyGrade(st, 0, onDay(2));
check('复习忘了 → 停留+次日', st.stage === 1 && st.due === startOfDay(t0) + 3 * day);
check('复习忘了 → 错词本', isLapsed(st) && st.lapsed === 1);
// 再"记得" → 离开错词本，推进 stage2
st = applyGrade(st, 2, onDay(3));
check('错词本再记得 → 离开+推进', !isLapsed(st) && st.stage === 2, `stage=${st.stage}`);

// 7. SM-2 基本推进
let sm = applyGrade(freshState(6), 2, t0, 'sm2');
check('sm2 首得 → interval 1天', sm.intervalDays === 1 && sm.sm2Reps === 1, `i=${sm.intervalDays}`);
sm = applyGrade(sm, 2, onDay(1), 'sm2');
check('sm2 二得 → interval 6天', sm.intervalDays === 6, `i=${sm.intervalDays}`);
sm = applyGrade(sm, 0, onDay(7), 'sm2');
check('sm2 答错 → 重置+10min 再考', sm.sm2Reps === 0 && sm.intervalDays === 0 && sm.due === onDay(7) + 10 * 60_000);

// 8. dayKey
check('dayKey 格式', dayKey(t0).length === 10, dayKey(t0));

console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);
