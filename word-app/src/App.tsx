import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getSettingsSync, seedSettings } from './db';
import type { Settings } from './types';
import { seedBuiltInBooks } from './lib/seed';
import { initTts } from './lib/tts';
import type { SessionItem } from './lib/session';
import type { Word } from './types';
import TodayPage from './pages/TodayPage';
import StudyPage from './pages/StudyPage';
import QuizPage from './pages/QuizPage';
import StatsPage from './pages/StatsPage';
import LibraryPage from './pages/LibraryPage';
import SetupPage from './pages/SetupPage';

initTts();

type View = 'today' | 'stats' | 'library';

const TABS: [View, string][] = [
  ['today', '今日'],
  ['stats', '统计'],
  ['library', '词库设置'],
];

/** 用 liveQuery 监听 settings 表，返回最新设置的纯读快照（可安全用于任何组件）。 */
export function useSettings(): Settings {
  useLiveQuery(() => db.settings.toArray(), []);
  return getSettingsSync();
}

export default function App() {
  const [view, setView] = useState<View>('today');
  const [session, setSession] = useState<SessionItem[] | null>(null);
  const [quiz, setQuiz] = useState<Word[] | null>(null);
  const bookCount = useLiveQuery(() => db.books.count(), []);

  const seededRef = useRef(false);
  useEffect(() => {
    seedSettings();
    // 每次加载自动增量同步内置词书（幂等：无更新则全跳过，有更新则补新词、保留记忆）
    if (!seededRef.current) {
      seededRef.current = true;
      seedBuiltInBooks().catch(() => {
        // 同步失败不阻塞，SetupPage 仍可手动导入
      });
    }
  }, []);

  if (bookCount === undefined) {
    return <div className="min-h-screen bg-slate-50 flex items-center justify-center text-slate-400">加载中…</div>;
  }
  if (bookCount === 0) return <SetupPage />;
  if (session) return <StudyPage items={session} onExit={() => setSession(null)} />;
  if (quiz) return <QuizPage pool={quiz} onExit={() => setQuiz(null)} />;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b border-slate-200">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center gap-4">
          <span className="font-bold text-lg tracking-wide">📖 单词本</span>
          <nav className="flex gap-1">
            {TABS.map(([v, label]) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  view === v ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 py-6 pb-16">
        {view === 'today' && <TodayPage onStart={setSession} onQuiz={setQuiz} />}
        {view === 'stats' && <StatsPage />}
        {view === 'library' && <LibraryPage />}
      </main>
    </div>
  );
}
