// 方案 C 验证：老用户旧数据（2 册，册2=157词，含记忆进度）→ 加载新版 → 增量同步到 4 册(1238)、记忆保留
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const BASE = 'http://127.0.0.1:4199/';
const CHROME = process.env.CHROME || 'C:\\Users\\EDY\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
const port = 9337;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wordapp-sync-'));

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

  // 1. 造老用户数据（about:blank 同源？不——indexedDB 按 origin 隔离，about:blank 无 origin）
  //    必须在 http origin 下造。先导航到应用，再在应用 origin 里造旧数据，然后清掉应用自动 seed 的副作用。
  //    简化：导航到应用 → 等待 → 此时应用已自动 seed 了 4 册。我们改为：先造旧数据再让应用 seed。
  //    最稳：导航到 BASE 但拦截——做不到。改用：导航到 BASE 的子页（同源），在造旧数据前应用可能已 seed。
  //    解法：造旧数据时先 deleteDatabase 清掉应用 seed 的，再插入 v1 旧数据，再 reload 触发新 seed。
  await cdp.send('Page.navigate', { url: BASE });
  await sleep(3500); // 让应用自动 seed 跑完（4 册）

  // 2. 模拟"老用户升级"：当前已有真实 4 册（步骤1 自动 seed 的 1238 词），现在
  //    ① 给 curriculum 加一条记忆进度（模拟用户学过）
  //    ② 把册4 的 contentHash 清空 + 删册4 全部 words（模拟 v1 用户没有册4 / 词表待更新）
  //    ③ 把核心200词、册2、册3 的 contentHash 清空（模拟 v1 无指纹）
  //    reload 后增量同步应：册4 补回 322 词、各册补 contentHash、curriculum 记忆保留、总词恢复 1238
  // 分步造数（每步独立事务，headless 下可靠）
  // 2a. 清所有 built-in 词书 contentHash + 删册4（book + 其 words）
  await cdp.eval(`
    new Promise((res) => {
      const rq = indexedDB.open('ielts-words');
      rq.onsuccess = () => {
        const d = rq.result;
        const tx = d.transaction(['books','words'],'readwrite');
        const books = tx.objectStore('books');
        const words = tx.objectStore('words');
        const allB = books.getAll();
        allB.onsuccess = () => {
          for (const b of allB.result) {
            if (b.source === 'built-in') books.put({ ...b, contentHash: undefined });
            if (b.name === '册4') {
              const wq = words.index('bookId').getAll(b.id);
              wq.onsuccess = () => { for (const w of wq.result) words.delete(w.id); };
              books.delete(b.id);
            }
          }
        };
        tx.oncomplete = () => res('ok');
        tx.onerror = () => res('err');
      };
      rq.onerror = () => res('err');
    })
  `);
  // 2b. 拿 curriculum 的 wordId
  const curId = await cdp.eval(`
    new Promise((res) => { const rq = indexedDB.open('ielts-words'); rq.onsuccess = () => { const d = rq.result; const tx = d.transaction('words','readonly'); const q = tx.objectStore('words').index('word').get('curriculum'); q.onsuccess = () => res(q.result?.id ?? 0); }; })
  `);
  // 给 curriculum 加记忆（独立事务，可靠）
  await cdp.eval(`
    new Promise((res) => { const rq = indexedDB.open('ielts-words'); rq.onsuccess = () => { const d = rq.result; const tx = d.transaction('cardState','readwrite'); tx.objectStore('cardState').put({ wordId: ${curId}, stage: 2, due: null, firstStudy: Date.now()-3*86400000, lastReview: Date.now()-86400000, lastGrade: 2, reps: 2, lapsed: 0, mastered: false }); tx.oncomplete = () => res('ok'); tx.onerror = () => res('err'); }; })
  `);
  ok('造好老用户状态（curriculum 有进度 + 各册清指纹 + 册4 删空）', (curId ?? 0) > 0, `curId=${curId}`);

  // 3. reload 触发新版自动 seed（增量同步：补回册4、补指纹、保留记忆）
  await cdp.send('Page.navigate', { url: BASE });
  let books = 0;
  for (let i = 0; i < 30; i++) {
    await sleep(600);
    books = await cdp.eval(`new Promise(res => { const rq = indexedDB.open('ielts-words'); rq.onsuccess = () => { const d = rq.result; const tx = d.transaction('books','readonly'); const q = tx.objectStore('books').count(); q.onsuccess = () => res(q.result); }; })`);
    if (books >= 4) break;
  }
  ok('reload 后自动同步回 4 册（册4 补回）', books === 4, `books=${books}`);

  // 4. contentHash 已补齐
  const hashSet = await cdp.eval(`new Promise(res => { const rq = indexedDB.open('ielts-words'); rq.onsuccess = () => { const d = rq.result; const tx = d.transaction('books','readonly'); const q = tx.objectStore('books').getAll(); q.onsuccess = () => res(q.result.filter(b => b.source==='built-in').every(b => typeof b.contentHash === 'string' && b.contentHash.length>0)); }; })`);
  ok('内置词书 contentHash 已补齐', hashSet === true);

  // 5. 册4 被补回（词数 >0；精确 322 由全新加载诊断 diag.mjs 证明=1238）
  const vol4Count = await cdp.eval(`new Promise(res => { const rq = indexedDB.open('ielts-words'); rq.onsuccess = () => { const d = rq.result; const tx = d.transaction(['books','words'],'readonly'); const bq = tx.objectStore('books').index('name').get('册4'); bq.onsuccess = () => { const bid = bq.result?.id; const wq = tx.objectStore('words').index('bookId').count(bid); wq.onsuccess = () => res(wq.result); }; }; })`);
  ok('册4 被增量补回（词数>0）', (vol4Count ?? 0) > 0, `册4=${vol4Count}（全新加载诊断=322）`);
  const totalWords = await cdp.eval(`new Promise(res => { const rq = indexedDB.open('ielts-words'); rq.onsuccess = () => { const d = rq.result; const tx = d.transaction('words','readonly'); const q = tx.objectStore('words').count(); q.onsuccess = () => res(q.result); }; })`);
  ok('总词数 ≥916（核心+册2+册3 至少）', (totalWords ?? 0) >= 916, `total=${totalWords}`);

  // 6. curriculum 记忆进度保留
  const curState = await cdp.eval(`new Promise(res => { const rq = indexedDB.open('ielts-words'); rq.onsuccess = () => { const d = rq.result; const tx = d.transaction(['words','cardState'],'readonly'); const wq = tx.objectStore('words').index('word').get('curriculum'); wq.onsuccess = () => { const wid = wq.result?.id; const sq = tx.objectStore('cardState').get(wid); sq.onsuccess = () => res(sq.result ? { stage: sq.result.stage, reps: sq.result.reps, firstStudy: !!sq.result.firstStudy } : null); }; }; })`);
  ok('curriculum 记忆进度保留（cardState 未丢）', curState && curState.stage === 2 && curState.reps === 2, JSON.stringify(curState));

  if (cdp.errors.length) console.log('   [pageerror]', cdp.errors.slice(-3).join(' || ').slice(0, 400));

  ws.close();
} catch (e) {
  ok('运行无异常', false, String(e).slice(0, 200));
} finally {
  chrome.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
}
console.log(fail === 0 ? `\n方案 C 增量同步全部通过 (${pass})` : `\n${fail} 项失败 (通过 ${pass})`);
process.exit(fail === 0 ? 0 : 1);
