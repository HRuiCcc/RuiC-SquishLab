// 软糯引擎：照片切成三角网格，顶点在着色器里被「拉 + 鼓」，
// 松手后由阻尼弹簧回弹。形变只发生在遮罩权重高的顶点上。
// 参数取自对原站（もちほっぺ・メーカー）的逆向：falloff / ring / lmax / 弹簧。

const MAX_GRABS = 8;
const SHORT_SEGS = 128;
const MAX_SEGS = 192;
const SUBSTEP = 1 / 240;
const MAX_DT = 1 / 30;
const EASE_MS = 60;

export const PRESETS = {
  mochi: { radius: 0.22, stretch: 0.55, freq: 9, zeta: 0.19, bulge: 0.1 },
  jelly: { radius: 0.2, stretch: 0.68, freq: 11.5, zeta: 0.08, bulge: 0.16 },
  mallow: { radius: 0.27, stretch: 0.46, freq: 6.5, zeta: 0.12, bulge: 0.08 },
  rubber: { radius: 0.16, stretch: 0.72, freq: 13, zeta: 0.3, bulge: 0.18 },
};

const VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aRest;

uniform vec2 uSize;      // 图片显示尺寸（css px）
uniform vec2 uOffset;    // 图片左上角（css px）
uniform vec2 uCanvas;    // 画布尺寸（css px）
uniform float uAspect;   // 图片宽高比
uniform int uGrabCount;
uniform vec4 uGrabA[${MAX_GRABS}];   // anchor.xy(iso) / radius / strength
uniform vec2 uGrabPull[${MAX_GRABS}]; // pull.xy(iso)
uniform float uBulge;
uniform sampler2D uMask;
uniform float uMaskEnabled;
uniform vec2 uMaskCell;

out vec2 vRest;

// 中心平坦、边缘平滑收住的衰减
float falloff(float t) {
  float s = 1.0 - t;
  return s * s * s * (6.0 * t * t + 3.0 * t + 1.0);
}

// 在 t=1/3 处最大的一圈：拉的时候周围往外鼓，做出体积感
float ring(float t) {
  return 6.75 * t * (1.0 - t) * (1.0 - t);
}

// 四 taps 平均，避免遮罩边界按顶点分辨率折成锯齿
float maskAt(vec2 uv) {
  vec2 h = uMaskCell * 0.5;
  return 0.25 * (
    textureLod(uMask, uv + vec2(-h.x, -h.y), 0.0).r +
    textureLod(uMask, uv + vec2( h.x, -h.y), 0.0).r +
    textureLod(uMask, uv + vec2(-h.x,  h.y), 0.0).r +
    textureLod(uMask, uv + vec2( h.x,  h.y), 0.0).r
  );
}

void main() {
  vec2 iso = vec2(aRest.x * uAspect, aRest.y);
  vec2 disp = vec2(0.0);
  float wsum = 0.0;

  for (int i = 0; i < ${MAX_GRABS}; i++) {
    if (i >= uGrabCount) break;
    float strength = uGrabA[i].w;
    if (strength <= 0.0) continue;

    vec2 rel = iso - uGrabA[i].xy;
    float d = length(rel);
    float t = clamp(d / max(uGrabA[i].z, 1e-4), 0.0, 1.0);
    float w = falloff(t) * strength;
    vec2 pull = uGrabPull[i];
    vec2 dir = d > 1e-5 ? rel / d : vec2(0.0);

    disp += w * pull + uBulge * length(pull) * ring(t) * dir * strength;
    wsum += w;
  }

  float m = uMaskEnabled > 0.5 ? maskAt(aRest) : 1.0;
  disp *= m / max(1.0, wsum);

  vec2 px = uOffset + aRest * uSize + disp * uSize.y;
  vec2 clip = vec2(px.x / uCanvas.x * 2.0 - 1.0, 1.0 - px.y / uCanvas.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  vRest = aRest;
}
`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vRest;

uniform sampler2D uTex;
uniform vec2 uSize;
uniform float uRadius;

out vec4 outColor;

void main() {
  vec2 halfSize = uSize * 0.5;
  vec2 p = vRest * uSize;
  vec2 d = abs(p - halfSize) - (halfSize - vec2(uRadius));
  float sd = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - uRadius;
  float alpha = 1.0 - smoothstep(-0.7, 0.7, sd);
  if (alpha <= 0.002) discard;

  vec4 c = texture(uTex, vRest);
  outColor = vec4(c.rgb, c.a * alpha);
}
`;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const len2 = (x, y) => Math.hypot(x, y);

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`shader: ${log}`);
  }
  return sh;
}

export class SquishEngine {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 不可用');
    this.gl = gl;

