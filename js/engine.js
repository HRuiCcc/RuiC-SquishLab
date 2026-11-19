// 一张照片 = 一张弹簧网格。
// 顶点被拽走、邻居互相拉扯、松手后自己弹回来，全部跑在 CPU 上，
// 再交给 WebGL 把纹理贴到变形后的网格上。

export const PRESETS = {
  mochi: { k: 0.15, damp: 0.9, spread: 0.16, radius: 0.26, pull: 1, kick: 7.5 },
  jelly: { k: 0.36, damp: 0.83, spread: 0.2, radius: 0.21, pull: 1, kick: 9 },
  mallow: { k: 0.09, damp: 0.935, spread: 0.11, radius: 0.32, pull: 1, kick: 6 },
  rubber: { k: 0.55, damp: 0.79, spread: 0.17, radius: 0.17, pull: 1, kick: 10 },
};

const VERT = `
attribute vec2 a_rest;
attribute vec2 a_pos;
attribute vec2 a_uv;
attribute float a_weight;
uniform vec2 u_res;
uniform vec2 u_offset;
uniform float u_time;
uniform float u_breath;
varying vec2 v_uv;
varying vec2 v_rest;

void main() {
  vec2 p = a_pos + u_offset;
  float b = sin(u_time * 1.15 + a_rest.x * 0.011 + a_rest.y * 0.014);
  p.y += b * u_breath * a_weight;
  vec2 clip = vec2(p.x / u_res.x * 2.0 - 1.0, 1.0 - p.y / u_res.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  v_uv = a_uv;
  v_rest = a_rest;
}
`;

const FRAG = `
precision mediump float;
varying vec2 v_uv;
varying vec2 v_rest;
uniform sampler2D u_tex;
uniform vec2 u_size;
uniform float u_radius;

void main() {
  vec2 halfSize = u_size * 0.5;
  vec2 d = abs(v_rest - halfSize) - (halfSize - vec2(u_radius));
  float sd = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - u_radius;
  float alpha = 1.0 - smoothstep(-0.7, 0.7, sd);
  if (alpha <= 0.002) discard;
  vec4 c = texture2D(u_tex, v_uv);
  gl_FragColor = vec4(c.rgb, c.a * alpha);
}
`;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`shader: ${log}`);
  }
  return shader;
}

export class SquishEngine {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', {
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL 不可用');
    this.gl = gl;

    this.presetName = 'mochi';
    this.preset = PRESETS.mochi;
    this.power = 1;
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.image = null;
    this.mask = null;
    this.maskData = null;
    this.breathOn = true;
    this.rect = { x: 0, y: 0, w: 0, h: 0 };
    this.cssW = 0;
    this.cssH = 0;
    this.dpr = 1;

    this.grabs = new Map();
    this.time = 0;
    this.acc = 0;
    this.last = performance.now();

    this._program = this._createProgram();
    this._loc = {
      rest: gl.getAttribLocation(this._program, 'a_rest'),
      pos: gl.getAttribLocation(this._program, 'a_pos'),
      uv: gl.getAttribLocation(this._program, 'a_uv'),
      weight: gl.getAttribLocation(this._program, 'a_weight'),
      res: gl.getUniformLocation(this._program, 'u_res'),
      offset: gl.getUniformLocation(this._program, 'u_offset'),
      time: gl.getUniformLocation(this._program, 'u_time'),
      breath: gl.getUniformLocation(this._program, 'u_breath'),
      tex: gl.getUniformLocation(this._program, 'u_tex'),
      size: gl.getUniformLocation(this._program, 'u_size'),
      radius: gl.getUniformLocation(this._program, 'u_radius'),
    };

    this.staticBuf = gl.createBuffer();
    this.posBuf = gl.createBuffer();
    this.indexBuf = gl.createBuffer();
    this.tex = gl.createTexture();

    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    this._onResize = this._onResize.bind(this);
    this._loop = this._loop.bind(this);
    this._resizeObserver = new ResizeObserver(this._onResize);
    this._resizeObserver.observe(canvas);
    this._resize();

