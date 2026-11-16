import { db } from '../db';
import type { CardState, Word } from '../types';
import { freshState, isLapsed, startOfDay } from './srs';

export type SessionType = 'new' | 'review' | 'lapsed';

export interface SessionItem {
  word: Word;
  type: SessionType;
  state: CardState;
}

export interface Scope {
  bookId: number | null;
  category: string | null;
}

export interface SessionOpts {
  reviews: boolean;
  news: boolean;
  lapsed: boolean;
}

export async function buildSession(scope: Scope, opts: SessionOpts, dailyNew: number): Promise<SessionItem[]> {
  const now = Date.now();
  const [words, states] = await Promise.all([db.words.toArray(), db.cardState.toArray()]);
  const stOf = new Map<number, CardState>();
  for (const s of states) stOf.set(s.wordId, s);
  const inScope = (w: Word) =>
    (scope.bookId == null || w.bookId === scope.bookId) &&
    (scope.category == null || w.category === scope.category);

  const reviews: SessionItem[] = [];
  const lapsedItems: SessionItem[] = [];
  const unlearned: Word[] = [];
  for (const w of words) {
    if (!inScope(w) || w.id == null) continue;
    const st = stOf.get(w.id);
    if (!st || st.firstStudy == null) {
      unlearned.push(w);
      continue;
    }
    if (st.mastered) continue;
    if (isLapsed(st)) lapsedItems.push({ word: w, type: 'lapsed', state: st });
    else if (st.due != null && st.due <= now) reviews.push({ word: w, type: 'review', state: st });
  }
  reviews.sort((a, b) => (a.state.due ?? 0) - (b.state.due ?? 0));

  const dayStart = startOfDay(now);
  const todayNew = await db.reviewLog.filter((l) => l.sessionType === 'new' && l.ts >= dayStart).count();
  const remaining = Math.max(0, dailyNew - todayNew);

  const items: SessionItem[] = [];
  if (opts.reviews) items.push(...reviews);
  if (opts.lapsed) items.push(...lapsedItems);
  if (opts.news) items.push(...unlearned.slice(0, remaining).map((w) => ({ word: w, type: 'new' as const, state: freshState(w.id!) })));
  return items;
}
