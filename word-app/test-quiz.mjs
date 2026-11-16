// 自测模式冒烟（真实路径）：导入 → 学 30 个新词 → 自测作答 → 验证 cardState 更新
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const BASE = 'http://127.0.0.1:4199/';
const CHROME = process.env.CHROME || 'C:\\Users\\EDY\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
const port = 9335;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wordapp-quiz-'));

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
  await cdp.send('Page.navigate', { url: BASE });
  await sleep(3000);

  // 1. 进入今日（方案C 自动 seed；若仍在 SetupPage 则手动导入）
  await cdp.eval(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('导入内置词库')); if (b) b.click(); })()`);
  let body = '';
  for (let i = 0; i < 20; i++) { await sleep(500); body = await cdp.eval(`document.body.innerText`); if (String(body).includes('今日')) break; }
  ok('进入今日页', String(body).includes('今日'));

  // 2. 开始今日学习（30 新词），连答 30 个"记得"
  let startBtn = null;
  for (let i = 0; i < 12; i++) {
    startBtn = await cdp.eval(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('开始今日学习')); return b ? { disabled: b.disabled } : null; })()`);
    if (startBtn && !startBtn.disabled) break;
    await sleep(500);
  }
  ok('今日页「开始今日学习」可点', startBtn && !startBtn.disabled, JSON.stringify(startBtn));
  await cdp.eval(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('开始今日学习')).click()`);
  // 等学习卡片页渲染（出现"记得"按钮）
  let gradeBtn = null;
  for (let i = 0; i < 12; i++) {
    gradeBtn = await cdp.eval(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim().startsWith('记得')); return b ? true : null; })()`);
    if (gradeBtn) break;
    await sleep(400);
  }
  ok('进入学习卡片页', !!gradeBtn);
  let reachedDone = false;
  let misses = 0;
  for (let n = 0; n < 40; n++) {
    const t = await cdp.eval(`document.body.innerText`);
    if (String(t).includes('本轮完成')) { reachedDone = true; break; }
    if (n % 5 === 0) console.log(`   [loop ${n}] body="${String(t).replace(/\n/g, ' ⏎ ').slice(0, 80)}"`);
    const clicked = await cdp.eval(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim().startsWith('记得')); if (b) { b.click(); return true; } return false; })()`);
    if (!clicked) {
      misses++;
      if (misses > 12) { console.log(`   [loop ${n}] 连续 ${misses} 帧无「记得」按钮, body="${String(t).slice(0, 60)}"`); break; }
      await sleep(500);
      continue;
    }
    misses = 0;
    // 自适应等待：等 body 变化（推进到下一个词或 Summary），最多 3s
    const prev = String(t);
    for (let w = 0; w < 6; w++) {
      await sleep(500);
      const now2 = await cdp.eval(`document.body.innerText`);
      if (String(now2) !== prev || String(now2).includes('本轮完成')) break;
    }
  }
  if (!reachedDone) {
    if (cdp.errors.length) console.log('   [pageerror]', cdp.errors.slice(-3).join(' ⏎ ').slice(0, 800));
    const rootHtml = await cdp.eval(`document.getElementById('root') ? document.getElementById('root').innerHTML : 'none'`).catch(() => 'eval-fail');
    console.log('   [loop] root innerHTML =', JSON.stringify(String(rootHtml)).slice(0, 300));
  }
  ok('学完 30 个新词（本轮完成）', reachedDone);

  // 3. 返回今日
  await cdp.eval(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('返回今日')).click()`);
  await sleep(1500);

  // 4. 自测按钮应可点
  let quizBtn = null;
  for (let i = 0; i < 10; i++) {
    quizBtn = await cdp.eval(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('自测')); return b ? { disabled: b.disabled } : null; })()`);
    if (quizBtn && !quizBtn.disabled) break;
    await sleep(500);
  }
  ok('自测按钮可点（有已学词）', quizBtn && !quizBtn.disabled, JSON.stringify(quizBtn));

  // 5. 进入自测，答 1 题，验证 cardState 条数=30（只更新不新增）
  await cdp.eval(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('自测')).click()`);
  let quizBody = '';
  for (let i = 0; i < 10; i++) { quizBody = await cdp.eval(`document.body.innerText`); if (String(quizBody).includes('选它的中文释义')) break; await sleep(400); }
  ok('进入自测页', String(quizBody).includes('选它的中文释义'), JSON.stringify(String(quizBody)).slice(0, 50));

  const csBefore = await cdp.eval(`new Promise(res => { const rq = indexedDB.open('ielts-words'); rq.onsuccess = () => { const d = rq.result; const tx = d.transaction('cardState','readonly'); const g = tx.objectStore('cardState').count(); g.onsuccess = () => res(g.result); }; })`);
  await cdp.eval(`(() => { const opts = [...document.querySelectorAll('button')].filter(b => b.className.includes('rounded-2xl') && b.textContent.trim().length > 1 && !b.textContent.includes('退出') && !b.textContent.includes('返回')); if (opts[0]) opts[0].click(); return opts.length; })()`);
  await sleep(1500);
  const csAfter = await cdp.eval(`new Promise(res => { const rq = indexedDB.open('ielts-words'); rq.onsuccess = () => { const d = rq.result; const tx = d.transaction('cardState','readonly'); const g = tx.objectStore('cardState').count(); g.onsuccess = () => res(g.result); }; })`);
  ok('自测作答只更新 cardState（30→30）', csBefore === 30 && csAfter === 30, `before=${csBefore} after=${csAfter}`);

  if (cdp.errors.length) console.log('   [pageerror]', cdp.errors.slice(0, 3).join(' || ').slice(0, 400));

  ws.close();
} catch (e) {
  ok('运行无异常', false, String(e).slice(0, 200));
} finally {
  chrome.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
}
console.log(fail === 0 ? `\n自测冒烟全部通过 (${pass})` : `\n${fail} 项失败 (通过 ${pass})`);
process.exit(fail === 0 ? 0 : 1);
