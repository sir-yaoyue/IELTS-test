// M6+M7 冒烟：导入→学词→统计页记忆效果图→词库点词轨迹→合并导入
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const BASE = 'http://127.0.0.1:4199/';
const CHROME = process.env.CHROME || 'C:\\Users\\EDY\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
const port = 9336;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wordapp-m6-'));

let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`);
  cond ? pass++ : fail++;
}

class CDP {
  constructor(ws) {
    this.ws = ws; this._id = 0; this._pending = new Map(); this.errors = [];
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      if (m.id) {
        if (this._pending.has(m.id)) {
          const { res, rej } = this._pending.get(m.id);
          this._pending.delete(m.id);
          m.error ? rej(new Error(m.error.message)) : res(m.result);
        }
        return;
      }
      if (m.method === 'Runtime.exceptionThrown') {
        const x = m.params.exceptionDetails;
        this.errors.push(x?.exception?.description ?? x?.text ?? 'exc');
      }
    });
  }
  send(method, params = {}) {
    const id = ++this._id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => {
      this._pending.set(id, { res, rej });
      setTimeout(() => { if (this._pending.has(id)) { this._pending.delete(id); rej(new Error('timeout ' + method)); } }, 25000);
    });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('JS exception: ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
    return r.result?.value;
  }
}

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--lang=zh-CN', 'about:blank',
], { stdio: 'ignore' });

// 辅助：读 IndexedDB 某表
const idb = (table) => `new Promise(res => { const rq = indexedDB.open('ielts-words'); rq.onsuccess = () => { const d = rq.result; const tx = d.transaction('${table}','readonly'); const q = tx.objectStore('${table}').${table === 'reviewLog' ? 'count()' : 'count()'}; q.onsuccess = () => res(q.result); }; })`;

try {
  let targets = [];
  for (let i = 0; i < 50; i++) { await sleep(300); try { const r = await fetch(`http://127.0.0.1:${port}/json/list`); targets = await r.json(); if (targets.length) break; } catch {} }
  const page = targets.find(t => t.type === 'page');
  if (!page) throw new Error('no page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  const cdp = new CDP(ws);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Page.navigate', { url: BASE });
  await sleep(3000);
  // 自动接受 confirm（headless 下 window.confirm 默认可能阻塞/返回 false）
  await cdp.eval(`window.confirm = () => true; window.alert = () => {}; 'ok'`);

  // 1. 导入
  await cdp.eval(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('导入内置词库')).click()`);
  let body = '';
  for (let i = 0; i < 20; i++) { await sleep(500); body = await cdp.eval(`document.body.innerText`); if (String(body).includes('今日')) break; }
  ok('导入后进入今日', String(body).includes('今日'));

  // 2. 学 5 个词（给记忆图制造数据）
  await cdp.eval(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('开始今日学习')).click()`);
  for (let i = 0; i < 10; i++) { await sleep(400); if (String(await cdp.eval(`document.body.innerText`)).includes('听读音')) break; }
  for (let n = 0; n < 5; n++) {
    const clicked = await cdp.eval(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim().startsWith('记得')); if (b) { b.click(); return true; } return false; })()`);
    if (!clicked) break;
    await sleep(950);
  }
  const reviewCount = await cdp.eval(idb('reviewLog'));
  ok('学习后 reviewLog 有记录', (reviewCount ?? 0) >= 5, `count=${reviewCount}`);

  // 3. 退出学习，进统计页，验证记忆效果图（A：保持率/遗忘率 + D：遗忘曲线 + B：阶段分布）
  await cdp.eval(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('退出')); if (b) b.click(); return !!b; })()`);
  await sleep(1200);
  await cdp.eval(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '统计').click()`);
  await sleep(1500);
  let statsBody = '';
  for (let i = 0; i < 8; i++) { statsBody = await cdp.eval(`document.body.innerText`); if (String(statsBody).includes('记忆效果')) break; await sleep(400); }
  ok('统计页出现「记忆效果」区', String(statsBody).includes('记忆效果'), JSON.stringify(String(statsBody)).slice(0, 60));
  ok('统计页出现「遗忘曲线」(D)', String(statsBody).includes('遗忘曲线'));
  ok('统计页出现「掌握阶段分布」(B)', String(statsBody).includes('掌握阶段分布'));
  // 验证 SVG 真的渲染了（不是空容器）
  const svgCount = await cdp.eval(`document.querySelectorAll('svg').length`);
  ok('统计页渲染了 SVG 图表', (svgCount ?? 0) >= 2, `svg=${svgCount}`);
  const svgHasPolyline = await cdp.eval(`document.querySelectorAll('svg polyline, svg polygon').length`);
  ok('SVG 含折线/面积图形', (svgHasPolyline ?? 0) >= 1, `polylines=${svgHasPolyline}`);

  if (cdp.errors.length) console.log('   [pageerror@stats]', cdp.errors.slice(-3).join(' || ').slice(0, 400));

  // 4. 词库页：展开词书→点词→看复习轨迹（C）
  await cdp.eval(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '词库设置').click()`);
  await sleep(1200);
  await cdp.eval(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('核心200词')); if (b) b.click(); return !!b; })()`);
  await sleep(800);
  const expandedWords = await cdp.eval(`[...document.querySelectorAll('button')].filter(b => b.className.includes('rounded-lg') && b.textContent.trim().length > 1 && !b.textContent.includes('核心200词') && !b.textContent.includes('删除') && !b.textContent.includes('统计')).length`);
  ok('词书展开显示词列表', (expandedWords ?? 0) > 10, `words=${expandedWords}`);
  // 点一个词
  await cdp.eval(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'curriculum' || x.className.includes('rounded-lg') && x.title); if (b) b.click(); return b ? b.textContent.trim() : null; })()`);
  await sleep(1200);
  let detailBody = '';
  for (let i = 0; i < 8; i++) { detailBody = await cdp.eval(`document.body ? document.body.innerText : ''`); if (String(detailBody).includes('复习轨迹')) break; await sleep(400); }
  ok('点词弹出「复习轨迹」详情(C)', String(detailBody).includes('复习轨迹'), JSON.stringify(String(detailBody)).slice(0, 50));
  const detailSvg = await cdp.eval(`document.querySelectorAll('svg').length`);
  ok('详情页渲染轨迹图', (detailSvg ?? 0) >= 1, `svg=${detailSvg}`);
  // 关闭详情
  await cdp.eval(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '×'); if (b) b.click(); return !!b; })()`);
  await sleep(600);

  if (cdp.errors.length) console.log('   [pageerror@detail]', cdp.errors.slice(-3).join(' || ').slice(0, 400));

  // 5. M7 合并导入：构造一个含新词的备份 JSON，合并后词数增加、本地进度保留
  const wordsBefore = await cdp.eval(idb('words'));
  const backup = JSON.stringify({
    version: 1,
    exportedAt: new Date().toISOString(),
    books: [{ id: 1, name: '核心200词', source: 'built-in', created: Date.now() }, { id: 99, name: '合并测试词书', source: 'file', created: Date.now() }],
    words: [{ id: 1, bookId: 1, word: 'curriculum', phonetic: '/kəˈrɪkjələm/', definition: '课程', example: '', category: 'x', isPhrase: false }, { id: 500, bookId: 99, word: 'zebra_merge_test', phonetic: '/ˈziːbrə/', definition: '斑马(合并测试)', example: '', category: '合并', isPhrase: false }],
    cardState: [{ wordId: 500, stage: 2, due: null, firstStudy: Date.now() - 3 * 86400000, lastReview: Date.now() - 86400000, lastGrade: 2, reps: 2, lapsed: 0, mastered: false }],
    reviewLog: [{ wordId: 500, ts: Date.now() - 86400000, stage: 2, grade: 2, sessionType: 'review' }],
    settings: [{ key: 'app', dailyNew: 30, showDefDefault: false, autoSpeak: true, ttsRate: 0.9, strategy: 'ebbinghaus' }],
  });
  // 写临时文件并触发 input（headless 下用 DataTransfer 设 files 不可靠，改为直接调 mergeImport 的核心逻辑：注入到 input 的 onChange 需要 File 对象）
  // 用 CDP 注入 File：构造 File 对象塞进 input.files
  const fileInj = await cdp.eval(`
    (async () => {
      const json = ${JSON.stringify(backup)};
      const file = new File([json], 'merge-backup.json', { type: 'application/json' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const inp = [...document.querySelectorAll('input[type=file]')].find(i => i.accept?.includes('json'));
      // 第二个 json input 是合并导入（mergeRef）
      const jsonInputs = [...document.querySelectorAll('input[type=file]')].filter(i => i.accept?.includes('json'));
      const mergeInput = jsonInputs[jsonInputs.length - 1];
      mergeInput.files = dt.files;
      mergeInput.dispatchEvent(new Event('change', { bubbles: true }));
      return 'dispatched to ' + jsonInputs.length + ' json inputs';
    })()
  `);
  // 自动确认弹窗
  await cdp.send('Page.enable');
  // 用 beforeunload/confirm 自动接受
  await sleep(800);
  // confirm 在 headless 默认可能被自动接受或阻塞；这里直接检查 DB 变化
  await sleep(1500);
  const wordsAfter = await cdp.eval(idb('words'));
  const hasMergeWord = await cdp.eval(`new Promise(res => { const rq = indexedDB.open('ielts-words'); rq.onsuccess = () => { const d = rq.result; const tx = d.transaction('words','readonly'); const q = tx.objectStore('words').index('word').get('zebra_merge_test'); q.onsuccess = () => res(!!q.result); }; })`);
  ok('合并导入后出现新词 zebra_merge_test', !!hasMergeWord, fileInj);
  ok('合并导入词数增加', (wordsAfter ?? 0) > (wordsBefore ?? 0), `before=${wordsBefore} after=${wordsAfter}`);

  ws.close();
} catch (e) {
  ok('运行无异常', false, String(e).slice(0, 200));
} finally {
  chrome.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
}
console.log(fail === 0 ? `\nM6/M7 冒烟全部通过 (${pass})` : `\n${fail} 项失败 (通过 ${pass})`);
process.exit(fail === 0 ? 0 : 1);
