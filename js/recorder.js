import { GIFEncoder, quantize, applyPalette } from '../vendor/gifenc.esm.js';

// 把画布上的一小块裁出来，作为 GIF / PNG 的输出范围
export function croppedSource(engine, pad = 16) {
  const { rect, dpr, canvas } = engine;
  const sx = Math.max(0, Math.round((rect.x - pad) * dpr));
  const sy = Math.max(0, Math.round((rect.y - pad) * dpr));
  const sw = Math.min(canvas.width - sx, Math.round((rect.w + pad * 2) * dpr));
  const sh = Math.min(canvas.height - sy, Math.round((rect.h + pad * 2) * dpr));
  return { sx, sy, sw, sh };
}

export class GifRecorder {
  constructor(engine) {
    this.engine = engine;
    this.canvas = engine.canvas;
    this.active = false;
    this.frames = [];
    this.onTick = null;
    this.onEncode = null;
  }

  async start({ duration = 4000, fps = 12, maxEdge = 440, background = '#FCFBF3' } = {}) {
    if (this.active) throw new Error('已经在录了');
    this.active = true;
    this.duration = duration;
    this.fps = fps;
    this.maxEdge = maxEdge;
    this.background = background;
    this.frames = [];

    const { sw, sh } = croppedSource(this.engine, 32);
    const long = Math.max(sw, sh);
    const scale = Math.min(1, maxEdge / long);
    this.outW = Math.max(2, Math.round(sw * scale));
    this.outH = Math.max(2, Math.round(sh * scale));

    this.crop = croppedSource(this.engine, 32);
    this.buf = document.createElement('canvas');
    this.buf.width = this.outW;
    this.buf.height = this.outH;
    this.ctx = this.buf.getContext('2d', { willReadFrequently: true });

    this.startedAt = performance.now();
    this.deadline = this.startedAt + duration;
    this.timer = setInterval(() => this._grab(), 1000 / fps);
    this._grab();

    this.finished = new Promise((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
    });

    this.killer = setTimeout(() => this.stop(), duration + 40);
    return this.finished;
  }

  _grab() {
    if (!this.active) return;
    const { sx, sy, sw, sh } = this.crop;
    this.ctx.fillStyle = this.background;
    this.ctx.fillRect(0, 0, this.outW, this.outH);
    this.ctx.drawImage(this.canvas, sx, sy, sw, sh, 0, 0, this.outW, this.outH);
    const data = this.ctx.getImageData(0, 0, this.outW, this.outH).data;
    this.frames.push(new Uint8ClampedArray(data));
    if (typeof this.onTick === 'function') {
      this.onTick(this.frames.length, performance.now() - this.startedAt);
    }
    if (performance.now() >= this.deadline) this.stop();
  }

  async stop() {
    if (!this.active) return this.finished;
    this.active = false;
    clearInterval(this.timer);
    clearTimeout(this.killer);

    try {
      if (this.frames.length < 2) throw new Error('还没录到画面');
      const result = await this._encode();
      this._resolve(result);
    } catch (err) {
      this._reject(err);
    }
    return this.finished;
  }

  async _encode() {
    const { outW: w, outH: h } = this;
    const gif = GIFEncoder();
    const delay = Math.round(1000 / this.fps);
    const total = this.frames.length;

    for (let i = 0; i < total; i++) {
      const frame = this.frames[i];
      const palette = quantize(frame, 256, { format: 'rgb565' });
      const index = applyPalette(frame, palette, 'rgb565');
      gif.writeFrame(index, w, h, { palette, delay, repeat: 0 });
      if (typeof this.onEncode === 'function') this.onEncode((i + 1) / total);
      if (i % 3 === 2) await new Promise((r) => setTimeout(r, 0));
    }
    gif.finish();
    const bytes = gif.bytes();
    const blob = new Blob([bytes], { type: 'image/gif' });
    this.frames = [];
    return {
      blob,
      url: URL.createObjectURL(blob),
      width: w,
      height: h,
      bytes: blob.size,
      frames: total,
      duration: Math.round(this.duration),
    };
  }

  cancel() {
    this.active = false;
    clearInterval(this.timer);
    clearTimeout(this.killer);
    this.frames = [];
  }
}

export async function snapshotPNG(engine, pad = 16) {
  const { sx, sy, sw, sh } = croppedSource(engine, pad);
  const out = document.createElement('canvas');
  out.width = sw;
  out.height = sh;
  const ctx = out.getContext('2d');
  ctx.drawImage(engine.canvas, sx, sy, sw, sh, 0, 0, sw, sh);
  return new Promise((resolve, reject) => {
    out.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('截图失败'))), 'image/png');
  });
}
