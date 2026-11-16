// 浏览器冒烟测试 v2：驱动真实 headless Chrome 走 首次启动→导入→学习卡片→自评 全链路
// 运行: node test-smoke.mjs  （preview 服务器需在 4199）
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const BASE = 'http://127.0.0.1:4199/';
const CHROME = process.env.CHROME || 'C:\\Users\\EDY\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
const port = 9333;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wordapp-smoke-'));

let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`);
  cond ? pass++ : fail++;
}

class CDP {
  constructor(ws) {
    this.ws = ws; this._id = 0; this._pending = new Map(); this.log = []; this.errors = [];
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
      if (m.method === 'Runtime.consoleAPICalled') {
        this.log.push((m.params.args || []).map(a => a.value ?? a.description ?? '').join(' '));
      } else if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        this.errors.push(d?.exception?.description ?? d?.exception?.value ?? d?.text ?? JSON.stringify(d).slice(0, 200));
      }
    });
  }
  send(method, params = {}) {
    const id = ++this._id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => { this._pending.set(id, { res, rej }); setTimeout(() => { if (this._pending.has(id)) { this._pending.delete(id); rej(new Error('timeout ' + method)); } }, 20000); });
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
  ok('Chrome 启动并有页面', !!page);
  if (!page) throw new Error('no page target');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  const cdp = new CDP(ws);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Page.navigate', { url: BASE });
  await sleep(3500);
  // 安装全局错误钩子，捕获导入切换时的第一个真实异常
  await cdp.eval(`window.__errs = []; window.addEventListener('error', e => window.__errs.push((e.error && e.error.stack) || e.message)); window.addEventListener('unhandledrejection', e => window.__errs.push('rejection: ' + (e.reason && e.reason.stack ? e.reason.stack : String(e.reason)))); 'hooked'`);
  if (cdp.log.length) console.log('   [console]', cdp.log.slice(0, 10).join(' | ').slice(0, 400));
  if (cdp.errors.length) console.log('   [pageerror]', cdp.errors.slice(0, 4).join(' || ').slice(0, 500));

  const body1 = await cdp.eval(`document.body ? document.body.innerText : 'NOBODY'`);
  ok('首次启动显示「首次设置」', String(body1).includes('首次设置'), JSON.stringify(String(body1)).slice(0, 60));

  await cdp.eval(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('导入内置词库')).click()`);
  // 导入是异步写库，React live-query 触发 App 从 SetupPage 切回今日页，轮询等待
  let body2 = '';
  for (let i = 0; i < 20; i++) { await sleep(500); body2 = await cdp.eval(`document.body ? document.body.innerText : ''`); if (String(body2).includes('今日')) break; }
  if (!String(body2).includes('今日')) {
    const html = await cdp.eval(`document.getElementById('root') ? document.getElementById('root').innerHTML.length : -1`);
    console.log('   [debug] root innerHTML len =', html);
    const errs = await cdp.eval(`window.__errs ? window.__errs.slice(0,3).join(' ⏎⏎ ') : 'no hook'`);
    console.log('   [debug] page errors:\n' + String(errs).slice(0, 1200));
  }
  ok('导入后进入「今日」', String(body2).includes('今日'), JSON.stringify(String(body2)).slice(0, 60));

  const dbc = await cdp.eval(`new Promise((res) => { const rq = indexedDB.open('ielts-words'); rq.onsuccess = () => { const d = rq.result; const tx = d.transaction(['books','words'],'readonly'); const bc = tx.objectStore('books').count(); const wc = tx.objectStore('words').count(); bc.onsuccess = () => wc.onsuccess = () => res({books: bc.result, words: wc.result}); }; rq.onerror = () => res({error:'open fail'}); })`);
  ok('IndexedDB 词书=2 词量≈387', dbc?.books === 2 && dbc?.words >= 380, JSON.stringify(dbc));

  await cdp.eval(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('开始今日学习')).click()`);
  await sleep(1500);
  let body3 = '';
  for (let i = 0; i < 10; i++) { body3 = await cdp.eval(`document.body ? document.body.innerText : ''`); if (String(body3).includes('听读音')) break; await sleep(400); }
  ok('进入学习卡片页（听读音+显示释义）', String(body3).includes('听读音') && String(body3).includes('显示释义'), JSON.stringify(String(body3)).slice(0, 80));

  await cdp.eval(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('显示释义')).click()`);
  await sleep(600);
  const body4 = await cdp.eval(`document.body.innerText`);
  ok('翻转后出现释义内容', String(body4).length > String(body3).length, `len ${body3.length}->${body4.length}`);

  await cdp.eval(`[...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith('记得')).click()`);
  await sleep(1200);
  const body5 = await cdp.eval(`document.body.innerText`);
  ok('自评后前进到 2 / 30', String(body5).includes('2 / 30'), JSON.stringify(String(body5)).slice(0, 40));

  const csc = await cdp.eval(`new Promise((res) => { const rq = indexedDB.open('ielts-words'); rq.onsuccess = () => { const d = rq.result; const tx = d.transaction(['cardState','reviewLog'],'readonly'); const c = tx.objectStore('cardState').count(); const l = tx.objectStore('reviewLog').count(); c.onsuccess = () => l.onsuccess = () => res({cardState: c.result, reviewLog: l.result}); }; })`);
  ok('cardState 与 reviewLog 各 1 条', csc?.cardState === 1 && csc?.reviewLog === 1, JSON.stringify(csc));

  const tts = await cdp.eval(`({available: typeof speechSynthesis !== 'undefined', voices: speechSynthesis.getVoices().length})`);
  ok('Web Speech API 可用', tts?.available === true, JSON.stringify(tts));

  ws.close();
} catch (e) {
  ok('运行无异常', false, String(e).slice(0, 200));
} finally {
  chrome.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
}
console.log(fail === 0 ? `\n冒烟测试全部通过 (${pass})` : `\n${fail} 项失败 (通过 ${pass})`);
process.exit(fail === 0 ? 0 : 1);
