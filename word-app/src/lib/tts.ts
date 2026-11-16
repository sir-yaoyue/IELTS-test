let voice: SpeechSynthesisVoice | null = null;

function pickVoice() {
  if (typeof speechSynthesis === 'undefined') return;
  const vs = speechSynthesis.getVoices();
  voice =
    vs.find((v) => v.lang === 'en-US' && /Google|Microsoft/i.test(v.name)) ||
    vs.find((v) => v.lang === 'en-US') ||
    vs.find((v) => v.lang?.startsWith('en-GB')) ||
    vs.find((v) => v.lang?.startsWith('en')) ||
    null;
}

export function initTts() {
  if (typeof window === 'undefined' || typeof speechSynthesis === 'undefined') return;
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}

let speakTimer: ReturnType<typeof setTimeout> | null = null;

export function speak(text: string, rate = 0.9) {
  if (typeof speechSynthesis === 'undefined' || !text) return;
  // Chrome/Edge 上 cancel 是异步的，紧接着 speak 会被吞掉（表现为重复点"听读音"没声音）。
  // 先 cancel，再延迟一帧 speak，保证上一句真正停掉后新句才播出。
  speechSynthesis.cancel();
  if (speakTimer) clearTimeout(speakTimer);
  speakTimer = setTimeout(() => {
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.lang = voice?.lang || 'en-US';
    u.rate = rate;
    u.pitch = 1;
    speechSynthesis.speak(u);
    speakTimer = null;
  }, 60);
}

export function stopSpeak() {
  if (typeof speechSynthesis === 'undefined') return;
  speechSynthesis.cancel();
}
