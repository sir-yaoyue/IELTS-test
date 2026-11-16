export interface Book {
  id?: number;
  name: string;
  source: 'built-in' | 'file';
  created: number;
  /** 内置词书的内容指纹（词列表稳定哈希）；用于检测词书更新并增量同步。file 导入为空。 */
  contentHash?: string;
}

export interface Word {
  id?: number;
  bookId: number;
  word: string;
  phonetic: string;
  definition: string;
  example: string;
  category: string;
  isPhrase: boolean;
  audio?: string;
}

export interface CardState {
  wordId: number;
  /** 0=新词未过, 1..5=艾宾浩斯阶段, 6=已掌握 */
  stage: number;
  /** 下次到期（epoch ms）；null=未排期/已掌握 */
  due: number | null;
  firstStudy: number | null;
  lastReview: number | null;
  /** 最近一次评级 0=忘了 1=模糊 2=记得 */
  lastGrade: number | null;
  reps: number;
  lapsed: number;
  mastered: boolean;
  // SM-2 专用
  ef?: number;
  intervalDays?: number;
  sm2Reps?: number;
}

export interface ReviewLog {
  id?: number;
  wordId: number;
  ts: number;
  stage: number;
  grade: number;
  sessionType: 'new' | 'review' | 'lapsed';
}

export interface Settings {
  key: string;
  dailyNew: number;
  showDefDefault: boolean;
  autoSpeak: boolean;
  ttsRate: number;
  strategy: 'ebbinghaus' | 'sm2';
}

export interface Collection {
  id?: number;
  name: string;
  wordIds: number[];
  created: number;
}
