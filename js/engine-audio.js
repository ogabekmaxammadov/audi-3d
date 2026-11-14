// V8 dvigatel ovozini Web Audio orqali sintez qiladi (audio fayl kerak emas).
// Asosiy chastota — silindrlarning o't olish chastotasi: rpm / 60 * 4.

export class EngineAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.active = false;
  }

  get ready() { return !!this.ctx; }

  // Faqat foydalanuvchi harakati (bosish) ichida chaqirilishi kerak.
  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 5; comp.attack.value = 0.005; comp.release.value = 0.2;
    this.master.connect(comp).connect(ctx.destination);

    // --- Dvigatel ohangi: bir nechta garmonika -> distortion -> lowpass
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0.3;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass'; this.filter.frequency.value = 400; this.filter.Q.value = 1.2;
    const shaper = ctx.createWaveShaper();
    shaper.curve = distortionCurve(2.6);
    shaper.oversample = '2x';
    const pre = ctx.createGain();
    pre.gain.value = 0.9;
    pre.connect(shaper).connect(this.filter).connect(this.engineGain).connect(this.master);

    // [chastota ko'paytuvchisi, to'lqin turi, balandlik, detune]
    const voices = [
      [1.0, 'sawtooth', 0.34, 0],
      [0.5, 'sawtooth', 0.42, 6],
      [0.25, 'square', 0.26, -4],   // V8 ga xos "burble"
      [1.5, 'triangle', 0.12, 3],
      [2.0, 'sawtooth', 0.07, -7],
    ];
    this.oscs = voices.map(([mult, type, gain, detune]) => {
      const o = ctx.createOscillator();
      o.type = type; o.frequency.value = 60 * mult; o.detune.value = detune;
      const g = ctx.createGain(); g.gain.value = gain;
      o.connect(g).connect(pre); o.start();
      return { o, mult };
    });

    // Notekis ishlash hissi uchun sekin amplituda modulyatsiyasi
    this.lfo = ctx.createOscillator();
    this.lfo.frequency.value = 13;
    this.lfoGain = ctx.createGain();
    this.lfoGain.gain.value = 0.12;
    this.lfo.connect(this.lfoGain).connect(this.engineGain.gain);
    this.lfo.start();

    // --- Shovqin: so'rish (intake) va shamol
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer(ctx, 2);
    noise.loop = true;
    this.intakeFilter = ctx.createBiquadFilter();
    this.intakeFilter.type = 'bandpass'; this.intakeFilter.frequency.value = 900; this.intakeFilter.Q.value = 0.9;
    this.intakeGain = ctx.createGain(); this.intakeGain.gain.value = 0;
    noise.connect(this.intakeFilter).connect(this.intakeGain).connect(this.master);
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass'; this.windFilter.frequency.value = 300;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
    noise.connect(this.windFilter).connect(this.windGain).connect(this.master);
    noise.start();

    this._applyMaster();
  }

  setActive(on) {
    if (this.active === on) return;
    this.active = on;
    this._applyMaster();
  }

  setMuted(m) {
    this.muted = m;
    this._applyMaster();
  }

  _applyMaster() {
    if (!this.ctx) return;
    const target = this.active && !this.muted ? 0.5 : 0;
    this.master.gain.setTargetAtTime(target, this.ctx.currentTime, target ? 0.08 : 0.35);
  }

  // rpm: 900..8250, throttle: 0..1, speed: 0..1
  update(rpm, throttle, speed) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const f = (rpm / 60) * 4;
    const n = Math.min(1, Math.max(0, (rpm - 900) / 7300));
    for (const { o, mult } of this.oscs) o.frequency.setTargetAtTime(f * mult, t, 0.03);
    this.filter.frequency.setTargetAtTime(260 + n * 2300 + throttle * 1700, t, 0.05);
    this.filter.Q.setTargetAtTime(1.2 + throttle * 2.5, t, 0.08);
    this.engineGain.gain.setTargetAtTime(0.2 + throttle * 0.34 + n * 0.14, t, 0.05);
    this.lfo.frequency.setTargetAtTime(9 + n * 30, t, 0.1);
    this.lfoGain.gain.setTargetAtTime(0.14 * (1 - n * 0.75), t, 0.1);
    this.intakeFilter.frequency.setTargetAtTime(700 + n * 2600, t, 0.08);
    this.intakeGain.gain.setTargetAtTime(throttle * (0.03 + n * 0.1), t, 0.08);
    this.windFilter.frequency.setTargetAtTime(250 + speed * 1500, t, 0.2);
    this.windGain.gain.setTargetAtTime(speed * speed * 0.42, t, 0.2);
  }
}

function distortionCurve(k) {
  const n = 1024, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x);
  }
  return curve;
}

function noiseBuffer(ctx, seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}
