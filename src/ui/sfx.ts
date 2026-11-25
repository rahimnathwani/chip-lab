// Zero-asset synthesized Web Audio feedback for Chip Lab.
let ctx: AudioContext | null = null;
let muted = false;

export function setMuted(v: boolean): void {
  muted = v;
}

function audio(): AudioContext | null {
  if (muted || typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function tone(
  freq: number,
  duration: number,
  opts: { type?: OscillatorType; gain?: number; endFreq?: number; delay?: number } = {},
): void {
  const c = audio();
  if (!c) return;
  const now = c.currentTime + (opts.delay ?? 0);
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = opts.type ?? 'triangle';
  osc.frequency.setValueAtTime(freq, now);
  if (opts.endFreq) osc.frequency.exponentialRampToValueAtTime(opts.endFreq, now + duration);
  const peak = opts.gain ?? 0.07;
  g.gain.setValueAtTime(0.0001, now);
  g.gain.linearRampToValueAtTime(peak, now + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.connect(g);
  g.connect(c.destination);
  osc.start(now);
  osc.stop(now + duration + 0.02);
}

export const sfx = {
  snap() {
    tone(440, 0.06, { endFreq: 620, gain: 0.065 });
  },
  wire() {
    tone(560, 0.075, { type: 'sine', endFreq: 840, gain: 0.06 });
  },
  snip() {
    tone(320, 0.07, { endFreq: 160, gain: 0.055 });
  },
  toggle(on: boolean) {
    tone(on ? 500 : 340, 0.055, { type: 'sine', endFreq: on ? 680 : 260, gain: 0.055 });
  },
  tick() {
    tone(740, 0.035, { type: 'triangle', gain: 0.045 });
  },
  fail() {
    tone(220, 0.15, { type: 'sawtooth', endFreq: 140, gain: 0.04 });
  },
  win() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => tone(f, 0.22, { type: 'triangle', gain: 0.075, delay: i * 0.08 }));
  },
};
