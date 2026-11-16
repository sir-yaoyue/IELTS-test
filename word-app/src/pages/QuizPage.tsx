import { useMemo, useState } from 'react';
import { db } from '../db';
import { useSettings } from '../App';
import { applyGrade } from '../lib/srs';
import type { Word } from '../types';

interface Option {
  word: string;
  definition: string;
  correct: boolean;
}

/** 看词选义：给定一个词，从词库抽 3 个干扰项，4 选 1。答错进错词本。 */
export default function QuizPage({ pool, onExit }: { pool: Word[]; onExit: () => void }) {
  const settings = useSettings();
  const [idx, setIdx] = useState(0);
  const [score, setScore] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [done, setDone] = useState(false);

  const allWords = useMemo(() => pool, [pool]);
  const current = done ? null : allWords[idx];

  // 生成 4 个选项（含当前词）
  const options: Option[] = useMemo(() => {
    if (!current) return [];
    const others = allWords.filter((w) => w.id !== current.id && w.definition);
    const shuffled = others.sort(() => Math.random() - 0.5).slice(0, 3);
    const opts = [
      { word: current.word, definition: current.definition, correct: true },
      ...shuffled.map((w) => ({ word: w.word, definition: w.definition, correct: false })),
    ];
    return opts.sort(() => Math.random() - 0.5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  const pick = async (i: number) => {
    if (picked !== null || !current) return;
    setPicked(i);
    const correct = options[i]?.correct;
    if (correct) setScore((s) => s + 1);
    // 答错 → 记一次"忘了"进错词本；答对 → 记一次"记得"（仅当该词已学过，避免污染新词状态）
    const st = await db.cardState.get(current.id!);
    if (st && st.firstStudy != null) {
      const g = correct ? 2 : 0;
      const next = applyGrade(st, g, Date.now(), settings.strategy);
      await db.transaction('rw', db.cardState, db.reviewLog, async () => {
        await db.cardState.put(next);
        await db.reviewLog.add({ wordId: current.id!, ts: Date.now(), stage: next.stage, grade: g, sessionType: 'review' });
      });
    }
    setTimeout(() => {
      if (idx + 1 >= allWords.length) setDone(true);
      else {
        setIdx(idx + 1);
        setPicked(null);
      }
    }, correct ? 350 : 900);
  };

  if (!current) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-8 max-w-sm w-full text-center space-y-4">
          <div className="text-4xl">📝</div>
          <h2 className="text-xl font-bold">自测完成</h2>
          <div className="text-3xl font-bold tabular-nums">
            {score} <span className="text-base text-slate-400 font-normal">/ {allWords.length}</span>
          </div>
          <p className="text-xs text-slate-400">答错的词已记入错词本，稍后可单独重背。</p>
          <button onClick={onExit} className="w-full py-3 rounded-xl bg-slate-900 text-white font-medium hover:bg-slate-800">
            返回今日
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="max-w-2xl w-full mx-auto px-4 pt-4 flex items-center justify-between text-sm text-slate-500">
        <button onClick={onExit} className="hover:text-slate-800">
          ← 退出
        </button>
        <span className="tabular-nums">
          {idx + 1} / {allWords.length} · 对 {score}
        </span>
      </header>
      <div className="max-w-2xl w-full mx-auto px-4 flex-1 flex flex-col justify-center py-6">
        <div className="h-1.5 bg-slate-200 rounded-full mb-8 overflow-hidden">
          <div className="h-1.5 bg-slate-900 rounded-full transition-all" style={{ width: `${((idx + 1) / allWords.length) * 100}%` }} />
        </div>
        <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-8 text-center mb-6">
          <div className="text-xs text-slate-400 mb-2">选它的中文释义</div>
          <div className="text-4xl sm:text-5xl font-bold tracking-wide break-words">{current.word}</div>
          {current.phonetic && <div className="text-slate-500 mt-2">{current.phonetic}</div>}
        </div>
        <div className="grid gap-3">
          {options.map((o, i) => {
            let cls = 'bg-white border-slate-200 hover:border-slate-300 text-slate-700';
            if (picked !== null) {
              if (o.correct) cls = 'bg-emerald-500 border-emerald-500 text-white';
              else if (i === picked) cls = 'bg-rose-500 border-rose-500 text-white';
              else cls = 'bg-slate-50 border-slate-200 text-slate-400';
            }
            return (
              <button key={i} disabled={picked !== null} onClick={() => pick(i)} className={`text-left px-5 py-4 rounded-2xl border font-medium transition-colors ${cls}`}>
                {o.definition}
              </button>
            );
          })}
        </div>
        <p className="text-center text-xs text-slate-400 mt-5">点选项作答 · 答错自动进错词本</p>
      </div>
    </div>
  );
}