    this.presetName = 'mochi';
    this.params = { ...PRESETS.mochi };
    this.power = 1;
    this.reduced = false;
    this.image = null;
    this.rect = { x: 0, y: 0, w: 0, h: 0 };
    this.cssW = 0;
    this.cssH = 0;
    this.dpr = 1;
    this.aspect = 1;
    this.grabs = [];

    this.maskEnabled = false;
    this.maskData = null;
    this.maskW = 0;
    this.maskH = 0;

    this.grabA = new Float32Array(MAX_GRABS * 4);
    this.grabPull = new Float32Array(MAX_GRABS * 2);

    this._program = this._createProgram();
    this._u = {};
    for (const name of [
      'uSize', 'uOffset', 'uCanvas', 'uAspect', 'uGrabCount', 'uGrabA',
      'uGrabPull', 'uBulge', 'uMask', 'uMaskEnabled', 'uMaskCell',
      'uTex', 'uRadius',
    ]) {
      this._u[name] = gl.getUniformLocation(this._program, name);
    }

    this.imageTex = this._createImageTexture();
    this.maskTex = this._createMaskTexture();

    this.vao = gl.createVertexArray();
    this.meshBuf = gl.createBuffer();
    this.indexBuf = gl.createBuffer();

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    this._onResize = this._onResize.bind(this);
    this._loop = this._loop.bind(this);
    this._ro = new ResizeObserver(this._onResize);
    this._ro.observe(canvas);
    this._resize();