    this.raf = requestAnimationFrame(this._loop);
  }

  _createProgram() {
    const gl = this.gl;
    const program = gl.createProgram();
    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`program: ${gl.getProgramInfoLog(program)}`);
    }
    return program;
  }

  // 屏幕尺寸变了：重算画布、照片位置和网格
  _resize() {
    const cw = this.canvas.clientWidth || 1;
    const ch = this.canvas.clientHeight || 1;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const bw = Math.round(cw * dpr);
    const bh = Math.round(ch * dpr);
    if (this.canvas.width !== bw || this.canvas.height !== bh) {
      this.canvas.width = bw;
      this.canvas.height = bh;
    }
    this.cssW = cw;
    this.cssH = ch;
    this.dpr = dpr;
    this.gl.viewport(0, 0, bw, bh);
    if (this.image) {
      this._layout();
      this._buildMesh();
    }
  }

  _onResize() {
    clearTimeout(this._resizeTimer);
    this._resizeTimer = setTimeout(() => this._resize(), 90);
  }

  setImage(image) {
    this.image = image;
    this._layout();
    this._uploadTexture();
    this._buildMesh();
    this.grabs.clear();
  }

  _layout() {
    const cw = this.cssW;
    const ch = this.cssH;
    const iw = this.image.width || 1;
    const ih = this.image.height || 1;
    const scale = Math.min(cw / iw, ch / ih) * 0.955;
    const w = iw * scale;
    const h = ih * scale;
    this.rect = { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
  }

  _uploadTexture() {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.image);
  }

  _buildMesh() {
    const gl = this.gl;
    const { w, h } = this.rect;
    const spacing = Math.max(11, Math.min(w, h) / 52);
    const cols = clamp(Math.round(w / spacing) + 1, 14, 104);
    const rows = clamp(Math.round(h / spacing) + 1, 14, 104);
    this.cols = cols;
    this.rows = rows;

    const count = cols * rows;
    this.rest = new Float32Array(count * 2);
    this.uv = new Float32Array(count * 2);
    this.pos = new Float32Array(count * 2);
    this.vel = new Float32Array(count * 2);
    this.weight = new Float32Array(count);

    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const idx = j * cols + i;
        const x = (i / (cols - 1)) * w;
        const y = (j / (rows - 1)) * h;
        this.rest[idx * 2] = x;
        this.rest[idx * 2 + 1] = y;
        this.pos[idx * 2] = x;
        this.pos[idx * 2 + 1] = y;
        this.uv[idx * 2] = i / (cols - 1);
        this.uv[idx * 2 + 1] = 1 - j / (rows - 1);
        this.weight[idx] = 1;
      }
    }

    this._applyMaskWeights();

    const statics = new Float32Array(count * 5);
    for (let idx = 0; idx < count; idx++) {
      statics[idx * 5] = this.rest[idx * 2];
      statics[idx * 5 + 1] = this.rest[idx * 2 + 1];
      statics[idx * 5 + 2] = this.uv[idx * 2];
      statics[idx * 5 + 3] = this.uv[idx * 2 + 1];
      statics[idx * 5 + 4] = this.weight[idx];
    }

    const indices = new Uint16Array((cols - 1) * (rows - 1) * 6);
    let k = 0;
    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < cols - 1; i++) {
        const a = j * cols + i;
        const b = a + 1;
        const c = a + cols;
        const d = c + 1;
        indices[k++] = a;
        indices[k++] = c;
        indices[k++] = b;
        indices[k++] = b;
        indices[k++] = c;
        indices[k++] = d;
      }
    }
    this.indexCount = indices.length;

    gl.bindBuffer(gl.ARRAY_BUFFER, this.staticBuf);
    gl.bufferData(gl.ARRAY_BUFFER, statics, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.pos, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

    if (typeof this.onMesh === 'function') this.onMesh();
  }

  setMask(maskCanvas) {
    this.mask = maskCanvas || null;
    if (maskCanvas) {
      const ctx = maskCanvas.getContext('2d', { willReadFrequently: true });
      this.maskData = ctx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
    } else {
      this.maskData = null;
    }
    if (this.cols) {
      this._applyMaskWeights();
      this._syncWeights();
    }
    this.reset();
  }

  _applyMaskWeights() {
    if (!this.weight) return;
    const { cols, rows, uv, weight } = this;
    if (!this.maskData) {
      weight.fill(1);
      return;
    }
    const { width: mw, height: mh, data } = this.maskData;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const idx = j * cols + i;
        const fx = uv[idx * 2] * (mw - 1);
        const fy = (1 - uv[idx * 2 + 1]) * (mh - 1);
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const x1 = Math.min(mw - 1, x0 + 1);
        const y1 = Math.min(mh - 1, y0 + 1);
        const tx = fx - x0;
        const ty = fy - y0;
        const a =
          data[(y0 * mw + x0) * 4 + 3] * (1 - tx) * (1 - ty) +
          data[(y0 * mw + x1) * 4 + 3] * tx * (1 - ty) +
          data[(y1 * mw + x0) * 4 + 3] * (1 - tx) * ty +
          data[(y1 * mw + x1) * 4 + 3] * tx * ty;
        weight[idx] = Math.min(1, a / 255);
      }
    }
  }

  _syncWeights() {
    if (!this.staticBuf || !this.weight) return;
    const gl = this.gl;
    const statics = new Float32Array(this.weight.length * 5);
    for (let idx = 0; idx < this.weight.length; idx++) {
      statics[idx * 5] = this.rest[idx * 2];
      statics[idx * 5 + 1] = this.rest[idx * 2 + 1];
      statics[idx * 5 + 2] = this.uv[idx * 2];
      statics[idx * 5 + 3] = this.uv[idx * 2 + 1];
      statics[idx * 5 + 4] = this.weight[idx];
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.staticBuf);
    gl.bufferData(gl.ARRAY_BUFFER, statics, gl.STATIC_DRAW);
  }

  setBreathing(on) {
    this.breathOn = Boolean(on);
  }

  setPreset(name) {
    if (!PRESETS[name]) return;
    this.presetName = name;
    this.preset = PRESETS[name];
  }

  setPower(v) {
    this.power = clamp(Number(v) || 1, 0.4, 1.6);
  }

  setReducedMotion(reduced) {
    this.reduced = Boolean(reduced);
  }

  _localPoint(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }

  grab(id, clientX, clientY) {
    if (!this.image) return;
    const p = this._localPoint(clientX, clientY);
    const t = performance.now();
    this.grabs.set(id, { x0: p.x, y0: p.y, x: p.x, y: p.y, sx: p.x, sy: p.y, t0: t, moved: 0 });
  }

  move(id, clientX, clientY) {
    const g = this.grabs.get(id);
    if (!g) return;
    const p = this._localPoint(clientX, clientY);
    g.moved = Math.max(g.moved, Math.hypot(p.x - g.sx, p.y - g.sy));
    g.x = p.x;
    g.y = p.y;
  }

  release(id) {
    const g = this.grabs.get(id);
    if (!g) return { poked: false };
    this.grabs.delete(id);
    const quick = performance.now() - g.t0 < 320;
    if (g.moved < 6 && quick) {
      this.poke(g.x0, g.y0);
      return { poked: true };
    }
    return { poked: false };
  }

  poke(x, y) {
    if (!this.pos) return;
    const { cols, rows, rest, vel } = this;
    const r = Math.min(this.rect.w, this.rect.h) * this.preset.radius * 0.92;
    const r2 = r * r;
    const kick = this.preset.kick * this.power;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const idx = j * cols + i;
        const dx = rest[idx * 2] - x;
        const dy = rest[idx * 2 + 1] - y;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const d = Math.sqrt(d2);
        const w = (1 - d / r) * this.weight[idx];
        const f = w * w * kick;
        if (d < 0.001) {
          vel[idx * 2] += f * 0.4;
          continue;
        }
        vel[idx * 2] += (dx / d) * f;
        vel[idx * 2 + 1] += (dy / d) * f;
      }
    }
  }

  reset() {
    if (!this.pos) return;
    const { rest, pos, vel } = this;
    for (let i = 0; i < pos.length; i++) {
      pos[i] = rest[i];
      vel[i] = 0;
    }
    this.grabs.clear();
  }

  _step() {
    const { cols, rows, rest, pos, vel } = this;
    const { k, damp, spread } = this.preset;

    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const idx = j * cols + i;
        const p = idx * 2;
        const w = this.weight[idx];
        if (w <= 0.015) {
          pos[p] = rest[p];
          pos[p + 1] = rest[p + 1];
          vel[p] = 0;
          vel[p + 1] = 0;
          continue;
        }
        const px = pos[p];
        const py = pos[p + 1];
        const kk = k * (0.35 + 0.65 * w);

        let ax = (rest[p] - px) * kk;
        let ay = (rest[p + 1] - py) * kk;

        if (spread > 0) {
          const il = i > 0 ? idx - 1 : idx;
          const ir = i < cols - 1 ? idx + 1 : idx;
          const iu = j > 0 ? idx - cols : idx;
          const id = j < rows - 1 ? idx + cols : idx;
          const avgX = (pos[il * 2] + pos[ir * 2] + pos[iu * 2] + pos[id * 2]) * 0.25;
          const avgY = (pos[il * 2 + 1] + pos[ir * 2 + 1] + pos[iu * 2 + 1] + pos[id * 2 + 1]) * 0.25;
          ax += (avgX - px) * spread;
          ay += (avgY - py) * spread;
        }

        let vx = (vel[p] + ax) * damp;
        let vy = (vel[p + 1] + ay) * damp;
        if (vx > 42) vx = 42;
        else if (vx < -42) vx = -42;
        if (vy > 42) vy = 42;
        else if (vy < -42) vy = -42;

        vel[p] = vx;
        vel[p + 1] = vy;
        pos[p] = px + vx;
        pos[p + 1] = py + vy;
      }
    }

    if (this.grabs.size) this._applyGrabs();
  }

  _applyGrabs() {
    const { cols, rows, rest, pos, vel } = this;
    const base = Math.min(this.rect.w, this.rect.h);
    const r = base * this.preset.radius;

    for (const g of this.grabs.values()) {
      const pullX = (g.x - g.x0) * this.power * this.preset.pull;
      const pullY = (g.y - g.y0) * this.power * this.preset.pull;
      // 受力范围钉在按下去的位置，而不是跟着手指跑，否则一拖出涂区就松手了
      const cx = g.x0;
      const cy = g.y0;
      const r2 = r * r;

      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const idx = j * cols + i;
          const p = idx * 2;
          const dx = rest[p] - cx;
          const dy = rest[p + 1] - cy;
          const d2 = dx * dx + dy * dy;
          if (d2 > r2) continue;
          const d = Math.sqrt(d2);
          let w = 1 - d / r;
          w = w * w * (3 - 2 * w) * this.weight[idx];
          if (w <= 0.002) continue;

          const tx = rest[p] + pullX * w;
          const ty = rest[p + 1] + pullY * w;
          const nx = pos[p] + (tx - pos[p]) * 0.62;
          const ny = pos[p + 1] + (ty - pos[p + 1]) * 0.62;

          let vx = (nx - pos[p]) * 0.95;
          let vy = (ny - pos[p + 1]) * 0.95;
          vel[p] = clamp(vx, -46, 46);
          vel[p + 1] = clamp(vy, -46, 46);
          pos[p] = nx;
          pos[p + 1] = ny;
        }
      }
    }
  }

  _loop(now) {
    this.raf = requestAnimationFrame(this._loop);
    const dt = Math.min(now - this.last, 64);
    this.last = now;
    this.time += dt / 1000;

    this.acc = Math.min(this.acc + dt, 60);
    let steps = 0;
    while (this.acc >= 16.666 && steps < 3) {
      this._step();
      this.acc -= 16.666;
      steps++;
    }
    this._draw();
  }

  _draw() {
    const gl = this.gl;
    const { w, h } = this.rect;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.image || !this.pos) return;

    gl.useProgram(this._program);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.pos);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.staticBuf);
    gl.enableVertexAttribArray(this._loc.rest);
    gl.vertexAttribPointer(this._loc.rest, 2, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(this._loc.uv);
    gl.vertexAttribPointer(this._loc.uv, 2, gl.FLOAT, false, 20, 8);
    gl.enableVertexAttribArray(this._loc.weight);
    gl.vertexAttribPointer(this._loc.weight, 1, gl.FLOAT, false, 20, 16);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.enableVertexAttribArray(this._loc.pos);
    gl.vertexAttribPointer(this._loc.pos, 2, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(this._loc.tex, 0);
    gl.uniform2f(this._loc.res, this.cssW, this.cssH);
    gl.uniform2f(this._loc.offset, this.rect.x, this.rect.y);
    gl.uniform1f(this._loc.time, this.time);
    gl.uniform1f(this._loc.breath, this.reduced || !this.breathOn ? 0 : 0.75);
    gl.uniform2f(this._loc.size, w, h);
    gl.uniform1f(this._loc.radius, Math.min(18, w / 2, h / 2));

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuf);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0);
  }

  get stats() {
    return { cols: this.cols || 0, rows: this.rows || 0 };
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this._resizeObserver.disconnect();
  }
}
