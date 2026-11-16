import { useEffect, useRef, useState } from 'react';
import { db } from '../db';
import type { SessionItem } from '../lib/session';
import { applyGrade } from '../lib/srs';
import { speak, stopSpeak } from '../lib/tts';
import { useSettings } from '../App';

export default function StudyPage({ items, onExit }: { items: SessionItem[]; onExit: () => void }) {
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const settings = useSettings();
  const [counts, setCounts] = useState({ g0: 0, g1: 0, g2: 0, news: 0 });
  const [done, setDone] = useState(false);
  const grading = useRef(false);

  const item = done ? null : items[idx];

  // 自动朗读
  useEffect(() => {
    if (item && settings.autoSpeak) speak(item.word.word, settings.ttsRate);
  }, [idx, done, settings]);

  // 默认显示释义
  useEffect(() => {
    if (!done) setFlipped((f) => f || settings.showDefDefault);
  }, [settings, done]);

  const grade = async (g: number) => {
    if (!item || grading.current) return;
    grading.current = true;
    const now = Date.now();
    const st1 = applyGrade(item.state, g, now, settings.strategy);
    try {
      await db.transaction('rw', db.cardState, db.reviewLog, async () => {
        await db.cardState.put(st1);
        await db.reviewLog.add({ wordId: item.word.id!, ts: now, stage: st1.stage, grade: g, sessionType: item.type });
      });
    } finally {
      grading.current = false;
    }
    const key = g === 0 ? 'g0' : g === 1 ? 'g1' : 'g2';
    setCounts((c) => ({ ...c, [key]: c[key] + 1, news: c.news + (item.type === 'new' ? 1 : 0) }));
    if (idx + 1 >= items.length) {
      setDone(true);
    } else {
      setIdx(idx + 1);
      setFlipped(settings.showDefDefault);
    }
  };

  // 键盘操作
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (done) {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          onExit();
        }
        return;
      }
      if (e.key === ' ') {
        e.preventDefault();
        setFlipped(true);
      } else if (e.key === '1') grade(0);
      else if (e.key === '2') grade(1);
      else if (e.key === '3') grade(2);
      else if (e.key.toLowerCase() === 'r') {
        if (item) speak(item.word.word, settings.ttsRate);
      } else if (e.key.toLowerCase() === 'm') stopSpeak();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (done) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-8 max-w-md w-full text-center">
          <div className="text-4xl mb-3">🎉</div>
          <h2 className="text-xl font-bold mb-4">本轮完成</h2>
          <div className="grid grid-cols-3 gap-2 text-sm mb-6">
            <div className="bg-rose-50 text-rose-600 rounded-xl p-3">
              <div className="text-2xl font-bold tabular-nums">{counts.g0}</div>忘了
            </div>
            <div className="bg-amber-50 text-amber-600 rounded-xl p-3">
              <div className="text-2xl font-bold tabular-nums">{counts.g1}</div>模糊
            </div>
            <div className="bg-emerald-50 text-emerald-600 rounded-xl p-3">
              <div className="text-2xl font-bold tabular-nums">{counts.g2}</div>记得
            </div>
          </div>
          <p className="text-xs text-slate-400 mb-6">
            共 {items.length} 个 · 新词 {counts.news} 个 · 忘了/模糊的词已自动排入稍后或次日复习
          </p>
          <button onClick={onExit} className="w-full py-3 rounded-xl bg-slate-900 text-white font-medium hover:bg-slate-800">
            返回今日（空格）
          </button>
        </div>
      </div>
    );
  }

  if (!item) {
    return <div className="min-h-screen bg-slate-50 flex items-center justify-center text-slate-400">加载中…</div>;
  }

  const badge =
    item.type === 'new'
      ? ['新词', 'bg-sky-100 text-sky-700']
      : item.type === 'lapsed'
        ? ['错词', 'bg-rose-100 text-rose-700']
        : ['复习', 'bg-violet-100 text-violet-700'];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="max-w-2xl w-full mx-auto px-4 pt-4 flex items-center justify-between text-sm text-slate-500">
        <button onClick={onExit} className="hover:text-slate-800">
          ← 退出
        </button>
        <span className="tabular-nums">
          {idx + 1} / {items.length}
        </span>
      </header>
      <div className="max-w-2xl w-full mx-auto px-4 flex-1 flex flex-col justify-center py-6">
        <div className="h-1.5 bg-slate-200 rounded-full mb-8 overflow-hidden">
          <div className="h-1.5 bg-slate-900 rounded-full transition-all" style={{ width: `${((idx + 1) / items.length) * 100}%` }} />
        </div>
        <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-8 min-h-[340px] flex flex-col items-center justify-center gap-4">
          <div className="flex items-center gap-2">
            <span className={`text-xs px-2 py-0.5 rounded-full ${badge[1]}`}>{badge[0]}</span>
            <span className="text-xs text-slate-400 max-w-[220px] truncate">{item.word.category}</span>
          </div>
          <div className="text-4xl sm:text-5xl font-bold tracking-wide text-center break-words">{item.word.word}</div>
          {item.word.phonetic && <div className="text-slate-500 text-lg">{item.word.phonetic}</div>}
          <button
            onClick={() => speak(item.word.word, settings.ttsRate)}
            className="mt-1 px-4 py-2 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
          >
            🔊 听读音
          </button>
          {flipped ? (
            <div className="mt-2 text-center space-y-1 w-full">
              <div className="text-xl text-slate-800">{item.word.definition || '—'}</div>
              {item.word.example && <div className="text-sm text-slate-500 italic">“{item.word.example}”</div>}
            </div>
          ) : (
            <button
              onClick={() => setFlipped(true)}
              className="mt-2 text-sm text-slate-400 hover:text-slate-600 border border-dashed border-slate-300 rounded-xl px-4 py-2"
            >
              点击 或 按空格 显示释义
            </button>
          )}
        </div>
        <div className="grid grid-cols-3 gap-3 mt-6">
          <button onClick={() => grade(0)} className="py-3.5 rounded-2xl bg-rose-500 text-white font-medium hover:bg-rose-600">
            忘了<span className="block text-xs opacity-70">1</span>
          </button>
          <button onClick={() => grade(1)} className="py-3.5 rounded-2xl bg-amber-500 text-white font-medium hover:bg-amber-600">
            模糊<span className="block text-xs opacity-70">2</span>
          </button>
          <button onClick={() => grade(2)} className="py-3.5 rounded-2xl bg-emerald-500 text-white font-medium hover:bg-emerald-600">
            记得<span className="block text-xs opacity-70">3</span>
          </button>
        </div>
        <p className="text-center text-xs text-slate-400 mt-4">空格 翻转 · 1/2/3 评级 · R 重播 · M 静音</p>
      </div>
    </div>
  );
}
