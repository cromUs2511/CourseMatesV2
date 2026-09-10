// Clean Web Audio synthesizer for subtle tactile feedback
let audioContext: AudioContext | null = null;
const SOUND_SETTING_KEY = 'coursemates_chat_sound';

export function getSoundEnabled() {
  try {
    return localStorage.getItem(SOUND_SETTING_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function setSoundEnabled(enabled: boolean) {
  try {
    localStorage.setItem(SOUND_SETTING_KEY, String(enabled));
  } catch {
    // Audio remains available for this session when storage is unavailable.
  }
}

export function playChime(type: 'match' | 'message' | 'timer' | 'purge' | 'click') {
  if (!getSoundEnabled()) return;
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = audioContext ??= new AudioCtx();
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});

    if (type === 'click') {
      // Short bell click with a bright harmonic overtone.
      const now = ctx.currentTime;
      [880, 1320].forEach((frequency, index) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(frequency, now);
        gain.gain.setValueAtTime(index === 0 ? 0.06 : 0.025, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.18);
      });
    } else if (type === 'match') {
      // Pleasant rising harmonic chime
      const now = ctx.currentTime;
      [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + i * 0.08);
        gain.gain.setValueAtTime(0.12, now + i * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.08);
        osc.stop(now + i * 0.08 + 0.4);
      });
    } else if (type === 'message') {
      // Slightly longer bell notification.
      const now = ctx.currentTime;
      [659.25, 987.77].forEach((frequency, index) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(frequency, now + index * 0.025);
        gain.gain.setValueAtTime(index === 0 ? 0.08 : 0.035, now + index * 0.025);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + index * 0.025);
        osc.stop(now + 0.3);
      });
    } else if (type === 'timer') {
      // Double warm bell
      const now = ctx.currentTime;
      [880, 1174.66].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + i * 0.15);
        gain.gain.setValueAtTime(0.15, now + i * 0.15);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.15 + 0.5);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.15);
        osc.stop(now + i * 0.15 + 0.6);
      });
    } else if (type === 'purge') {
      // Low descending swoosh
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(110, ctx.currentTime + 0.25);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
    }
  } catch {
    // Gracefully handle browser autoplay restriction
  }
}
