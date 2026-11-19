// 很轻的合成音，不加载任何音频文件
export class PuniSound {
  constructor() {
    this.enabled = true;
    this.ctx = null;
    this.lastTap = 0;
  }

  _context() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  tap() {
    if (!this.enabled) return;
    const now = performance.now();
    if (now - this.lastTap < 60) return;
    this.lastTap = now;

    const ctx = this._context();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(500, t);
    osc.frequency.exponentialRampToValueAtTime(290, t + 0.085);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.055, t + 0.007);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);

    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.15);
  }

  release() {
    if (!this.enabled) return;
    const ctx = this._context();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(196, t);
    osc.frequency.exponentialRampToValueAtTime(96, t + 0.16);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.04, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);

    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.22);
  }
}
