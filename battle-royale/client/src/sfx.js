// Procedural sound effects with the Web Audio API: no audio files to download or license.
// Positional sounds get quieter with distance from the listener and pan left/right.

const HEAR_DIST = 1000; // px; sounds further than this are silent
const PAN_DIST = 500;   // px of horizontal offset for full left/right pan

const WEAPON_SOUNDS = {
  pistol:   { noise: [{ type: "bandpass", freq: 1800, dur: 0.12, vol: 0.5 }], thump: [180, 60, 0.08, 0.3] },
  revolver: { noise: [{ type: "lowpass", freq: 1400, dur: 0.25, vol: 0.8 }], thump: [130, 40, 0.15, 0.5] },
  smg:      { noise: [{ type: "bandpass", freq: 2600, dur: 0.07, vol: 0.4 }], thump: [220, 90, 0.05, 0.25] },
  shotgun:  { noise: [{ type: "lowpass", freq: 900, dur: 0.38, vol: 1.0 }], thump: [90, 30, 0.25, 0.7] },
  sniper:   {
    noise: [{ type: "highpass", freq: 3000, dur: 0.05, vol: 0.7 }, { type: "lowpass", freq: 600, dur: 0.7, vol: 0.6 }],
    thump: [70, 30, 0.4, 0.7],
  },
};

export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.listener = { x: 0, y: 0 };
  }

  // Browsers only allow audio after a user gesture; call this from input handlers.
  unlock() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.45;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
  }

  toggleMute() {
    this.muted = !this.muted;
    return this.muted;
  }

  setListener(x, y) {
    this.listener.x = x;
    this.listener.y = y;
  }

  // Output node for a sound at (x, y), or the master bus when no position is given.
  out(x, y, vol = 1) {
    if (!this.ctx || this.muted || this.ctx.state !== "running") return null;
    const gain = this.ctx.createGain();
    if (x === undefined) {
      gain.gain.value = vol;
      gain.connect(this.master);
      return gain;
    }
    const dx = x - this.listener.x, dy = y - this.listener.y;
    const falloff = 1 - Math.hypot(dx, dy) / HEAR_DIST;
    if (falloff <= 0) return null;
    gain.gain.value = vol * falloff * falloff;
    const pan = this.ctx.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, dx / PAN_DIST));
    gain.connect(pan).connect(this.master);
    return gain;
  }

  noise(dest, { type = "lowpass", freq = 1000, dur = 0.1, vol = 0.5, delay = 0 }) {
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(vol, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(env).connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  tone(dest, { wave = "sine", f0 = 440, f1 = f0, dur = 0.1, vol = 0.3, delay = 0 }) {
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    osc.type = wave;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    env.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(env).connect(dest);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  // --- game sounds ---------------------------------------------------------

  shot(weapon, x, y) {
    const spec = WEAPON_SOUNDS[weapon] ?? WEAPON_SOUNDS.pistol;
    const dest = this.out(x, y);
    if (!dest) return;
    for (const n of spec.noise) this.noise(dest, n);
    const [f0, f1, dur, vol] = spec.thump;
    this.tone(dest, { wave: "square", f0, f1, dur, vol: vol * 0.4 });
  }

  hit(x, y) {
    const dest = this.out(x, y, 0.8);
    if (dest) this.noise(dest, { type: "bandpass", freq: 700, dur: 0.08, vol: 0.6 });
  }

  hitMarker() {
    const dest = this.out();
    if (dest) this.tone(dest, { wave: "triangle", f0: 1500, dur: 0.05, vol: 0.25 });
  }

  hurt() {
    const dest = this.out();
    if (!dest) return;
    this.tone(dest, { wave: "sine", f0: 140, f1: 60, dur: 0.18, vol: 0.6 });
    this.noise(dest, { type: "lowpass", freq: 400, dur: 0.12, vol: 0.4 });
  }

  step(x, y, vol = 0.18) {
    const dest = this.out(x, y, vol);
    if (dest) this.noise(dest, { type: "lowpass", freq: 350 + Math.random() * 150, dur: 0.06, vol: 1 });
  }

  reload() {
    const dest = this.out();
    if (!dest) return;
    this.noise(dest, { type: "bandpass", freq: 3200, dur: 0.03, vol: 0.5 });
    this.tone(dest, { wave: "square", f0: 900, dur: 0.03, vol: 0.1 });
    this.noise(dest, { type: "bandpass", freq: 2400, dur: 0.04, vol: 0.5, delay: 0.3 });
    this.tone(dest, { wave: "square", f0: 700, dur: 0.04, vol: 0.1, delay: 0.3 });
  }

  empty() {
    const dest = this.out();
    if (dest) this.tone(dest, { wave: "square", f0: 1300, dur: 0.02, vol: 0.12 });
  }

  pickup() {
    const dest = this.out();
    if (!dest) return;
    this.tone(dest, { wave: "triangle", f0: 520, f1: 880, dur: 0.12, vol: 0.3 });
    this.tone(dest, { wave: "triangle", f0: 880, f1: 1320, dur: 0.12, vol: 0.25, delay: 0.1 });
  }

  kill() {
    const dest = this.out();
    if (!dest) return;
    this.tone(dest, { wave: "sine", f0: 880, dur: 0.15, vol: 0.35 });
    this.tone(dest, { wave: "sine", f0: 1320, dur: 0.25, vol: 0.3, delay: 0.08 });
  }

  death() {
    const dest = this.out();
    if (dest) this.tone(dest, { wave: "sawtooth", f0: 300, f1: 50, dur: 0.7, vol: 0.3 });
  }

  zoneTick() {
    const dest = this.out();
    if (dest) this.tone(dest, { wave: "square", f0: 220, dur: 0.12, vol: 0.12 });
  }

  siren() {
    const dest = this.out();
    if (!dest) return;
    for (let i = 0; i < 2; i++) {
      this.tone(dest, { wave: "sawtooth", f0: 380, f1: 720, dur: 0.6, vol: 0.1, delay: i * 1.2 });
      this.tone(dest, { wave: "sawtooth", f0: 720, f1: 380, dur: 0.6, vol: 0.1, delay: i * 1.2 + 0.6 });
    }
  }

  beep(high = false) {
    const dest = this.out();
    if (dest) this.tone(dest, { wave: "sine", f0: high ? 990 : 660, dur: high ? 0.35 : 0.12, vol: 0.3 });
  }

  crateLanded(x, y) {
    const dest = this.out(x, y, 1.2);
    if (!dest) return;
    this.noise(dest, { type: "bandpass", freq: 1200, dur: 0.5, vol: 0.2 });
    this.noise(dest, { type: "lowpass", freq: 250, dur: 0.4, vol: 0.9, delay: 0.45 });
    this.tone(dest, { wave: "sine", f0: 90, f1: 40, dur: 0.3, vol: 0.5, delay: 0.45 });
  }

  victory() {
    const dest = this.out();
    if (!dest) return;
    [523, 659, 784, 1046].forEach((f, i) => this.tone(dest, { wave: "triangle", f0: f, dur: i === 3 ? 0.6 : 0.16, vol: 0.3, delay: i * 0.15 }));
  }

  defeat() {
    const dest = this.out();
    if (!dest) return;
    [392, 330, 262].forEach((f, i) => this.tone(dest, { wave: "triangle", f0: f, dur: i === 2 ? 0.6 : 0.22, vol: 0.3, delay: i * 0.22 }));
  }
}
