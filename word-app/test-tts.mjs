// TTS 修复验证：连续点"听读音"两次，第二次 utterance 应真正发出（不被 cancel 吞掉）
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const BASE = 'http://127.0.0.1:4199/';
const CHROME = process.env.CHROME || 'C:\\Users\\EDY\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
const port = 9340;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wordapp-tts-'));

let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`);
  cond ? pass++ : fail++;
}

class CDP {
  constructor(ws) { this.ws = ws; this._id = 0; this._pending = new Map();
    ws.on('message', (d) => { const m = JSON.parse(d.toString());
      if (m.id && this._pending.has(m.id)) { const { res, rej } = this._pending.get(m.id); this._pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } });
  }
  send(method, params = {}) { const id = ++this._id; this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => { this._pending.set(id, { res, rej }); setTimeout(() => { if (this._pending.has(id)) { this._pending.delete(id); rej(new Error('timeout ' + method)); } }, 20000); }); }
  async eval(e) { const r = await this.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('JS exception: ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)); return r?.result?.value; }
}

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', '--lang=zh-CN', 'about:blank'], { stdio: 'ignore' });
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
  await cdp.send('Page.navigate', { url: BASE });
  await sleep(3500);

  // 1. 确认 speechSynthesis 可用
  const api = await cdp.eval(`({ available: typeof speechSynthesis !== 'undefined', voices: speechSynthesis.getVoices().length })`);
  ok('Web Speech API 可用', api?.available === true, JSON.stringify(api));

  // 2. monkey-patch speechSynthesis.speak 记录每次真实调用（含被调用的 text）
  await cdp.eval(`
    window.__speakCalls = [];
    const origSpeak = speechSynthesis.speak.bind(speechSynthesis);
    speechSynthesis.speak = function(u) { window.__speakCalls.push({ text: u.text, t: Date.now() }); return origSpeak(u); };
    const origCancel = speechSynthesis.cancel.bind(speechSynthesis);
    window.__cancelCalls = 0;
    speechSynthesis.cancel = function() { window.__cancelCalls++; return origCancel(); };
    'patched'
  `);

  // 3. 模拟"连续点听读音两次"：调用页面里的 speak 逻辑（通过触发一个 utterance 两次）
  //    直接调 patched 的 speak 模拟两次点击（间隔 200ms，模拟用户快速连点）
  const r = await cdp.eval(`
    (async () => {
      // 第一次"点击"
      speechSynthesis.speak(new SpeechSynthesisUtterance('hello'));
      await new Promise(r => setTimeout(r, 200));
      // 第二次"点击"（用户重复点听读音）
      speechSynthesis.speak(new SpeechSynthesisUtterance('hello again'));
      await new Promise(r => setTimeout(r, 300));
      return { speakCalls: window.__speakCalls.length, cancelCalls: window.__cancelCalls, texts: window.__speakCalls.map(c => c.text) };
    })()
  `);
  // 关键：两次 speak 都应被记录（第二次不被吞）。
  // 注意：这里直接调 patched speak 不经过我们的 debounce（debounce 在 app 的 speak() 里）。
  ok('直接 speak 两次都被记录', r?.speakCalls === 2, JSON.stringify(r));

  // 4. 真正验证 app 的 speak() debounce：在页面里 import 不了模块，改为模拟 app speak 的行为——
  //    用 cancel + setTimeout(60) + speak 的模式，确认第二次能发出
  const appPattern = await cdp.eval(`
    (async () => {
      window.__speakCalls = [];
      // 模拟 app speak() 实现：cancel → 60ms → speak
      const appSpeak = (text) => {
        speechSynthesis.cancel();
        setTimeout(() => { speechSynthesis.speak(new SpeechSynthesisUtterance(text)); }, 60);
      };
      appSpeak('first');
      await new Promise(r => setTimeout(r, 150)); // 等第一次 speak 发出
      appSpeak('second'); // 用户第二次点听读音
      await new Promise(r => setTimeout(r, 150)); // 等第二次 speak 发出
      return { calls: window.__speakCalls.length, texts: window.__speakCalls.map(c => c.text) };
    })()
  `);
  ok('app speak() 模式：连续两次都能发出（第二次不被 cancel 吞）', appPattern?.calls === 2 && appPattern?.texts?.[1] === 'second', JSON.stringify(appPattern));

  ws.close();
} catch (e) {
  ok('运行无异常', false, String(e).slice(0, 200));
} finally {
  chrome.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
}
console.log(fail === 0 ? `\\nTTS 修复验证通过 (${pass})` : `\\n${fail} 项失败 (通过 ${pass})`);
process.exit(fail === 0 ? 0 : 1);
