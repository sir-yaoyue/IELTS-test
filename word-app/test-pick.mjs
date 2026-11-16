// 选词（购物车）流程验证：导入→今日→选词面板→勾选→开始学选中→会话=选中集
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const BASE = 'http://127.0.0.1:4199/';
const CHROME = process.env.CHROME || 'C:\\Users\\EDY\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
const port = 9343;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wordapp-pick-'));
const SHOT = 'shots';
fs.mkdirSync(SHOT, { recursive: true });

let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`);
  cond ? pass++ : fail++;
}

class CDP {
  constructor(ws) { this.ws = ws; this._id = 0; this._pending = new Map(); this.errors = [];
    ws.on('message', (d) => { const m = JSON.parse(d.toString());
      if (m.id && this._pending.has(m.id)) { const { res, rej } = this._pending.get(m.id); this._pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
      else if (m.method === 'Runtime.exceptionThrown') { const x = m.params.exceptionDetails; this.errors.push(x?.exception?.description ?? x?.text ?? 'exc'); } });
  }
  send(method, params = {}) { const id = ++this._id; this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => { this._pending.set(id, { res, rej }); setTimeout(() => { if (this._pending.has(id)) { this._pending.delete(id); rej(new Error('timeout ' + method)); } }, 25000); }); }
  async eval(e) { const r = await this.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('JS exception: ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)); return r?.result?.value; }
  async shot(file) { const r = await this.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SHOT, file), Buffer.from(r.data, 'base64')); }
}

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', '--lang=zh-CN', '--window-size=900,1100', 'about:blank'], { stdio: 'ignore' });
try {
  let targets = [];
  for (let i = 0; i < 50; i++) { await sleep(300); try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (targets.length) break; } catch {} }
  const page = targets.find(t => t.type === 'page');
  if (!page) throw new Error('no page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  const cdp = new CDP(ws);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 1100, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: BASE });
  await sleep(3500);

  // 1. 进今日页（自动 seed）
  let body = '';
  for (let i = 0; i < 20; i++) { await sleep(500); body = await cdp.eval(`document.body.innerText`); if (String(body).includes('开始今日学习')) break; }
  ok('进入今日页', String(body).includes('开始今日学习'));

  // 2. 点"选词"按钮打开面板
  await cdp.eval(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '选词'); if (b) b.click(); return !!b; })()`);
  await sleep(1000);
  body = await cdp.eval(`document.body.innerText`);
  ok('选词面板打开（出现清空选择+开始学选中的词）', String(body).includes('清空选择') && String(body).includes('开始学选中的词'));
  await cdp.shot('07-picker-open.png');

  // 3. 搜索 "cur" 过滤，勾选匹配的前 2 个词
  await cdp.eval(`(() => { const inp = document.querySelector('input[placeholder*="搜索"]'); if (inp) { const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; setter.call(inp, 'cur'); inp.dispatchEvent(new Event('input', { bubbles: true })); } return !!inp; })()`);
  await sleep(800);
  const matchCount = await cdp.eval(`[...document.querySelectorAll('button')].filter(b => b.textContent.trim() === '✓' || (b.className.includes('rounded-lg') && b.querySelector('span.truncate'))).length`);
  // 勾选搜索结果里的词（点含 truncate span 的词按钮）
  const picked2 = await cdp.eval(`(() => { let n = 0; const btns = [...document.querySelectorAll('button')].filter(b => b.querySelector('span.truncate')); for (const b of btns) { if (n >= 2) break; b.click(); n++; } return n; })()`);
  await sleep(600);
  ok('勾选了 2 个词', picked2 === 2, `picked=${picked2} 搜索匹配=${matchCount}`);
  body = await cdp.eval(`document.body.innerText`);
  ok('按钮显示"已选 2 词"', String(body).includes('已选 2 词'));
  await cdp.shot('08-picker-2.png');

  // 4. 点"开始学选中的词"→ 应进入学习页，进度 1 / 2（只学选中的 2 个，不含复习/错词因为都是新词无到期）
  await cdp.eval(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('开始学选中的词')); if (b) b.click(); return !!b; })()`);
  await sleep(1500);
  let studyBody = '';
  for (let i = 0; i < 10; i++) { studyBody = await cdp.eval(`document.body.innerText`); if (String(studyBody).includes('/ 2')) break; await sleep(400); }
  ok('进入学习页且会话=2 个（选中的词）', String(studyBody).includes('1 / 2'), JSON.stringify(String(studyBody)).slice(0, 50));
  await cdp.shot('09-study-picked.png');

  // 5. 验证：学完 2 个 → 本轮完成（会话确实只有 2 个，不是 30）
  for (let n = 0; n < 4; n++) {
    const clicked = await cdp.eval(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim().startsWith('记得')); if (b) { b.click(); return true; } return false; })()`);
    if (!clicked) break;
    await sleep(1000);
  }
  let endBody = '';
  for (let i = 0; i < 10; i++) { endBody = await cdp.eval(`document.body.innerText`); if (String(endBody).includes('本轮完成')) break; await sleep(400); }
  ok('学完 2 个即"本轮完成"（会话=2，非30）', String(endBody).includes('本轮完成') && String(endBody).includes('共 2 个'), JSON.stringify(String(endBody)).slice(0, 60));

  // 6. 验证购物车已清空（返回今日后"选词"按钮不再是"已选 N 词"）
  await cdp.eval(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('返回今日')); if (b) b.click(); return !!b; })()`);
  await sleep(1200);
  const pickBtn = await cdp.eval(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '选词' || x.textContent.includes('已选')); return b ? b.textContent.trim() : null; })()`);
  ok('学习后购物车已清空（按钮回到"选词"）', pickBtn === '选词', `按钮="${pickBtn}"`);

  if (cdp.errors.length) console.log('   [pageerror]', cdp.errors.slice(-3).join(' || ').slice(0, 400));

  ws.close();
} catch (e) {
  ok('运行无异常', false, String(e).slice(0, 200));
} finally {
  chrome.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
}
console.log(fail === 0 ? `\n选词功能全部通过 (${pass})，截图在 ${SHOT}/` : `\n${fail} 项失败 (通过 ${pass})`);
process.exit(fail === 0 ? 0 : 1);
