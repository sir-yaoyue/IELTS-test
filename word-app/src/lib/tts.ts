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

export function speak(text: string, rate = 0.9) {
  if (typeof speechSynthesis === 'undefined' || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  if (voice) u.voice = voice;
  u.lang = voice?.lang || 'en-US';
  u.rate = rate;
  u.pitch = 1;
  speechSynthesis.speak(u);
}

export function stopSpeak() {
  if (typeof speechSynthesis === 'undefined') return;
  speechSynthesis.cancel();
}
