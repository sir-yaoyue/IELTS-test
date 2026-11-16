// 统计页 Tab 布局验证 + 截图：导入→学词→统计页 3 Tab 切换→各截图
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const BASE = 'http://127.0.0.1:4199/';
const CHROME = process.env.CHROME || 'C:\\Users\\EDY\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
const port = 9339;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wordapp-tabs-'));
const SHOT_DIR = process.argv[2] || 'shots';
fs.mkdirSync(SHOT_DIR, { recursive: true });

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
  async shot(file) {
    const r = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(SHOT_DIR, file), Buffer.from(r.data, 'base64'));
    return file;
  }
}

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', '--lang=zh-CN', '--window-size=1000,1400', 'about:blank'], { stdio: 'ignore' });
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
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 1400, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: BASE });
  await sleep(3000);

  // 方案C：新 profile 加载时 App 自动 seed 4 册，直接进今日页（无"导入"按钮）；
  // 若仍是 SetupPage（自动 seed 失败）则手动点导入
  await cdp.eval(`window.confirm = () => true; 'hooked'`);
  let body = '';
  let onSetup = false;
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    body = await cdp.eval(`document.body.innerText`);
    if (String(body).includes('今日')) break;
    onSetup = String(body).includes('首次设置');
  }
  if (onSetup) {
    await cdp.eval(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('导入内置词库')); if (b) b.click(); })()`);
    for (let i = 0; i < 20; i++) { await sleep(500); body = await cdp.eval(`document.body.innerText`); if (String(body).includes('今日')) break; }
  }
  ok('进入今日页（自动 seed 或手动导入）', String(body).includes('今日'), onSetup ? '经手动导入' : '自动 seed');
  let startClicked = false;
  for (let i = 0; i < 12; i++) {
    startClicked = await cdp.eval(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('开始今日学习')); if (b && !b.disabled) { b.click(); return true; } return false; })()`);
    if (startClicked) break;
    await sleep(500);
  }
  ok('点击了开始今日学习', startClicked);
  for (let i = 0; i < 10; i++) { await sleep(400); if (String(await cdp.eval(`document.body.innerText`)).includes('听读音')) break; }
  for (let n = 0; n < 6; n++) {
    const mix = n % 3; // 0=忘了 1=模糊 2=记得，制造有遗忘的数据
    const label = mix === 0 ? '忘了' : mix === 1 ? '模糊' : '记得';
    const clicked = await cdp.eval(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim().startsWith('${label}')); if (b) { b.click(); return true; } return false; })()`);
    if (!clicked) break;
    await sleep(950);
  }
  // 退出学习
  await cdp.eval(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('退出') || x.textContent.includes('返回今日')); if (b) b.click(); return !!b; })()`);
  await sleep(1500);

  // 进统计页
  await cdp.eval(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '统计').click()`);
  await sleep(1500);

  // 验证 3 个 Tab 按钮存在
  const tabBtns = await cdp.eval(`[...document.querySelectorAll('button')].filter(b => ['总览','记忆','词书'].includes(b.textContent.trim())).length`);
  ok('统计页有 3 个 Tab 按钮（总览/记忆/词书）', tabBtns === 3, `tabs=${tabBtns}`);

  // 默认总览 Tab：应有指标条 + 14天学习量 + 词书汇总入口
  let overviewBody = await cdp.eval(`document.body.innerText`);
  ok('总览 Tab 显示指标（总词量/已学习）', String(overviewBody).includes('总词量') && String(overviewBody).includes('已学习'));
  ok('总览 Tab 显示近14天学习量', String(overviewBody).includes('近 14 天学习量'));
  ok('总览 Tab 显示词书进度汇总入口', String(overviewBody).includes('词书进度'));
  await cdp.shot('01-overview.png');

  // 切到记忆 Tab
  await cdp.eval(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '记忆').click()`);
  await sleep(1000);
  let memBody = await cdp.eval(`document.body.innerText`);
  ok('记忆 Tab 显示记忆效果(A)', String(memBody).includes('记忆效果'));
  ok('记忆 Tab 显示掌握阶段分布(B)', String(memBody).includes('掌握阶段分布'));
  ok('记忆 Tab 显示遗忘曲线(D)', String(memBody).includes('遗忘曲线'));
  const memSvg = await cdp.eval(`document.querySelectorAll('svg').length`);
  ok('记忆 Tab 渲染了图表 SVG', memSvg >= 2, `svg=${memSvg}`);
  await cdp.shot('02-memory.png');

  // 切到词书 Tab
  await cdp.eval(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '词书').click()`);
  await sleep(1000);
  const bookCount = await cdp.eval(`[...document.querySelectorAll('div')].filter(d => d.className?.includes('h-2.5')).length`);
  const bookTabText = await cdp.eval(`document.body.innerText`);
  // 词书名以 seed.ts 为准（当前：基础话题/高频核心/学术领域/拓展应用）
  const hasAllBooks = ['基础话题', '高频核心', '学术领域', '拓展应用'].every((n) => String(bookTabText).includes(n));
  ok('词书 Tab 显示各册进度', hasAllBooks && bookCount >= 4, `册名齐全=${hasAllBooks} 进度条=${bookCount}`);
  await cdp.shot('03-books.png');

  if (cdp.errors.length) console.log('   [pageerror]', cdp.errors.slice(-3).join(' || ').slice(0, 400));

  ws.close();
} catch (e) {
  ok('运行无异常', false, String(e).slice(0, 200));
} finally {
  chrome.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
}
console.log(fail === 0 ? `\n统计页 Tab 布局全部通过 (${pass})，截图在 ${SHOT_DIR}/` : `\n${fail} 项失败 (通过 ${pass})`);
process.exit(fail === 0 ? 0 : 1);