    this.last = performance.now();
    this.raf = requestAnimationFrame(this._loop);
  }

  _createProgram() {
    const gl = this.gl;
    const p = gl.createProgram();
    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(`program: ${gl.getProgramInfoLog(p)}`);
    }
    return p;
  }

  _createImageTexture() {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return t;
  }

  _createMaskTexture() {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([0]));
    return t;
  }

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
    if (this.image) this._layout();
  }

  _onResize() {
    clearTimeout(this._resizeTimer);
    this._resizeTimer = setTimeout(() => this._resize(), 80);
  }

  setImage(image) {
    this.image = image;
    this.aspect = image.width / image.height;
    this._layout();
    this._uploadImage();
    this._buildMesh();
    this.reset();
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

  _uploadImage() {
    const gl = this.gl;
    const img = this.image;
    gl.bindTexture(gl.TEXTURE_2D, this.imageTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  _buildMesh() {
    const gl = this.gl;
    const aspect = this.aspect;
    let cols;
    let rows;
    if (aspect >= 1) {
      cols = Math.min(MAX_SEGS, Math.round(SHORT_SEGS * aspect));
      rows = SHORT_SEGS;
    } else {
      cols = SHORT_SEGS;
      rows = Math.min(MAX_SEGS, Math.round(SHORT_SEGS / aspect));
    }
    this.cols = cols;
    this.rows = rows;

    const verts = new Float32Array(cols * rows * 2);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const idx = j * cols + i;
        verts[idx * 2] = i / (cols - 1);
        verts[idx * 2 + 1] = j / (rows - 1);
      }
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

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuf);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);

    if (typeof this.onMesh === 'function') this.onMesh();
  }

  setMask(maskCanvas) {
    const gl = this.gl;
    if (!maskCanvas) {
      this.maskEnabled = false;
      return;
    }
    const scale = 512 / Math.max(maskCanvas.width, maskCanvas.height);
    const mw = Math.max(2, Math.round(maskCanvas.width * scale));
    const mh = Math.max(2, Math.round(maskCanvas.height * scale));
    const c = document.createElement('canvas');
    c.width = mw;
    c.height = mh;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(maskCanvas, 0, 0, mw, mh);
    const data = ctx.getImageData(0, 0, mw, mh).data;
    const alpha = new Uint8Array(mw * mh);
    for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];

    gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, mw, mh, 0, gl.RED, gl.UNSIGNED_BYTE, alpha);

    this.maskData = alpha;
    this.maskW = mw;
    this.maskH = mh;
    this.maskEnabled = true;
    this.reset();
  }

  maskAtUV(u, v) {
    if (!this.maskEnabled || !this.maskData) return 1;
    const x = clamp(u, 0, 1) * (this.maskW - 1);
    const y = clamp(v, 0, 1) * (this.maskH - 1);
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(this.maskW - 1, x0 + 1);
    const y1 = Math.min(this.maskH - 1, y0 + 1);
    const tx = x - x0;
    const ty = y - y0;
    const d = this.maskData;
    const w = this.maskW;
    const a =
      d[y0 * w + x0] * (1 - tx) * (1 - ty) +
      d[y0 * w + x1] * tx * (1 - ty) +
      d[y1 * w + x0] * (1 - tx) * ty +
      d[y1 * w + x1] * tx * ty;
    return a / 255;
  }

  get S() {
    return Math.min(1, this.aspect);
  }

  lmax() {
    return Math.max(0.0001, this.params.stretch * this.params.radius * this.S * this.power);
  }

  radiusEff(g) {
    const base = this.params.radius * this.S;
    const pull = len2(g.pull.x, g.pull.y);
    return base * (1 + 0.35 * Math.min(1, pull / this.lmax()));
  }

  strengthOf(g) {
    return Math.min(1, (g.ease * 1000) / EASE_MS) * g.weight;
  }

  _dispAt(x, y) {
    let dx = 0;
    let dy = 0;
    let wsum = 0;
    const bulge = this.params.bulge;
    for (const g of this.grabs) {
      const s = this.strengthOf(g);
      if (s <= 0) continue;
      const rx = x - g.anchor.x;
      const ry = y - g.anchor.y;
      const d = len2(rx, ry);
      const t = Math.min(1, d / this.radiusEff(g));
      const w = (function (tt) {
        const q = 1 - tt;
        return q * q * q * (6 * tt * tt + 3 * tt + 1);
      })(t) * s;
      const pull = len2(g.pull.x, g.pull.y);
      const ring = 6.75 * t * (1 - t) * (1 - t);
      const dirX = d > 1e-5 ? rx / d : 0;
      const dirY = d > 1e-5 ? ry / d : 0;
      dx += w * g.pull.x + bulge * pull * ring * dirX * s;
      dy += w * g.pull.y + bulge * pull * ring * dirY * s;
      wsum += w;
    }
    const m = this.maskEnabled ? this.maskAtUV(x / this.aspect, y) : 1;
    const c = m / Math.max(1, wsum);
    return { x: dx * c, y: dy * c };
  }

  _invert(uv) {
    let ix = uv.x;
    let iy = uv.y;
    for (let k = 0; k < 3; k++) {
      const d = this._dispAt(ix * this.aspect, iy);
      ix = uv.x - d.x / this.aspect;
      iy = uv.y - d.y;
    }
    return { x: ix * this.aspect, y: iy };
  }

  _clientToUV(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: (clientX - r.left - this.rect.x) / this.rect.w,
      y: (clientY - r.top - this.rect.y) / this.rect.h,
    };
  }

  grab(id, clientX, clientY) {
    if (!this.image) return false;
    const uv = this._clientToUV(clientX, clientY);
    if (uv.x < 0 || uv.x > 1 || uv.y < 0 || uv.y > 1) return false;
    const weight = this.maskEnabled ? this.maskAtUV(uv.x, uv.y) : 1;
    if (weight < 0.05) return false;
    if (this.grabs.length >= MAX_GRABS) {
      const free = this.grabs.findIndex((g) => g.released);
      if (free >= 0) this.grabs.splice(free, 1);
      else this.grabs.shift();
    }
    const inv = this._invert(uv);
    this.grabs.push({
      id,
      anchor: { x: inv.x, y: inv.y },
      pointer: { x: uv.x * this.aspect, y: uv.y },
      pull: { x: 0, y: 0 },
      vel: { x: 0, y: 0 },
      ease: 0,
      weight,
      released: false,
      startX: clientX,
      startY: clientY,
      moved: 0,
    });
    return true;
  }

  move(id, clientX, clientY) {
    const g = this.grabs.find((a) => a.id === id && !a.released);
    if (!g) return;
    g.moved = Math.max(g.moved, len2(clientX - g.startX, clientY - g.startY));
    const uv = this._clientToUV(clientX, clientY);
    g.pointer.x = uv.x * this.aspect;
    g.pointer.y = uv.y;
  }

  release(id) {
    const g = this.grabs.find((a) => a.id === id && !a.released);
    if (!g) return { poked: false };
    const tap = g.moved < 6 && g.ease < 0.35;
    g.released = true;
    if (tap) {
      const cx = this.aspect * 0.5;
      let dx = g.anchor.x - cx;
      let dy = g.anchor.y - 0.5;
      const d = len2(dx, dy);
      if (d < 1e-4) {
        dx = 0;
        dy = -1;
      } else {
        dx /= d;
        dy /= d;
      }
      const mag = 0.18 * this.lmax();
      g.pull.x += dx * mag;
      g.pull.y += dy * mag;
      return { poked: true };
    }
    return { poked: false };
  }

  poke(x, y) {
    const uv = { x: (x - this.rect.x) / this.rect.w, y: (y - this.rect.y) / this.rect.h };
    if (uv.x < 0 || uv.x > 1 || uv.y < 0 || uv.y > 1) return;
    const weight = this.maskEnabled ? this.maskAtUV(uv.x, uv.y) : 1;
    if (weight < 0.05) return;
    const inv = this._invert(uv);
    const dx = uv.x - 0.5;
    const dy = uv.y - 0.5;
    const d = len2(dx, dy) || 1;
    const mag = 0.18 * this.lmax();
    this.grabs.push({
      id: `poke-${performance.now()}`,
      anchor: { x: inv.x, y: inv.y },
      pointer: { x: uv.x * this.aspect, y: uv.y },
      pull: { x: (dx / d) * mag, y: (dy / d) * mag },
      vel: { x: 0, y: 0 },
      ease: 0.2,
      weight,
      released: true,
      startX: 0,
      startY: 0,
      moved: 99,
    });
  }

  reset() {
    this.grabs.length = 0;
    this.grabA.fill(0);
    this.grabPull.fill(0);
  }

  setPreset(name) {
    if (!PRESETS[name]) return;
    this.presetName = name;
    this.params = { ...PRESETS[name] };
  }

  setPower(v) {
    this.power = clamp(Number(v) || 1, 0.4, 1.6);
  }

  setBreathing() {
    /* 这一版没有自动呼吸，只有手指带来的形变 */
  }

  setReducedMotion(v) {
    this.reduced = Boolean(v);
  }

  _update(dt) {
    if (!this.grabs.length) return;
    const stepDt = Math.min(dt, MAX_DT);
    const n = Math.max(1, Math.ceil(stepDt / SUBSTEP));
    const h = stepDt / n;
    const L = this.lmax();

    for (let i = this.grabs.length - 1; i >= 0; i--) {
      const g = this.grabs[i];
      g.ease += stepDt;

      let tx = 0;
      let ty = 0;
      if (!g.released) {
        const dx = g.pointer.x - g.anchor.x;
        const dy = g.pointer.y - g.anchor.y;
        const d = len2(dx, dy);
        if (d > 1e-9) {
          const mag = L * Math.tanh(d / L);
          tx = (dx / d) * mag;
          ty = (dy / d) * mag;
        }
      }

      const omega = g.released ? 2 * Math.PI * this.params.freq : 80;
      const zeta = g.released ? this.params.zeta : 0.85;
      const k = omega * omega;
      const c = 2 * zeta * omega;
      for (let s = 0; s < n; s++) {
        const ax = k * (tx - g.pull.x) - c * g.vel.x;
        const ay = k * (ty - g.pull.y) - c * g.vel.y;
        g.vel.x += ax * h;
        g.vel.y += ay * h;
        g.pull.x += g.vel.x * h;
        g.pull.y += g.vel.y * h;
      }

      if (
        g.released &&
        len2(g.pull.x, g.pull.y) < 0.001 * this.S &&
        len2(g.vel.x, g.vel.y) < 0.01 * this.S
      ) {
        this.grabs.splice(i, 1);
      }
    }
  }

  _draw() {
    const gl = this.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.image) return;

    const count = Math.min(this.grabs.length, MAX_GRABS);
    for (let i = 0; i < count; i++) {
      const g = this.grabs[i];
      this.grabA[i * 4] = g.anchor.x;
      this.grabA[i * 4 + 1] = g.anchor.y;
      this.grabA[i * 4 + 2] = this.radiusEff(g);
      this.grabA[i * 4 + 3] = this.strengthOf(g);
      this.grabPull[i * 2] = g.pull.x;
      this.grabPull[i * 2 + 1] = g.pull.y;
    }

    gl.useProgram(this._program);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.imageTex);
    gl.uniform1i(this._u.uTex, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
    gl.uniform1i(this._u.uMask, 1);

    gl.uniform2f(this._u.uSize, this.rect.w, this.rect.h);
    gl.uniform2f(this._u.uOffset, this.rect.x, this.rect.y);
    gl.uniform2f(this._u.uCanvas, this.cssW, this.cssH);
    gl.uniform1f(this._u.uAspect, this.aspect);
    gl.uniform1i(this._u.uGrabCount, count);
    gl.uniform4fv(this._u.uGrabA, this.grabA);
    gl.uniform2fv(this._u.uGrabPull, this.grabPull);
    gl.uniform1f(this._u.uBulge, this.params.bulge);
    gl.uniform1f(this._u.uMaskEnabled, this.maskEnabled ? 1 : 0);
    gl.uniform2f(this._u.uMaskCell, 1 / this.cols, 1 / this.rows);
    gl.uniform1f(this._u.uRadius, Math.min(18, this.rect.w / 2, this.rect.h / 2));

    gl.bindVertexArray(this.vao);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);
  }

  _loop(now) {
    this.raf = requestAnimationFrame(this._loop);
    const dt = Math.min((now - this.last) / 1000, 0.064);
    this.last = now;
    this._update(dt);
    this._draw();
  }

  get stats() {
    return { cols: this.cols || 0, rows: this.rows || 0 };
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this._ro.disconnect();
  }
}
