// Small synthesised soundscape: electric whine, wind, cold-gas hiss, landing thumps.
export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(ctx.destination);

    const whine = ctx.createOscillator();
    whine.type = 'sawtooth';
    const whineF = ctx.createBiquadFilter();
    whineF.type = 'lowpass'; whineF.frequency.value = 1800;
    this.whineG = ctx.createGain(); this.whineG.gain.value = 0;
    whine.connect(whineF).connect(this.whineG).connect(this.master);
    whine.start();
    this.whine = whine;

    const hum = ctx.createOscillator();
    hum.type = 'sine';
    this.humG = ctx.createGain(); this.humG.gain.value = 0;
    hum.connect(this.humG).connect(this.master);
    hum.start();
    this.hum = hum;

    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    const mk = (type, freq, q) => {
      const src = ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(f).connect(g).connect(this.master);
      src.start();
      return { f, g };
    };
    this.wind = mk('bandpass', 500, 0.6);
    this.gas = mk('highpass', 2500, 0.7);
    this.tyre = mk('bandpass', 1400, 2);
  }

  update(speed01, throttle, boosting, wallRide, slip, airborne) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const m = this.muted ? 0 : 1;
    this.master.gain.setTargetAtTime(0.5 * m, t, 0.05);
    this.whine.frequency.setTargetAtTime(160 + speed01 * 1400, t, 0.06);
    this.whineG.gain.setTargetAtTime(0.025 + 0.05 * throttle * (1 - speed01 * 0.4), t, 0.08);
    this.hum.frequency.setTargetAtTime(55 + speed01 * 160, t, 0.08);
    this.humG.gain.setTargetAtTime(0.05 + 0.08 * throttle, t, 0.08);
    this.wind.g.gain.setTargetAtTime(Math.min(0.5, speed01 * speed01 * 0.7) , t, 0.1);
    this.wind.f.frequency.setTargetAtTime(300 + speed01 * 1600, t, 0.1);
    this.gas.g.gain.setTargetAtTime(boosting ? 0.3 : 0, t, 0.03);
    const skid = airborne ? 0 : Math.min(0.2, Math.abs(slip) * 0.03) + (wallRide ? 0.05 : 0);
    this.tyre.g.gain.setTargetAtTime(skid, t, 0.05);
  }

  thump(power = 1) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(35, t + 0.3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.7 * Math.min(1, power), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.45);
    this.burst(0.25, 400 + 600 * Math.random(), 0.25 * power);
  }

  burst(dur, freq, vol) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t); src.stop(t + dur + 0.05);
  }

  crash() { this.thump(1); this.burst(0.9, 1800, 0.6); }
  ding() {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    [660, 990].forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + i * 0.08);
      g.gain.exponentialRampToValueAtTime(0.18, t + i * 0.08 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.08 + 0.5);
      o.connect(g).connect(this.master); o.start(t + i * 0.08); o.stop(t + i * 0.08 + 0.55);
    });
  }
}
