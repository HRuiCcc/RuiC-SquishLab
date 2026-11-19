import { SquishEngine } from './engine.js';
import { GifRecorder, snapshotPNG } from './recorder.js';
import { sampleDataURL, loadImage } from './sample.js';
import { PuniSound } from './audio.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const el = {
  stage: $('#stage'),
  canvas: $('#gl'),
  maskView: $('#maskView'),
  brushCursor: $('#brushCursor'),
  tag: $('#tagText'),
  hint: $('#stageHint'),
  meta: $('#meta'),
  drop: $('#dropOverlay'),
  recBadge: $('#recBadge'),
  recClock: $('#recClock'),
  recProgress: $('#recProgress'),
  encoding: $('#encoding'),
  encodePct: $('#encodePct'),
  uploadBtn: $('#uploadBtn'),
  file: $('#file'),
  power: $('#power'),
  powerOut: $('#powerOut'),
  feelValue: $('#feelValue'),
  recBtn: $('#recBtn'),
  recLabel: $('#recLabel'),
  recSub: $('#recSub'),
  take: $('#take'),
  takeImg: $('#takeImg'),
  takeInfo: $('#takeInfo'),
  saveGif: $('#saveGif'),
  pngBtn: $('#pngBtn'),
  resetBtn: $('#resetBtn'),
  soundBtn: $('#soundBtn'),
  helpBtn: $('#helpBtn'),
  help: $('#help'),
  toast: $('#toast'),
  paintTab: $('#paintTab'),
  playTab: $('#playTab'),
  goPlay: $('#goPlay'),
  modeNote: $('#modeNote'),
  brushbar: $('#brushbar'),
  brushSize: $('#brushSize'),
  softBtn: $('#softBtn'),
  eraserBtn: $('#eraserBtn'),
  undoBtn: $('#undoBtn'),
  clearBtn: $('#clearBtn'),
};

const PRESET_LABEL = { mochi: '麻薯', jelly: '果冻', mallow: '棉花糖', rubber: '橡皮' };
const FEEL_SAVED = 'squish.preset';
const POWER_SAVED = 'squish.power';
const SOUND_SAVED = 'squish.sound';

const read = (key, fallback) => {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};

const write = (key, value) => {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* 隐私模式写不进去也没关系 */
  }
};

const state = {
  preset: read(FEEL_SAVED, 'mochi'),
  power: Number(read(POWER_SAVED, 1)) || 1,
  sound: read(SOUND_SAVED, 'on') !== 'off',
  custom: false,
  rec: 'idle',
  mode: 'play',
  brush: { size: 64, soft: true, erase: false },
};

// 遮罩画布：白色涂过的地方 = 可以捏的顶点。和照片同比例，最长边 960。
const mask = {
  canvas: null,
  ctx: null,
  base: null,
  strokes: [],
  w: 0,
  h: 0,
  has: false,
  coverage: 0,
  centerMask: null,
  spotMask: null,
};

const sound = new PuniSound();
sound.enabled = state.sound;

let engine = null;
let recorder = null;
let takeUrl = null;
let toastTimer = 0;
let stroke = null;

