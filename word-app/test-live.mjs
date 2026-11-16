// 线上版验证：对 https://ielts-test-2ls.pages.dev 跑 导入→今日→词库数 核心链路
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const BASE = process.env.SMOKE_BASE || 'https://ielts-test-2ls.pages.dev/';
const CHROME = process.env.CHROME || 'C:\\Users\\EDY\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
const port = 9345;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wordapp-live-'));

let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`);
  cond ? pass++ : fail++;
}

class CDP {
  constructor(ws) { this.ws = ws; this._id = 0; this._p = new Map();
    ws.on('message', (d) => { const m = JSON.parse(d.toString());
      if (m.id && this._p.has(m.id)) { const { res, rej } = this._p.get(m.id); this._p.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } });
  }
  send(m, p = {}) { const id = ++this._id; this.ws.send(JSON.stringify({ id, method: m, params: p }));
    return new Promise((res, rej) => { this._p.set(id, { res, rej }); setTimeout(() => { if (this._p.has(id)) { this._p.delete(id); rej(new Error('timeout ' + m)); } }, 30000); }); }
  async eval(e) { const r = await this.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('JS exc: ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)); return r?.result?.value; }
}

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', '--lang=zh-CN', 'about:blank'], { stdio: 'ignore' });
try {
  let t = [];
  for (let i = 0; i < 60; i++) { await sleep(300); try { t = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (t.length) break; } catch {} }
  const page = t.find(x => x.type === 'page');
  if (!page) throw new Error('no page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });
  const cdp = new CDP(ws);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Page.navigate', { url: BASE });
  await sleep(4000);

  const title = await cdp.eval('document.title');
  ok('线上页面标题=单词本·雅思', String(title).includes('单词本'), title);

  // body 可能因 PWA 首次 SW 注册/网络慢而延迟挂载，轮询等待
  let body = '';
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    body = await cdp.eval(`document.body ? document.body.innerText : ''`);
    if (String(body).includes('首次设置') || String(body).includes('今日')) break;
  }
  ok('线上进入首次设置/今日页', String(body).includes('首次设置') || String(body).includes('今日'), JSON.stringify(String(body)).slice(0, 50));

  // 自动 seed（方案C）：新 profile 加载即导入 4 册；若仍在首次设置则手动点
  await cdp.eval(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('导入内置词库')); if (b) b.click(); })()`);
  let b2 = '';
  for (let i = 0; i < 20; i++) { await sleep(500); b2 = await cdp.eval(`document.body ? document.body.innerText : ''`); if (String(b2).includes('今日')) break; }
  ok('线上导入词库成功→今日页', String(b2).includes('今日'), JSON.stringify(String(b2)).slice(0, 40));

  const wc = await cdp.eval(`new Promise(r => { const q = indexedDB.open('ielts-words'); q.onsuccess = () => { const d = q.result; const t = d.transaction('words', 'readonly'); t.objectStore('words').count().onsuccess = e => r(e.target.result); }; })`);
  ok('线上词库=1238 词', wc === 1238, 'words=' + wc);

  const bc = await cdp.eval(`new Promise(r => { const q = indexedDB.open('ielts-words'); q.onsuccess = () => { const d = q.result; const t = d.transaction('books', 'readonly'); t.objectStore('books').count().onsuccess = e => r(e.target.result); }; })`);
  ok('线上词书=4 册', bc === 4, 'books=' + bc);

  ws.close();
} catch (e) {
  ok('无异常', false, String(e).slice(0, 150));
} finally {
  chrome.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
}
console.log(fail === 0 ? `\n线上版验证全部通过 (${pass}) — ${BASE}` : `\n${fail} 项失败 (通过 ${pass}) — ${BASE}`);
process.exit(fail === 0 ? 0 : 1);
