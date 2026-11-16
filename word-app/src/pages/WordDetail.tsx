import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { Word } from '../types';
import { LineChart } from '../lib/chart';
import { wordTrace } from '../lib/memory-stats';

/** C：单词复习轨迹。x=距首学天数，y=评级（0忘了/1模糊/2记得），标出复习窗口点。 */
export default function WordDetail({ word, onClose }: { word: Word; onClose: () => void }) {
  const st = useLiveQuery(() => db.cardState.get(word.id!), [word.id]);
  const log = useLiveQuery(() => db.reviewLog.where('wordId').equals(word.id!).toArray(), [word.id]);

  if (!log) return null;

  const trace = wordTrace(log, word.id!, st);
  const maxDay = Math.max(1, ...trace.map((t) => t.day), 15);
  const gradeColor = (g: number) => (g === 2 ? '#10b981' : g === 1 ? '#f59e0b' : '#f43f5e');
  const gradeName = (g: number) => (g === 2 ? '记得' : g === 1 ? '模糊' : '忘了');

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl shadow-xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white/95 backdrop-blur border-b border-slate-100 px-5 py-3 flex items-center justify-between">
          <div className="min-w-0">
            <div className="text-xl font-bold truncate">{word.word}</div>
            {word.phonetic && <div className="text-xs text-slate-400">{word.phonetic}</div>}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-2xl leading-none px-2">
            ×
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="text-sm text-slate-700">
            <span className="text-slate-400">释义：</span>
            {word.definition || '—'}
          </div>
          {word.example && (
            <div className="text-xs text-slate-500 italic">
              “{word.example}”
            </div>
          )}

          {/* 记忆档案 */}
          {st && (
            <div className="grid grid-cols-3 gap-2 text-center">
              <Fact label="当前阶段" value={st.mastered ? '已掌握' : `S${st.stage}`} />
              <Fact label="复习次数" value={String(st.reps)} />
              <Fact label="连忘次数" value={String(st.lapsed)} />
              <Fact label="首学" value={st.firstStudy ? new Date(st.firstStudy).toLocaleDateString() : '—'} />
              <Fact label="上次复习" value={st.lastReview ? new Date(st.lastReview).toLocaleDateString() : '—'} />
              <Fact label="最近评级" value={st.lastGrade == null ? '—' : gradeName(st.lastGrade)} accent={st.lastGrade != null ? gradeColor(st.lastGrade) : undefined} />
            </div>
          )}

          {/* 复习轨迹 */}
          <div>
            <div className="text-sm font-medium text-slate-600 mb-1">复习轨迹</div>
            {trace.length === 0 ? (
              <div className="text-xs text-slate-400 bg-slate-50 border border-dashed border-slate-200 rounded-xl px-4 py-5 text-center">
                还没有复习记录。
              </div>
            ) : (
              <>
                <LineChart
                  series={[
                    {
                      name: '评级',
                      color: '#6366f1',
                      kind: 'line',
                      points: trace.map((t) => ({ x: t.day, y: t.grade, label: `第${t.day}天 ${gradeName(t.grade)}` })),
                    },
                  ]}
                  opts={{
                    width: 440,
                    height: 170,
                    pad: { top: 14, right: 14, bottom: 28, left: 30 },
                    xMin: 1,
                    xMax: maxDay,
                    yMin: -0.3,
                    yMax: 2.3,
                    xTicks: [1, 3, 7, 15, 30].filter((v) => v <= maxDay),
                    yTicks: [0, 1, 2],
                    xFormat: (v) => `${v}天`,
                    yFormat: (v) => (v === 0 ? '忘' : v === 1 ? '模糊' : '记得'),
                    refs: [
                      { y: 1, color: '#f59e0b', dash: '3 3' },
                      { y: 0, color: '#f43f5e', dash: '3 3' },
                    ],
                    xLabel: '距首学天数',
                  }}
                />
                {/* 散点按评级着色（叠在折线上） */}
                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
                  {trace.map((t, i) => (
                    <span key={i} className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: gradeColor(t.grade) }} />
                      D{t.day}
                    </span>
                  ))}
                </div>
                <p className="text-[11px] text-slate-400 mt-2">
                  每点=一次复习（横轴距首学天数，纵轴评级）。掉到 0/1 的点就是「忘了/模糊」——间隔重复把这些点往后推、重新巩固。
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Fact({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="bg-slate-50 rounded-xl px-2 py-2">
      <div className="text-[10px] text-slate-400">{label}</div>
      <div className="text-sm font-semibold tabular-nums" style={{ color: accent ?? '#0f172a' }}>
        {value}
      </div>
    </div>
  );
}