function toast(message) {
  el.toast.textContent = message;
  el.toast.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('is-on'), 2600);
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(
    d.getMinutes(),
  )}`;
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function cloneCanvas(src) {
  const out = document.createElement('canvas');
  out.width = src.width;
  out.height = src.height;
  out.getContext('2d').drawImage(src, 0, 0);
  return out;
}

function updateMeta() {
  if (!engine || !engine.image) return;
  const w = engine.image.width;
  const h = engine.image.height;
  const grid = engine.stats;
  el.meta.textContent = `${w} × ${h} · 网格 ${grid.cols} × ${grid.rows}`;
}

function syncRange() {
  const min = Number(el.power.min);
  const max = Number(el.power.max);
  const pct = ((state.power - min) / (max - min)) * 100;
  el.power.style.setProperty('--pct', `${pct.toFixed(2)}%`);
  el.powerOut.textContent = `${state.power.toFixed(2).replace(/\.?0+$/, '')}×`;
}

function syncPreset() {
  for (const btn of $$('.feel')) {
    const on = btn.dataset.preset === state.preset;
    btn.setAttribute('aria-checked', String(on));
  }
  el.feelValue.textContent = PRESET_LABEL[state.preset] || '麻薯';
}

/* ---------- 遮罩 ---------- */

const stagePoint = (p) => ({
  x: engine.rect.x + (p.x / mask.w) * engine.rect.w,
  y: engine.rect.y + (p.y / mask.h) * engine.rect.h,
});

function sampleMask(g, w, h) {
  const s = w / 900;
  const cheek = (cx, cy) => {
    const r = 132 * s;
    g.save();
    g.translate(cx * s, cy * s);
    g.scale(1, 0.84);
    const grad = g.createRadialGradient(0, 0, 0, 0, 0, r);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.58, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.fill();
    g.restore();
  };
  cheek(286, 545);
  cheek(614, 545);
}

function setupMask(img, { sample = false } = {}) {
  const scale = Math.min(1, 960 / Math.max(img.width, img.height));
  mask.w = Math.max(2, Math.round(img.width * scale));
  mask.h = Math.max(2, Math.round(img.height * scale));
  mask.canvas = document.createElement('canvas');
  mask.canvas.width = mask.w;
  mask.canvas.height = mask.h;
  mask.ctx = mask.canvas.getContext('2d', { willReadFrequently: true });
  mask.strokes = [];
  mask.base = null;
  mask.spotMask = null;

  if (sample) {
    sampleMask(mask.ctx, mask.w, mask.h);
    mask.base = cloneCanvas(mask.canvas);
    mask.spotMask = { x: 614 * (mask.w / 900), y: 545 * (mask.h / 900) };
  }

  engine.setMask(mask.canvas);
  analyzeMask();
}

function analyzeMask() {
  if (!mask.ctx || !engine) return;
  const { w, h } = mask;
  const data = mask.ctx.getImageData(0, 0, w, h).data;
  let count = 0;
  let sx = 0;
  let sy = 0;
  for (let p = 0, i = 3; p < w * h; p++, i += 4) {
    if (data[i] > 24) {
      count++;
      sx += p % w;
      sy += (p / w) | 0;
    }
  }
  mask.coverage = count / (w * h);
  mask.has = count > w * h * 0.0009;
  mask.centerMask = count ? { x: sx / count, y: sy / count } : null;
  syncMaskUI();
}

let flashTimer = 0;

function flashMask() {
  if (!mask.has) {
    el.maskView.hidden = true;
    return;
  }
  el.maskView.hidden = false;
  drawMaskView(true);
  el.maskView.style.transition = 'none';
  el.maskView.style.opacity = '0.82';
  requestAnimationFrame(() => {
    el.maskView.style.transition = 'opacity 0.8s ease 0.45s';
    el.maskView.style.opacity = '0';
  });
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    if (state.mode === 'paint') return;
    el.maskView.hidden = true;
    el.maskView.style.transition = '';
    el.maskView.style.opacity = '';
  }, 1400);
}

function syncMaskUI() {
  el.goPlay.disabled = !mask.has;
  el.undoBtn.disabled = mask.strokes.length === 0;
  el.clearBtn.disabled = !mask.has;
  el.eraserBtn.setAttribute('aria-pressed', String(state.brush.erase));
  el.softBtn.setAttribute('aria-pressed', String(state.brush.soft));
  el.softBtn.textContent = state.brush.soft ? '柔边' : '硬边';

  if (state.rec === 'idle') syncRecordAvailability();
}

function drawMaskView(force = false) {
  if (!mask.canvas || !engine || (!force && state.mode !== 'paint')) return;
  const cw = el.stage.clientWidth;
  const ch = el.stage.clientHeight;
  if (!cw || !ch) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const c = el.maskView;
  if (c.width !== Math.round(cw * dpr) || c.height !== Math.round(ch * dpr)) {
    c.width = Math.round(cw * dpr);
    c.height = Math.round(ch * dpr);
  }
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  const r = engine.rect;
  ctx.drawImage(mask.canvas, r.x, r.y, r.w, r.h);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = 'rgba(255, 143, 163, 0.34)';
  ctx.fillRect(0, 0, cw, ch);
  ctx.globalCompositeOperation = 'source-over';
}

function stampAt(x, y, r, erase, soft) {
  const ctx = mask.ctx;
  const rr = Math.max(0.7, r);
  const grad = ctx.createRadialGradient(x, y, 0, x, y, rr);
  const inner = soft ? 0.52 : 0.93;
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(inner, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.save();
  ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, rr, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function paintSegment(a, b, s) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const step = Math.max(0.8, s.r * 0.22);
  const n = Math.max(1, Math.ceil(dist / step));
  for (let i = 1; i <= n; i++) {
    stampAt(a.x + (dx * i) / n, a.y + (dy * i) / n, s.r, s.erase, s.soft);
  }
}

function maskPoint(e) {
  const box = el.canvas.getBoundingClientRect();
  const r = engine.rect;
  return {
    x: (e.clientX - box.left - r.x) * (mask.w / r.w),
    y: (e.clientY - box.top - r.y) * (mask.h / r.h),
  };
}

function brushRadius() {
  const css = state.brush.size / 2;
  return Math.max(1.5, css * (mask.w / Math.max(1, engine.rect.w)));
}

function startStroke(e) {
  const p = maskPoint(e);
  stroke = {
    r: brushRadius(),
    erase: state.brush.erase,
    soft: state.brush.soft,
    points: [p],
  };
  stampAt(p.x, p.y, stroke.r, stroke.erase, stroke.soft);
  drawMaskView();
  hideHint();
}

function moveStroke(e) {
  if (!stroke) return;
  const p = maskPoint(e);
  const last = stroke.points[stroke.points.length - 1];
  paintSegment(last, p, stroke);
  stroke.points.push(p);
  drawMaskView();
}

function endStroke() {
  if (!stroke) return;
  if (stroke.points.length) {
    const last = stroke.points[stroke.points.length - 1];
    mask.spotMask = { x: last.x, y: last.y };
    mask.strokes.push(stroke);
  }
  stroke = null;
  engine.setMask(mask.canvas);
  analyzeMask();
  drawMaskView();
}

function replayMask() {
  if (!mask.ctx) return;
  mask.ctx.clearRect(0, 0, mask.w, mask.h);
  if (mask.base) mask.ctx.drawImage(mask.base, 0, 0);
  for (const s of mask.strokes) {
    if (!s.points.length) continue;
    stampAt(s.points[0].x, s.points[0].y, s.r, s.erase, s.soft);
    for (let i = 1; i < s.points.length; i++) paintSegment(s.points[i - 1], s.points[i], s);
  }
  engine.setMask(mask.canvas);
  analyzeMask();
  drawMaskView();
}

function undoMask() {
  if (!mask.strokes.length) return;
  mask.strokes.pop();
  if (mask.strokes.length) {
    const last = mask.strokes[mask.strokes.length - 1];
    const p = last.points[last.points.length - 1];
    mask.spotMask = { x: p.x, y: p.y };
  } else {
    mask.spotMask = null;
  }
  replayMask();
}

function clearMask() {
  if (!mask.has) return;
  mask.base = null;
  mask.strokes = [];
  mask.spotMask = null;
  mask.ctx.clearRect(0, 0, mask.w, mask.h);
  engine.setMask(mask.canvas);
  analyzeMask();
  drawMaskView();
  toast('清空了，重新涂一块吧');
}

/* ---------- 模式 ---------- */

function syncRecordAvailability() {
  if (state.rec === 'encoding') {
    el.recBtn.disabled = true;
    return;
  }
  if (state.mode === 'paint') {
    el.recBtn.disabled = true;
    if (state.rec === 'idle') {
      el.recLabel.textContent = '开始录制 GIF';
      el.recSub.textContent = mask.has ? '切到「捏一捏」再录' : '先涂一块，再来录';
    }
  } else {
    el.recBtn.disabled = false;
    if (state.rec === 'idle') {
      el.recLabel.textContent = '开始录制 GIF';
      el.recSub.textContent = '边捏边录，自动停';
    }
  }
}

function setMode(mode, force = false) {
  if (!force && mode === state.mode) return;
  if (!force && mode === 'play' && !mask.has) {
    toast('先涂一块，再去捏');
    return;
  }
  if (state.rec !== 'idle') {
    toast('等这段录完再切');
    return;
  }

  state.mode = mode;
  const paint = mode === 'paint';

  el.paintTab.setAttribute('aria-selected', String(paint));
  el.playTab.setAttribute('aria-selected', String(!paint));
  el.brushbar.hidden = !paint;
  el.goPlay.hidden = !paint;
  el.modeNote.hidden = paint;
  el.maskView.hidden = !paint;
  el.stage.classList.toggle('is-painting', paint);
  el.brushCursor.hidden = true;
  engine.setBreathing(!paint);

  if (paint) {
    clearTimeout(flashTimer);
    el.maskView.style.transition = '';
    el.maskView.style.opacity = '1';
    el.maskView.hidden = false;
    engine.reset();
    drawMaskView();
  } else {
    engine.setMask(mask.canvas);
    el.modeNote.textContent = '按住涂过的地方拖一拖';
    flashMask();
    const spot = mask.spotMask || mask.centerMask;
    if (spot) {
      const p = stagePoint(spot);
      setTimeout(() => engine.poke(p.x, p.y), 80);
      sound.tap();
    }
  }

  syncMaskUI();
  syncRecordAvailability();
}

/* ---------- 笔刷光标 ---------- */

function moveCursor(e) {
  if (state.mode !== 'paint' || e.pointerType === 'touch') {
    el.brushCursor.hidden = true;
    return;
  }
  const box = el.stage.getBoundingClientRect();
  const size = state.brush.size;
  el.brushCursor.hidden = false;
  el.brushCursor.style.width = `${size}px`;
  el.brushCursor.style.height = `${size}px`;
  el.brushCursor.style.transform = `translate(${e.clientX - box.left}px, ${
    e.clientY - box.top
  }px) translate(-50%, -50%)`;
}

function hideCursor() {
  el.brushCursor.hidden = true;
}

/* ---------- 录制 ---------- */

function setRecState(next) {
  state.rec = next;
  const recording = next === 'recording';
  const encoding = next === 'encoding';

  el.recBtn.classList.toggle('is-recording', recording);
  el.recBtn.classList.toggle('is-encoding', encoding);
  el.recBadge.hidden = !recording;
  el.recProgress.hidden = !recording;
  el.uploadBtn.disabled = next !== 'idle';
  el.stage.setAttribute('aria-busy', String(encoding));

  if (recording) {
    el.recBtn.disabled = false;
    el.recLabel.textContent = '停止并保存';
    el.recSub.textContent = '再点一下就停';
    el.recClock.textContent = '0:00';
    el.recProgress.firstElementChild.style.width = '0%';
  } else if (encoding) {
    el.recBtn.disabled = true;
    el.recLabel.textContent = '正在压缩…';
    el.recSub.textContent = 'GIF 在本地生成';
    el.encoding.hidden = false;
    el.encodePct.textContent = '0%';
  } else {
    el.encoding.hidden = true;
    el.recProgress.firstElementChild.style.width = '0%';
    syncRecordAvailability();
  }
}

function hideHint() {
  el.hint.classList.add('is-hidden');
}

function showTake(result) {
  if (takeUrl) URL.revokeObjectURL(takeUrl);
  takeUrl = result.url;
  el.takeImg.src = result.url;
  el.takeInfo.textContent = `${result.width} × ${result.height} · ${formatBytes(
    result.bytes,
  )} · ${result.frames} 帧`;
  el.saveGif.href = result.url;
  el.saveGif.download = `squish-${stamp()}.gif`;
  el.take.hidden = false;
  toast('录好了，先看看预览');
}

async function startRecord() {
  if (state.rec !== 'idle' || !recorder) return;
  if (state.mode !== 'play') {
    toast('先切到「捏一捏」，再录');
    return;
  }
  setRecState('recording');
  el.take.hidden = true;
  hideHint();

  const mat = getComputedStyle(document.documentElement).getPropertyValue('--mat').trim();
  try {
    const result = await recorder.start({
      duration: 4000,
      fps: 12,
      maxEdge: 440,
      background: mat || '#F7FCFF',
    });
    showTake(result);
  } catch (err) {
    toast(err instanceof Error ? err.message : '录制失败，再试一次');
  } finally {
    setRecState('idle');
  }
}

function toggleRecord() {
  if (!recorder) return;
  if (state.rec === 'recording') {
    setRecState('encoding');
    recorder.stop();
  } else if (state.rec === 'idle') {
    startRecord();
  }
}

/* ---------- 其它动作 ---------- */

function pokeCenter() {
  if (!engine || !engine.image) return;
  if (state.mode === 'paint') {
    toast('切到「捏一捏」，再戳');
    return;
  }
  const spot = mask.spotMask || mask.centerMask;
  if (spot) {
    const p = stagePoint(spot);
    engine.poke(p.x, p.y);
  } else {
    engine.poke(engine.rect.w / 2, engine.rect.h / 2);
  }
  hideHint();
  sound.tap();
}

function resetSquish() {
  if (!engine) return;
  engine.reset();
  toast('复位了');
}

async function savePNG() {
  if (!engine || state.rec !== 'idle') return;
  try {
    const blob = await snapshotPNG(engine, 26);
    download(blob, `squish-${stamp()}.png`);
    toast('PNG 存好了，透明底');
  } catch {
    toast('截图失败，再试一次');
  }
}

async function decodeImage(file) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* Safari 旧版本走下面的兜底 */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await loadImage(url);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
}

// 统一画到 canvas 再上传：ImageBitmap 走 texImage2D 时 flipY 的行为和普通图片不一致，
// 会让照片上下颠倒。转成 canvas 之后两条路径就一致了。
function toCanvas(img, max = 1800) {
  const w = img.width;
  const h = img.height;
  const scale = Math.min(1, max / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  if (img.close) img.close();
  return canvas;
}

async function useFile(file) {
  if (!engine) return;
  if (state.rec !== 'idle') {
    toast('等这段录完再换照片');
    return;
  }
  if (!file || !file.type.startsWith('image/')) {
    toast('这个文件不是图片，换 JPG 或 PNG 试试');
    return;
  }
  if (file.size > 24 * 1024 * 1024) {
    toast('图有点大，换一张 24MB 以内的');
    return;
  }

  try {
    const decoded = await decodeImage(file);
    const img = toCanvas(decoded, 1800);
    engine.setImage(img);
    setupMask(img);
    state.custom = true;
    el.tag.textContent = '你的照片';
    updateMeta();
    hideHint();
    setMode('paint', true);
    toast('在照片上涂出想捏的地方');
  } catch {
    toast('这张图读不出来，换一张试试');
  }
}

function onDrop(file) {
  if (file) useFile(file);
}

function clearDrag() {
  el.stage.classList.remove('is-dragover');
  el.drop.hidden = true;
}

async function hero() {
  if (!engine) return;

  engine.onMesh = () => {
    updateMeta();
    drawMaskView();
  };

  el.uploadBtn.addEventListener('click', () => el.file.click());
  el.file.addEventListener('change', () => {
    const file = el.file.files && el.file.files[0];
    el.file.value = '';
    if (file) onDrop(file);
  });

  // 拖进来
  for (const type of ['dragenter', 'dragover']) {
    el.stage.addEventListener(type, (e) => {
      e.preventDefault();
      if (state.rec !== 'idle') return;
      el.stage.classList.add('is-dragover');
      el.drop.hidden = false;
    });
  }
  el.stage.addEventListener('dragleave', (e) => {
    if (!el.stage.contains(e.relatedTarget)) clearDrag();
  });
  el.stage.addEventListener('drop', (e) => {
    e.preventDefault();
    clearDrag();
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) onDrop(file);
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    if (!el.stage.contains(e.target)) e.preventDefault();
  });

  // 粘贴
  window.addEventListener('paste', (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const item of items) {
      if (item.type && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          useFile(file);
          break;
        }
      }
    }
  });

  // 指针
  const active = new Set();

  el.canvas.addEventListener('pointerdown', (e) => {
    if (state.rec === 'encoding') return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    el.canvas.setPointerCapture?.(e.pointerId);

    if (state.mode === 'paint') {
      if (stroke) return;
      active.add(e.pointerId);
      startStroke(e);
      return;
    }

    active.add(e.pointerId);
    engine.grab(e.pointerId, e.clientX, e.clientY);
    sound.tap();
    hideHint();
  });

  el.canvas.addEventListener('pointermove', (e) => {
    if (state.mode === 'paint') {
      moveCursor(e);
      if (stroke && active.has(e.pointerId)) moveStroke(e);
      return;
    }
    if (!active.has(e.pointerId)) return;
    engine.move(e.pointerId, e.clientX, e.clientY);
  });

  const endPointer = (e) => {
    if (!active.has(e.pointerId)) return;
    active.delete(e.pointerId);
    if (state.mode === 'paint') {
      endStroke();
      return;
    }
    const { poked } = engine.release(e.pointerId);
    if (!poked) sound.release();
  };
  el.canvas.addEventListener('pointerup', endPointer);
  el.canvas.addEventListener('pointercancel', endPointer);
  el.canvas.addEventListener('lostpointercapture', endPointer);
  el.canvas.addEventListener('pointerleave', hideCursor);

  // 手感
  for (const btn of $$('.feel')) {
    btn.addEventListener('click', () => {
      state.preset = btn.dataset.preset;
      engine.setPreset(state.preset);
      syncPreset();
      write(FEEL_SAVED, state.preset);
    });
  }

  el.power.addEventListener('input', () => {
    state.power = Number(el.power.value);
    engine.setPower(state.power);
    syncRange();
    write(POWER_SAVED, state.power);
  });

  // 涂 / 捏
  el.paintTab.addEventListener('click', () => setMode('paint'));
  el.playTab.addEventListener('click', () => setMode('play'));
  el.goPlay.addEventListener('click', () => setMode('play'));

  el.brushSize.addEventListener('input', () => {
    state.brush.size = Number(el.brushSize.value);
  });

  el.softBtn.addEventListener('click', () => {
    state.brush.soft = !state.brush.soft;
    syncMaskUI();
  });

  el.eraserBtn.addEventListener('click', () => {
    state.brush.erase = !state.brush.erase;
    syncMaskUI();
  });

  el.undoBtn.addEventListener('click', undoMask);
  el.clearBtn.addEventListener('click', clearMask);

  // 录制
  el.recBtn.addEventListener('click', toggleRecord);
  el.saveGif.addEventListener('click', () => toast('GIF 已保存到下载文件夹'));

  el.pngBtn.addEventListener('click', savePNG);
  el.resetBtn.addEventListener('click', resetSquish);

  el.soundBtn.addEventListener('click', () => {
    state.sound = !state.sound;
    sound.enabled = state.sound;
    el.soundBtn.setAttribute('aria-pressed', String(state.sound));
    el.soundBtn.setAttribute('aria-label', state.sound ? '关闭音效' : '打开音效');
    write(SOUND_SAVED, state.sound ? 'on' : 'off');
    if (state.sound) sound.tap();
  });

  el.helpBtn.addEventListener('click', () => el.help.showModal());
  el.help.addEventListener('click', (e) => {
    if (e.target === el.help) el.help.close();
  });
  for (const btn of $$('[data-close]', el.help)) {
    btn.addEventListener('click', () => el.help.close());
  }

  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (el.help.open) return;
    const target = e.target;
    if (
      target instanceof Element &&
      target.closest('input, textarea, select, button, a, summary, [contenteditable="true"]')
    ) {
      return;
    }
    const key = e.key.toLowerCase();
    if (e.code === 'Space') {
      e.preventDefault();
      pokeCenter();
    } else if (key === 'r') {
      resetSquish();
    } else if (key === 'g') {
      toggleRecord();
    } else if (key === 'p') {
      savePNG();
    } else if (key === 'b') {
      setMode('paint');
    }
  });

  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', (e) => {
    engine.setReducedMotion(e.matches);
  });

  new ResizeObserver(() => {
    drawMaskView();
    hideCursor();
  }).observe(el.stage);

  // 初始化
  syncPreset();
  syncRange();
  engine.setPreset(state.preset);
  engine.setPower(state.power);
  el.soundBtn.setAttribute('aria-pressed', String(state.sound));
  el.soundBtn.setAttribute('aria-label', state.sound ? '关闭音效' : '打开音效');

  recorder = new GifRecorder(engine);
  recorder.onTick = (frames, ms) => {
    const pct = Math.min(1, ms / 4000);
    el.recClock.textContent = `0:${String(Math.min(9, Math.floor(ms / 1000))).padStart(2, '0')}`;
    el.recProgress.firstElementChild.style.width = `${(pct * 100).toFixed(1)}%`;
  };
  recorder.onEncode = (progress) => {
    setRecState('encoding');
    el.encodePct.textContent = `${Math.round(progress * 100)}%`;
  };

  try {
    const sample = await loadImage(sampleDataURL());
    const sampleCanvas = toCanvas(sample, 1200);
    engine.setImage(sampleCanvas);
    setupMask(sampleCanvas, { sample: true });
    updateMeta();
    setMode('play', true);
  } catch {
    fatal('样品图没载入，选一张自己的照片也能玩。');
  }
}

function fatal(message) {
  el.stage.innerHTML = `<div class="fatal"><b>这台设备跑不动 WebGL</b><span>${message}</span></div>`;
  toast('换个浏览器试试，Chrome、Edge、Safari 都行');
  for (const key of ['uploadBtn', 'recBtn', 'pngBtn', 'resetBtn']) {
    if (el[key]) el[key].disabled = true;
  }
}

(async function boot() {
  try {
    engine = new SquishEngine(el.canvas);
  } catch (err) {
    fatal('照片揉捏需要 WebGL，开一下硬件加速再回来。');
    return;
  }
  await hero();
})();
