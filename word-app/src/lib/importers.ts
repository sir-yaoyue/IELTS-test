export interface ParsedWord {
  word: string;
  phonetic: string;
  definition: string;
  example: string;
  category: string;
  isPhrase: boolean;
}

export interface ParsedBook {
  name: string;
  words: ParsedWord[];
}

interface MdMap {
  word: number;
  phonetic: number;
  def: number;
  example: number;
  isPhrase: boolean;
}

function mdHeaderMap(cells: string[]): MdMap | null {
  let word = -1;
  let phonetic = -1;
  let def = -1;
  let example = -1;
  let isPhrase = false;
  cells.forEach((c, i) => {
    const t = c.trim();
    if (t === '单词') word = i;
    else if (t === '短语') {
      word = i;
      isPhrase = true;
    } else if (t === '音标') phonetic = i;
    else if (t === '中文') def = i;
    else if (t === '例句') example = i;
  });
  if (word === -1 || def === -1) return null;
  return { word, phonetic, def, example, isPhrase };
}

function splitMdRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

/**
 * 解析 Markdown 词表：
 * - 词表识别：表头含 单词/短语 + 中文（+ 例句/音标 可选）
 * - 分类取表格前最近的小标题（##/###/#### 或 **加粗行**）
 * - 排期表/进度表（无"中文"列）自动跳过
 */
export function parseMdBook(md: string, defaultName?: string): ParsedBook {
  const lines = md.split(/\r?\n/);
  let title: string | null = null;
  let heading = '';
  const words: ParsedWord[] = [];
  let i = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (t.startsWith('# ')) {
      if (!title) title = t.slice(2).trim();
      i++;
      continue;
    }
    const h = t.match(/^#{2,6}\s+(.*)$/);
    if (h) {
      heading = h[1].trim();
      i++;
      continue;
    }
    const bold = t.match(/^\*\*(.+?)\*\*$/);
    if (bold) {
      heading = bold[1].trim();
      i++;
      continue;
    }
    if (t.startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(splitMdRow(lines[i]));
        i++;
      }
      if (rows.length >= 2) {
        const map = mdHeaderMap(rows[0]);
        if (map) {
          for (let r = 1; r < rows.length; r++) {
            const cells = rows[r];
            if (cells.every((c) => c === '' || /^:?-{2,}:?$/.test(c))) continue;
            const w = (cells[map.word] ?? '').trim();
            if (!w) continue;
            words.push({
              word: w,
              phonetic: map.phonetic >= 0 ? (cells[map.phonetic] ?? '').trim() : '',
              definition: (cells[map.def] ?? '').trim(),
              example: map.example >= 0 ? (cells[map.example] ?? '').trim() : '',
              category: heading || '未分组',
              isPhrase: map.isPhrase || /\s/.test(w),
            });
          }
        }
      }
      continue;
    }
    i++;
  }
  const name =
    defaultName ||
    (title ? title.replace(/^.*[·•]\s*/, '').trim() : '导入词书');
  return { name, words };
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (const ch of line) {
    if (ch === '"') inQ = !inQ;
    else if (ch === ',' && !inQ) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * CSV/TXT 词表：
 * - 首行含表头（单词/word/音标/中文/例句/分类）则按表头映射
 * - 否则按位置：单词,音标,中文,例句,分类
 * - 纯 txt（每行一个词）也走位置映射
 */
export function parseCsvBook(text: string, fallbackName = '导入词书'): ParsedBook {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return { name: fallbackName, words: [] };
  const first = splitCsvLine(lines[0]);
  const HEADER_WORDS = ['单词', 'word', '短语', '音标', '中文', 'definition', 'def', '例句', 'example', '分类', 'category'];
  const hasHeader = first.some((c) => HEADER_WORDS.includes(c.trim()));
  let map = { word: 0, phonetic: 1, def: 2, example: 3, category: 4, isPhrase: false };
  let start = 0;
  if (hasHeader) {
    const m = { word: -1, phonetic: -1, def: -1, example: -1, category: -1, isPhrase: false };
    first.forEach((c, i) => {
      const t = c.trim();
      if (t === '单词' || t === 'word') m.word = i;
      else if (t === '短语') {
        m.word = i;
        m.isPhrase = true;
      } else if (t === '音标') m.phonetic = i;
      else if (t === '中文' || t === 'definition' || t === 'def') m.def = i;
      else if (t === '例句' || t === 'example') m.example = i;
      else if (t === '分类' || t === 'category') m.category = i;
    });
    if (m.word >= 0 && m.def >= 0) {
      map = m;
      start = 1;
    }
  }
  const words: ParsedWord[] = [];
  for (let i = start; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const w = (cells[map.word] ?? '').trim();
    if (!w) continue;
    words.push({
      word: w,
      phonetic: map.phonetic >= 0 ? (cells[map.phonetic] ?? '').trim() : '',
      definition: (cells[map.def] ?? '').trim(),
      example: map.example >= 0 ? (cells[map.example] ?? '').trim() : '',
      category: map.category >= 0 ? (cells[map.category] ?? '').trim() || '未分组' : '未分组',
      isPhrase: map.isPhrase || /\s/.test(w),
    });
  }
  return { name: fallbackName, words };
}
