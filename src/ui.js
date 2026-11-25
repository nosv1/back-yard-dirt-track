// Backyard Track Lab page: drawing, page state, saved layouts and the controls. The yard math lives in core.js.
// Rule 5 here: a failed check throws, and guard() catches it at the event handler and shows it in the panel.
// Data read back from browser storage is checked field by field; bad entries are skipped, not trusted.
import {
  ASPECT, BATCH, CONCERN_DB, GROUPS, HILL, HOUSE, LOT_L, LOT_W, MAX_CIRCLES, MAX_R, MIN_GRASS, MIN_R, NOISE,
  OBSTACLES, RANK_NAMES, TAU, at, buildCircleTrack, check, circleProblems, closestPass, distTo, features,
  fullThrottleShare, lapSim, neighbors, noiseAt, quickLayout, randomCircles, rng, solveCircles,
} from './core.js';

/** @typedef {import('./core.js').Track} Track */
/** @typedef {import('./core.js').Feat} Feat */
/** @typedef {import('./core.js').Sim} Sim */
/** @typedef {import('./core.js').Sample} Sample */
/** @typedef {import('./core.js').Pt} Pt */
/** @typedef {import('./core.js').Ring} Ring */
/** @typedef {import('./core.js').Placed} Placed */
/** @typedef {import('./core.js').Layout} Layout */
/** @typedef {import('./core.js').Neighbor} Neighbor */
/** @typedef {import('./core.js').Concerns} Concerns */
/** @typedef {import('./core.js').Concern} Concern */
/** @typedef {import('./core.js').Gaps} Gaps */
/** @typedef {import('./core.js').Rank} Rank */
/** @typedef {import('./core.js').HubDir} HubDir */
/**
 * @typedef {{ bg: string, fg: string, muted: string, grass: string, grass2: string, dirt: string, edge: string,
 *   tape: string, bad: string, house: string, chalk: string, panel: string, loud: string, part: string,
 *   cool: string }} Palette
 */
/** @typedef {{ ctx: CanvasRenderingContext2D, s: number, ox: number, oy: number, col: Palette }} Pen */
/** @typedef {{ list: Placed[], hub: number, bad: Set<number>, sel: number, dir: number }} Rings */
/** @typedef {{ nbs: Neighbor[], concerns: Concerns, gaps: Gaps, quietFrom: number, noiseMap: boolean }} Overlay */
/**
 * @typedef {{ thumb: boolean, width: number, track: Track | null, sim: Sim | null, rings: Rings | null,
 *   overlay: Overlay | null }} YardOpts
 */
/** @typedef {{ ox: number, oy: number, s: number }} Geo */
/** @typedef {{ x: number, y: number, r: number }} CircleSpec */
/**
 * @typedef {{ width: number, hubDir: HubDir, rank: Rank, useAll: boolean, gaps: Gaps, concerns: Concerns,
 *   quietDepth: number }} Settings
 */
/**
 * A saved layout. Circles by position; hub and pick index into circles. pick is the chosen loop (null if none).
 * @typedef {{ name: string, at: number, circles: CircleSpec[], hub: number, pick: { i: number, s: number }[] | null,
 *   settings: Settings, len: number, time: number }} Saved
 */
/**
 * @typedef {{ width: number, geo: Geo | null, circles: Placed[], nextId: number, hub: number, csel: number,
 *   cpick: number, csol: Layout[], cbad: Set<number>, drag: { id: number, dx: number, dy: number } | null,
 *   tap: { w: Pt, sx: number, sy: number } | null, useAll: boolean, rank: Rank, hubDir: HubDir, gaps: Gaps,
 *   noiseMap: boolean, quietDepth: number, concerns: Concerns, resizeTimer: number }} UiState
 */

const MAIN_M = Object.freeze({ l: 34, r: 10, t: 40, b: 30 });
const THUMB_M = Object.freeze({ l: 3, r: 3, t: 3, b: 3 });
const EXAMPLE = Object.freeze([
  { x: 72, y: 160, r: 30 }, { x: 118, y: 62, r: 20 }, { x: 35, y: 90, r: 20 },
  { x: 138, y: 140, r: 16 }, { x: 40, y: 235, r: 22 }, { x: 125, y: 240, r: 20 },
]);
const SAVE_KEY = 'backyard-track-lab.saves.v1';
const MAX_SAVES = 30;
const RANDOM_TRIES = 12;
/** @type {readonly Rank[]} */
const RANKS = Object.freeze(['both', 'quiet', 'longest']);
/** @type {readonly HubDir[]} */
const HUB_DIRS = Object.freeze(['either', 'ccw', 'cw']);
/** @type {readonly Concern[]} */
const LEVELS = Object.freeze(['high', 'some', 'none']);

/**
 * Everything the controls change, shared by the render and event functions (module state, rule 6):
 * the circles, the roundabout (hub), the selected circle (cpick), the solutions (csol) and the settings.
 * @type {UiState}
 */
const state = {
  width: 10, geo: null, circles: [], nextId: 1, hub: 0, csel: 0, cpick: -1, csol: [], cbad: new Set(),
  drag: null, tap: null, useAll: false, rank: 'both', hubDir: 'either',
  gaps: { back: 45, north: 30, south: 75 }, noiseMap: true, quietDepth: 100,
  concerns: { back: 'high', north: 'some', south: 'none' }, resizeTimer: 0,
};

/* ---------- DOM access with checks ---------- */

/** @param {string} id @returns {HTMLElement} */
function el(id) {
  const e = document.getElementById(id);
  check(e !== null, 'the page is missing #' + id);
  return e;
}

/** @param {string} id @returns {HTMLInputElement} */
function inputEl(id) {
  const e = el(id);
  check(e instanceof HTMLInputElement, '#' + id + ' should be an input');
  return e;
}

/** @param {string} id @returns {HTMLSelectElement} */
function selectEl(id) {
  const e = el(id);
  check(e instanceof HTMLSelectElement, '#' + id + ' should be a select');
  return e;
}

/** @param {Element} e @returns {HTMLCanvasElement} */
function asCanvas(e) {
  check(e instanceof HTMLCanvasElement, 'expected a canvas');
  return e;
}

const mainCanvas = asCanvas(el('main'));

/** @param {string} text @param {boolean} err */
function msg(text, err) {
  const e = el('msg');
  e.textContent = text;
  e.classList.toggle('err', err);
}

/** Runs fn and shows any failure in the panel instead of breaking the page. @param {() => void} fn */
function safely(fn) {
  try {
    fn();
  } catch (e) {
    state.drag = null;
    msg('Something broke: ' + (e instanceof Error ? e.message : String(e)), true);
  }
}

/** @param {(ev: Event) => void} fn @returns {(ev: Event) => void} */
function guard(fn) {
  return (ev) => { safely(() => { fn(ev); }); };
}

/* ---------- formatting ---------- */

/** @param {number} sec */
function fmtTime(sec) {
  const mm = Math.floor(sec / 60);
  return String(mm) + ':' + (sec - mm * 60).toFixed(1).padStart(4, '0');
}
/** @param {number} ms */
function mph(ms) { return String(Math.round(ms / 0.44704)) + ' mph'; }
/** @param {number} x */
function ft(x) { return Math.round(x).toLocaleString() + ' ft'; }
/** @param {number} x */
function dB(x) { return (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(1) + ' dB'; }

/* ---------- drawing ---------- */

/** @returns {Palette} */
function palette() {
  const cs = getComputedStyle(document.documentElement);
  /** @param {string} n */
  const g = (n) => cs.getPropertyValue(n).trim();
  return { bg: g('--bg'), fg: g('--fg'), muted: g('--muted'), grass: g('--grass'), grass2: g('--grass-2'),
    dirt: g('--dirt'), edge: g('--dirt-edge'), tape: g('--tape'), bad: g('--bad'), house: g('--house'),
    chalk: g('--chalk'), panel: g('--panel'), loud: g('--loud'), part: g('--part'), cool: g('--cool') };
}

/** @param {Pen} pen @param {number} x */
function px(pen, x) { return pen.ox + x * pen.s; }
/** @param {Pen} pen @param {number} y */
function py(pen, y) { return pen.oy + (LOT_L - y) * pen.s; }

/** Sizes the canvas to its CSS box and returns a pen, or null while it has no size. @param {HTMLCanvasElement} canvas @param {boolean} thumb */
function makePen(canvas, thumb) {
  const W = canvas.clientWidth, H = canvas.clientHeight;
  if (W < 10 || H < 10) { return null; }
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext('2d');
  check(ctx !== null, 'canvas 2d is unavailable');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const m = thumb ? THUMB_M : MAIN_M;
  const s = Math.min((W - m.l - m.r) / LOT_W, (H - m.t - m.b) / LOT_L);
  const col = palette();
  ctx.fillStyle = thumb ? col.panel : col.bg;
  ctx.fillRect(0, 0, W, H);
  return { ctx, s, ox: m.l + (W - m.l - m.r - LOT_W * s) / 2, oy: m.t, col };
}

/** @param {Pen} pen @param {Pt[]} pts @param {boolean} close */
function strokePath(pen, pts, close) {
  const ctx = pen.ctx;
  ctx.beginPath();
  pts.forEach((p, i) => {
    if (i === 0) { ctx.moveTo(px(pen, p.x), py(pen, p.y)); } else { ctx.lineTo(px(pen, p.x), py(pen, p.y)); }
  });
  if (close) { ctx.closePath(); }
  ctx.stroke();
}

/** A small arrowhead at p pointing along u. @param {Pen} pen @param {Pt} p @param {Pt} u @param {number} z */
function chevron(pen, p, u, z) {
  strokePath(pen, [{ x: p.x - u.x * z - u.y * z, y: p.y - u.y * z + u.x * z }, p,
    { x: p.x - u.x * z + u.y * z, y: p.y - u.y * z - u.x * z }], false);
}

/** Grass and mow stripes. @param {Pen} pen */
function drawGround(pen) {
  const { ctx, col, s } = pen;
  ctx.fillStyle = col.grass;
  ctx.fillRect(px(pen, 0), py(pen, LOT_L), LOT_W * s, LOT_L * s);
  ctx.fillStyle = col.grass2;
  for (let y = 0; y < LOT_L; y += 40) {
    const top = Math.min(LOT_L, y + 20);
    ctx.fillRect(px(pen, 0), py(pen, top), LOT_W * s, (top - y) * s);
  }
}

/** @param {Pen} pen */
function drawFence(pen) {
  const { ctx, col, s } = pen;
  ctx.strokeStyle = col.fg; ctx.globalAlpha = 0.55; ctx.lineWidth = 1;
  ctx.strokeRect(px(pen, 0) + 0.5, py(pen, LOT_L) + 0.5, LOT_W * s - 1, LOT_L * s - 1);
  ctx.globalAlpha = 1;
}

/** Red where full throttle carries to a neighbour he cares about. @param {Pen} pen @param {Overlay} ov */
function drawNoiseMap(pen, ov) {
  const { ctx, col, s } = pen, cell = 6;
  ctx.fillStyle = col.loud;
  for (let y = 0; y < LOT_L; y += cell) {
    for (let x = 0; x < LOT_W; x += cell) {
      const w = Math.min(cell, LOT_W - x), h = Math.min(cell, LOT_L - y);
      const t = Math.max(0, Math.min(1, (loudestHere(ov, x + w / 2, y + h / 2) + 12) / 12));
      if (t <= 0) { continue; }
      ctx.globalAlpha = 0.42 * t;
      ctx.fillRect(px(pen, x), py(pen, y + h), w * s + 0.5, h * s + 0.5);
    }
  }
  ctx.globalAlpha = 1;
}

/** Full throttle at (x, y), as heard by the neighbour it bothers most. @param {Overlay} ov @param {number} x @param {number} y */
function loudestHere(ov, x, y) {
  let L = -Infinity;
  for (const nb of ov.nbs) {
    const off = CONCERN_DB[ov.concerns[nb.group]];
    if (off !== null) { L = Math.max(L, off - 20 * Math.log10(distTo(nb, x, y) / NOISE.ref)); }
  }
  return L;
}

/** @param {Pen} pen @param {number} line y of the ease-off line */
function drawQuietLine(pen, line) {
  if (line >= LOT_L) { return; }
  const { ctx, col } = pen;
  ctx.strokeStyle = col.fg; ctx.globalAlpha = 0.75; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
  strokePath(pen, [{ x: 0, y: line }, { x: LOT_W, y: line }], false);
  ctx.setLineDash([]);
  ctx.fillStyle = col.fg; ctx.font = '600 11px "Barlow Condensed", "Arial Narrow", sans-serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
  ctx.fillText('EASE OFF ↑', px(pen, 0) + 4, py(pen, line) - 2);
  ctx.globalAlpha = 1;
}

/** House block, hill contours, keep-out rings. @param {Pen} pen @param {boolean} thumb */
function drawFeatures(pen, thumb) {
  const { ctx, col, s } = pen;
  ctx.fillStyle = col.house;
  ctx.fillRect(px(pen, HOUSE.x0), py(pen, HOUSE.y1), (HOUSE.x1 - HOUSE.x0) * s, (HOUSE.y1 - HOUSE.y0) * s);
  ctx.save();
  ctx.beginPath(); ctx.rect(px(pen, 0), py(pen, LOT_L), LOT_W * s, LOT_L * s); ctx.clip();
  ctx.translate(px(pen, HILL.cx), py(pen, HILL.cy)); ctx.rotate(-HILL.ang);
  ctx.strokeStyle = col.edge; ctx.lineWidth = 1; ctx.setLineDash([3, 4]); ctx.globalAlpha = 0.85;
  for (let q = 1; q <= 3; q++) {
    ctx.beginPath(); ctx.ellipse(0, 0, HILL.a * s * q / 3, HILL.b * s * q / 3, 0, 0, TAU); ctx.stroke();
  }
  ctx.restore();
  drawKeepOuts(pen, thumb);
  if (thumb) { return; }
  ctx.fillStyle = col.edge; ctx.font = '600 12px "Barlow Condensed", "Arial Narrow", sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('HILLY', px(pen, HILL.cx + 10), py(pen, HILL.cy));
  ctx.fillStyle = col.muted; ctx.font = '600 13px "Barlow Condensed", "Arial Narrow", sans-serif';
  ctx.fillText('HOUSE', px(pen, (HOUSE.x0 + HOUSE.x1) / 2), py(pen, (HOUSE.y0 + HOUSE.y1) / 2));
}

/** @param {Pen} pen @param {boolean} thumb */
function drawKeepOuts(pen, thumb) {
  const { ctx, col, s } = pen;
  for (const o of OBSTACLES) {
    if (o.kind !== 'circle') { continue; }
    ctx.strokeStyle = col.fg; ctx.globalAlpha = 0.65; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.arc(px(pen, o.x), py(pen, o.y), o.r * s, 0, TAU); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    ctx.fillStyle = col.edge;
    ctx.beginPath(); ctx.arc(px(pen, o.x), py(pen, o.y), Math.max(2, 2.5 * s), 0, TAU); ctx.fill();
    if (thumb) { continue; }
    const right = o.x > LOT_W / 2;
    ctx.fillStyle = col.fg; ctx.font = '600 10px "Barlow Condensed", "Arial Narrow", sans-serif';
    ctx.textAlign = right ? 'right' : 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(o.label, px(pen, o.x + (right ? -(o.r + 2) : o.r + 2)), py(pen, o.y));
  }
}

/** Dimensions and the neighbours around the edge. @param {Pen} pen @param {Overlay} ov */
function drawLabels(pen, ov) {
  const { ctx, col, s } = pen;
  ctx.fillStyle = col.house;
  for (const nb of ov.nbs) {
    if (nb.group === 'back') { ctx.fillRect(px(pen, nb.x - 18), 1, 36 * s, 11); }
  }
  ctx.fillStyle = col.muted; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '600 11px "Barlow Condensed", "Arial Narrow", sans-serif';
  ctx.fillText('BACK NEIGHBORS · ' + String(ov.gaps.back) + ' FT PAST THE FENCE', px(pen, LOT_W / 2), 20);
  const by = py(pen, 0) + 15;
  ctx.textAlign = 'left'; ctx.fillText('← NEIGHBOR ' + String(ov.gaps.south) + ' FT', px(pen, 0), by);
  ctx.textAlign = 'right'; ctx.fillText('NEIGHBOR ' + String(ov.gaps.north) + ' FT →', px(pen, LOT_W), by);
  ctx.textAlign = 'center'; ctx.font = '11px "JetBrains Mono", ui-monospace, monospace';
  ctx.fillText(String(LOT_W) + ' ft', px(pen, LOT_W / 2), py(pen, LOT_L) - 7);
  ctx.save(); ctx.translate(px(pen, 0) - 15, py(pen, LOT_L / 2)); ctx.rotate(-Math.PI / 2);
  ctx.fillText(String(LOT_L) + ' ft', 0, 0);
  ctx.restore();
}

/** Dirt, edges and berms. @param {Pen} pen @param {Track} tr @param {number} width */
function drawTrackBody(pen, tr, width) {
  const { ctx, col, s } = pen;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.strokeStyle = col.edge; ctx.lineWidth = (width + 2) * s; strokePath(pen, tr.samples, true);
  ctx.strokeStyle = col.dirt; ctx.lineWidth = width * s; strokePath(pen, tr.samples, true);
  ctx.strokeStyle = col.edge; ctx.lineWidth = Math.max(2, 3 * s);
  const off = width / 2 + 1.5;
  tr.cs.forEach((c, k) => {
    if (!c.hair) { return; }
    const pts = tr.samples.filter((p) => p.corner === k).map((p) => ({ x: p.x + p.nx * off, y: p.y + p.ny * off }));
    if (pts.length > 1) { strokePath(pen, pts, false); }
  });
}

/** Centre line coloured by throttle: red full, amber part, blue braking. @param {Pen} pen @param {Sample[]} samples @param {Int8Array} thr */
function drawThrottle(pen, samples, thr) {
  const colors = [pen.col.cool, pen.col.part, pen.col.loud], n = samples.length;
  pen.ctx.lineWidth = 3; pen.ctx.lineCap = 'butt';
  let i = 0;
  for (let guardN = 0; guardN < n && i < n; guardN++) {
    const st = at(thr, i);
    /** @type {Pt[]} */
    const run = [at(samples, i)];
    let j = i;
    for (; j < n && at(thr, j) === st; j++) { run.push(at(samples, (j + 1) % n)); }
    pen.ctx.strokeStyle = at(colors, st);
    strokePath(pen, run, false);
    i = j;
  }
  pen.ctx.lineCap = 'round';
}

/** Direction arrows about every 55 ft. @param {Pen} pen @param {Sample[]} samples */
function drawChevrons(pen, samples) {
  pen.ctx.strokeStyle = pen.col.fg; pen.ctx.globalAlpha = 0.6; pen.ctx.lineWidth = 1.5;
  let acc = 25;
  for (let i = 0; i < samples.length - 3; i++) {
    const a = at(samples, i);
    acc += a.ds;
    if (acc < 55) { continue; }
    acc = 0;
    const b = at(samples, i + 3), L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    chevron(pen, a, { x: (b.x - a.x) / L, y: (b.y - a.y) / L }, 2.2);
  }
  pen.ctx.globalAlpha = 1;
}

/** Jumps and the start gate. @param {Pen} pen @param {Feat} f @param {number} width @param {boolean} thumb */
function drawMarks(pen, f, width, thumb) {
  const { ctx, col, s } = pen;
  ctx.fillStyle = col.tape;
  for (const j of f.jumps) {
    ctx.save(); ctx.translate(px(pen, j.mid.x), py(pen, j.mid.y)); ctx.rotate(Math.atan2(-j.dir.y, j.dir.x));
    ctx.fillRect(-7 * s, -width * 0.65 * s, 14 * s, width * 1.3 * s);
    ctx.restore();
  }
  const st = f.start, d = Math.min(15, st.len / 3), g = { x: st.sx + st.dir.x * d, y: st.sy + st.dir.y * d };
  ctx.save(); ctx.translate(px(pen, g.x), py(pen, g.y)); ctx.rotate(Math.atan2(-st.dir.y, st.dir.x));
  const sq = (width * 1.2 * s) / 6;
  for (let q = 0; q < 12; q++) {
    ctx.fillStyle = (q + Math.floor(q / 6)) % 2 ? col.fg : col.panel;
    ctx.fillRect(Math.floor(q / 6) * sq - sq, -width * 0.6 * s + (q % 6) * sq, sq, sq);
  }
  ctx.restore();
  if (thumb) { return; }
  ctx.fillStyle = col.fg; ctx.font = '600 12px "Barlow Condensed", "Arial Narrow", sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const off = width / 2 + 8;
  ctx.fillText('START', px(pen, g.x - st.dir.y * off), py(pen, g.y + st.dir.x * off));
}

/** @param {Pen} pen @param {Track} tr @param {YardOpts} opts */
function drawTrack(pen, tr, opts) {
  drawTrackBody(pen, tr, opts.width);
  if (!opts.thumb && opts.sim) { drawThrottle(pen, tr.samples, opts.sim.thr); }
  if (!opts.thumb) { drawChevrons(pen, tr.samples); }
  drawMarks(pen, features(tr), opts.width, opts.thumb);
}

/** @param {Pen} pen @param {Placed} c @param {Rings} rings */
function ringColor(pen, c, rings) {
  if (rings.bad.has(c.id)) { return pen.col.bad; }
  return c.id === rings.hub ? pen.col.tape : pen.col.fg;
}

/** @param {Pen} pen @param {Rings} rings @param {boolean} thumb */
function drawRings(pen, rings, thumb) {
  const { ctx, s } = pen;
  for (const c of rings.list) {
    const sel = c.id === rings.sel, isHub = c.id === rings.hub;
    ctx.strokeStyle = ringColor(pen, c, rings); ctx.fillStyle = ctx.strokeStyle;
    ctx.globalAlpha = sel || isHub || rings.bad.has(c.id) ? 0.95 : 0.6;
    ctx.lineWidth = thumb ? 1 : (sel ? 2.5 : 1.5);
    ctx.setLineDash(sel && !thumb ? [] : [5, 4]);
    ctx.beginPath(); ctx.arc(px(pen, c.x), py(pen, c.y), c.r * s, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    if (!thumb) { drawRingLabel(pen, c, rings); }
    ctx.globalAlpha = 1;
  }
}

/** @param {Pen} pen @param {Placed} c @param {Rings} rings */
function drawRingLabel(pen, c, rings) {
  const ctx = pen.ctx;
  ctx.beginPath(); ctx.arc(px(pen, c.x), py(pen, c.y), 3, 0, TAU); ctx.fill();
  if (c.id === rings.hub && rings.dir !== 0) {
    ctx.lineWidth = 2;
    chevron(pen, { x: c.x, y: c.y + c.r }, { x: -rings.dir, y: 0 }, 4);
    chevron(pen, { x: c.x, y: c.y - c.r }, { x: rings.dir, y: 0 }, 4);
  }
  ctx.font = '600 13px "Barlow Condensed", "Arial Narrow", sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(c.label, px(pen, c.x), py(pen, c.y) - 11);
  ctx.font = '10px "JetBrains Mono", ui-monospace, monospace';
  ctx.fillText(String(Math.round(c.r)) + ' ft', px(pen, c.x), py(pen, c.y) + 12);
}

/** Draws the whole yard; returns where it landed, for turning taps into feet. @param {HTMLCanvasElement} canvas @param {YardOpts} opts @returns {Geo | null} */
function drawYard(canvas, opts) {
  const pen = makePen(canvas, opts.thumb), ov = opts.overlay;
  if (!pen) { return null; }
  drawGround(pen);
  if (ov && ov.noiseMap) { drawNoiseMap(pen, ov); }
  if (ov) { drawQuietLine(pen, ov.quietFrom); }
  drawFeatures(pen, opts.thumb);
  drawFence(pen);
  if (ov) { drawLabels(pen, ov); }
  if (opts.track) { drawTrack(pen, opts.track, opts); }
  if (opts.rings) { drawRings(pen, opts.rings, opts.thumb); }
  return { ox: pen.ox, oy: pen.oy, s: pen.s };
}

/* ---------- circles and solving ---------- */

function quietFrom() { return state.quietDepth > 0 ? LOT_L - state.quietDepth : Infinity; }
function nbList() { return neighbors(state.gaps); }

function relabel() {
  let n = 1;
  for (const c of state.circles) { c.label = c.id === state.hub ? 'R' : String(n++); }
}

/** @param {readonly CircleSpec[]} list */
function loadCircles(list) {
  check(list.length <= MAX_CIRCLES, 'too many circles');
  state.circles = list.map((c) => ({ id: state.nextId++, x: c.x, y: c.y, r: c.r, label: '' }));
  state.hub = state.circles.length ? at(state.circles, 0).id : 0;
  state.cpick = state.hub;
  relabel();
}

/** +1 counterclockwise, -1 clockwise, 0 when not decided yet. */
function hubDirShown() {
  const sol = state.csol[state.csel];
  if (sol) { return at(sol.order, 0).s; }
  if (state.hubDir === 'either') { return 0; }
  return state.hubDir === 'cw' ? -1 : 1;
}

/** @param {number} selId @param {number} dir @returns {Rings} */
function ringsOpts(selId, dir) {
  return { list: state.circles, hub: state.hub, bad: state.cbad, sel: selId, dir };
}

/** Solves the current circles into state.csol and returns the line describing the result. */
function solveLine() {
  if (state.circles.length < 2) { return 'Place at least two circles and the solver will link them.'; }
  const probs = circleProblems(state.circles, state.hub, state.width);
  state.cbad = probs.bad;
  if (probs.notes.length > 0) { return 'Fix the red circles first. ' + at(probs.notes, 0); }
  const res = solveCircles(state.circles, state.hub, state.width, { useAll: state.useAll, rank: state.rank,
    nbs: nbList(), quietFrom: quietFrom(), hubDir: state.hubDir, concerns: state.concerns });
  state.csol = res.layouts;
  if (!res.layouts.length) { return 'No loop links these circles without crossing itself. Try moving one or making it smaller.'; }
  return String(res.passed) + ' loops' + (state.useAll ? ' use every circle' : ' use the roundabout') +
    ' with no crossings. Showing the top ' + String(res.layouts.length) + ' by ' + RANK_NAMES[state.rank] +
    ', each with at least ' + String(MIN_GRASS) + ' ft of grass between sections.';
}

/** Solves without drawing. */
function resolve() {
  state.csol = [];
  state.csel = 0;
  state.cbad = new Set();
  el('solve-line').textContent = solveLine();
}

function solveNow() { resolve(); renderAll(); }

/** Random circles until a set has at least one loop (bounded tries). */
function randomize() {
  const rand = rng((Math.random() * 4294967296) >>> 0);
  for (let t = 0; t < RANDOM_TRIES; t++) {
    loadCircles(randomCircles(rand, state.width));
    resolve();
    if (state.csol.length > 0) { msg('', false); renderAll(); return; }
  }
  msg(String(RANDOM_TRIES) + ' random sets in a row had no loop. Press Randomize again.', true);
  renderAll();
}

function sizeMain() {
  const narrow = window.innerWidth <= 760, padX = MAIN_M.l + MAIN_M.r, padY = MAIN_M.t + MAIN_M.b;
  // On phones the yard section is display: contents (no box), so measure the panel's column instead.
  const avail = Math.max(240, (narrow ? el('msg').parentElement ?? el('yard') : el('yard')).clientWidth);
  let H = Math.max(360, Math.min(780, Math.round(window.innerHeight * (narrow ? 0.72 : 0.84))));
  let W = (H - padY) / ASPECT + padX;
  if (W > avail) { W = avail; H = (W - padX) * ASPECT + padY; }
  mainCanvas.style.width = String(Math.floor(W)) + 'px';
  mainCanvas.style.height = String(Math.floor(H)) + 'px';
}

/* ---------- rendering ---------- */

const STAT_IDS = Object.freeze(['s-len', 's-time', 's-top', 's-avg', 's-corners', 's-hair', 's-jumps', 's-long', 's-pass',
  's-full', 's-back', 's-north', 's-south']);

/** @param {Track | null} tr @param {Sim | null} sim */
function setStats(tr, sim) {
  if (!tr || !sim) { STAT_IDS.forEach((id) => { el(id).textContent = '—'; }); return; }
  const f = features(tr), pass = closestPass(tr.samples, tr.length), nz = noiseAt(tr.samples, sim, nbList());
  el('s-len').textContent = ft(tr.length);
  el('s-time').textContent = fmtTime(sim.time);
  el('s-top').textContent = mph(sim.top);
  el('s-avg').textContent = mph(sim.avg);
  el('s-corners').textContent = String(tr.cs.length) + ' (' + String(f.lefts) + ' L · ' + String(f.rights) + ' R)';
  el('s-hair').textContent = String(f.hairpins);
  el('s-jumps').textContent = String(f.jumps.length);
  el('s-long').textContent = ft(f.longest);
  el('s-pass').textContent = isFinite(pass) ? ft(pass) + ' · ' + ft(Math.max(0, pass - state.width)) + ' grass' : '—';
  el('s-full').textContent = String(Math.round(100 * fullThrottleShare(tr.samples, sim))) + '% of the lap';
  for (const g of GROUPS) { el('s-' + g).textContent = dB(nz[g].peak) + ' peak · ' + dB(nz[g].avg) + ' avg'; }
}

/** @returns {Overlay} */
function overlay() {
  return { nbs: nbList(), concerns: state.concerns, gaps: state.gaps, quietFrom: quietFrom(), noiseMap: state.noiseMap };
}

function renderSelBox() {
  const c = state.circles.find((x) => x.id === state.cpick);
  el('selbox').hidden = !c;
  if (!c) { return; }
  el('sel-name').textContent = c.id === state.hub ? 'Roundabout' : 'Circle ' + c.label;
  inputEl('radius').value = String(Math.round(c.r));
  el('radius-out').textContent = String(Math.round(c.r)) + ' ft';
  el('make-hub').hidden = c.id === state.hub;
}

function renderMain() {
  const sol = state.drag ? undefined : state.csol[state.csel];
  const tr = sol ? buildCircleTrack(sol.order) : null;
  const sim = tr ? lapSim(tr.samples, quietFrom()) : null;
  state.geo = drawYard(mainCanvas, { thumb: false, width: state.width, track: tr, sim,
    rings: ringsOpts(state.cpick, hubDirShown()), overlay: overlay() });
  setStats(tr, sim);
  renderSelBox();
}

/** @param {number} i @param {Layout} sol */
function makeThumb(i, sol) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'thumb'; b.id = 'thumb-' + String(i);
  b.setAttribute('aria-pressed', String(i === state.csel));
  const canvas = document.createElement('canvas'), name = document.createElement('b'), info = document.createElement('span');
  name.textContent = 'Layout ' + String.fromCharCode(65 + i);
  b.append(canvas, name, info);
  b.addEventListener('click', guard(() => { state.csel = i; renderAll(); }));
  el('thumbs').appendChild(b);
  const tr = buildCircleTrack(sol.order), sim = lapSim(tr.samples, quietFrom());
  drawYard(canvas, { thumb: true, width: state.width, track: tr, sim, rings: ringsOpts(-1, at(sol.order, 0).s),
    overlay: null });
  info.textContent = ft(tr.length) + ' · ' + fmtTime(sim.time) + ' · back ' + dB(noiseAt(tr.samples, sim, nbList()).back.peak);
}

function renderThumbs() {
  const box = el('thumbs');
  box.textContent = '';
  if (state.csol.length === 0) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'No layouts yet. Place circles in the yard, or press Randomize.';
    box.appendChild(p);
    return;
  }
  state.csol.slice(0, BATCH).forEach((sol, i) => { makeThumb(i, sol); });
}

function renderAll() { renderMain(); renderThumbs(); }

/* ---------- saved layouts (this browser only) ---------- */

/** @param {unknown} v @returns {v is Record<string, unknown>} */
function isObj(v) { return typeof v === 'object' && v !== null; }
/** @param {unknown} v @returns {v is number} */
function isNum(v) { return typeof v === 'number' && Number.isFinite(v); }

/** @param {unknown} v @returns {v is CircleSpec} */
function isCircle(v) { return isObj(v) && isNum(v.x) && isNum(v.y) && isNum(v.r) && v.r >= MIN_R && v.r <= MAX_R; }

/** @param {unknown} v @returns {v is Gaps} */
function isGaps(v) { return isObj(v) && isNum(v.back) && isNum(v.north) && isNum(v.south) && Math.min(v.back, v.north, v.south) > 0; }

/** @param {unknown} v @returns {v is Concerns} */
function isConcerns(v) { return isObj(v) && GROUPS.every((g) => LEVELS.some((l) => l === v[g])); }

/** @param {unknown} v @returns {v is Settings} */
function isSettings(v) {
  if (!isObj(v) || !isNum(v.width) || !isNum(v.quietDepth) || typeof v.useAll !== 'boolean') { return false; }
  const choices = RANKS.some((r) => r === v.rank) && HUB_DIRS.some((d) => d === v.hubDir);
  return choices && isGaps(v.gaps) && isConcerns(v.concerns);
}

/** @param {unknown} pick @param {number} n circles in the save */
function isPick(pick, n) {
  if (pick === null) { return true; }
  const okItem = (/** @type {unknown} */ p) => isObj(p) && isNum(p.i) && Number.isInteger(p.i) && p.i >= 0 && p.i < n && (p.s === 1 || p.s === -1);
  return Array.isArray(pick) && pick.length >= 2 && pick.every(okItem);
}

/** 2 to 7 valid circles, and a hub index inside them. @param {unknown} circles @param {unknown} hub */
function isCircleSet(circles, hub) {
  if (!Array.isArray(circles) || circles.length < 2 || circles.length > MAX_CIRCLES) { return false; }
  return circles.every(isCircle) && isNum(hub) && Number.isInteger(hub) && hub >= 0 && hub < circles.length;
}

/** @param {unknown} v @returns {v is Saved} */
function isSaved(v) {
  if (!isObj(v) || typeof v.name !== 'string' || !isNum(v.at) || !isNum(v.len) || !isNum(v.time)) { return false; }
  const n = Array.isArray(v.circles) ? v.circles.length : 0;
  return isCircleSet(v.circles, v.hub) && isPick(v.pick, n) && isSettings(v.settings);
}

/** The stored text, or null when there is none or storage is blocked (private windows). */
function storedText() {
  try {
    return localStorage.getItem(SAVE_KEY);
  } catch (_e) {
    return null;
  }
}

/** @param {string} text @returns {unknown} the parsed value, or null if the text isn't JSON */
function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch (_e) {
    msg('Your saved layouts could not be read, so they were skipped.', true);
    return null;
  }
}

/** Saved layouts, newest first; anything malformed is skipped. @returns {Saved[]} */
function readSaves() {
  const text = storedText();
  const data = text ? parseJson(text) : null;
  return Array.isArray(data) ? data.filter(isSaved).slice(0, MAX_SAVES) : [];
}

/** @param {Saved[]} list @returns {boolean} whether it was stored */
function writeSaves(list) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(list.slice(0, MAX_SAVES)));
    return true;
  } catch (_e) {
    msg("This browser won't store layouts (a private window, or storage is full).", true);
    return false;
  }
}

/** @returns {Settings} */
function currentSettings() {
  return { width: state.width, hubDir: state.hubDir, rank: state.rank, useAll: state.useAll,
    gaps: { ...state.gaps }, concerns: { ...state.concerns }, quietDepth: state.quietDepth };
}

function saveCurrent() {
  if (state.circles.length < 2) { msg('Place at least two circles before saving.', true); return; }
  const sol = state.csol[state.csel], index = new Map(state.circles.map((c, i) => [c.id, i]));
  const tr = sol ? buildCircleTrack(sol.order) : null;
  const saves = readSaves();
  const name = inputEl('save-name').value.trim().slice(0, 40) || 'Layout ' + String(saves.length + 1);
  /** @type {Saved} */
  const entry = { name, at: Date.now(), circles: state.circles.map((c) => ({ x: c.x, y: c.y, r: c.r })),
    hub: index.get(state.hub) ?? 0, pick: sol ? sol.order.map((o) => ({ i: index.get(o.id) ?? 0, s: o.s })) : null,
    settings: currentSettings(), len: tr ? tr.length : 0, time: tr ? lapSim(tr.samples, quietFrom()).time : 0 };
  if (!writeSaves([entry, ...saves])) { return; }
  inputEl('save-name').value = '';
  msg('Saved "' + name + '".' + (saves.length >= MAX_SAVES ? ' The oldest save was dropped to make room.' : ''), false);
  renderSaves();
}

/** @param {readonly Ring[]} order */
function signature(order) { return order.map((o) => String(o.id) + (o.s > 0 ? '+' : '-')).join(','); }

/** Selects the saved loop, adding it if it isn't in the top six. @param {{ i: number, s: number }[]} pick */
function selectPick(pick) {
  const order = pick.map((p) => { const c = at(state.circles, p.i); return { x: c.x, y: c.y, r: c.r, s: p.s, id: c.id }; });
  const found = state.csol.findIndex((l) => signature(l.order) === signature(order));
  if (found >= 0) { state.csel = found; return; }
  const len = quickLayout(order, state.width);
  if (len < 0) { msg('That saved loop no longer fits with the current settings, so the best ones are shown instead.', true); return; }
  state.csol = [{ order, len, score: Infinity }, ...state.csol].slice(0, BATCH);
  state.csel = 0;
}

/** @param {Settings} s */
function applySettings(s) {
  state.width = s.width; state.hubDir = s.hubDir; state.rank = s.rank; state.useAll = s.useAll;
  state.gaps = { ...s.gaps }; state.concerns = { ...s.concerns }; state.quietDepth = s.quietDepth;
  syncControls();
}

/** Puts the settings back into the form controls. */
function syncControls() {
  const sliders = [['width', state.width], ['back-gap', state.gaps.back], ['north-gap', state.gaps.north],
    ['south-gap', state.gaps.south], ['quiet-depth', state.quietDepth]];
  for (const [id, v] of sliders) {
    inputEl(String(id)).value = String(v);
    el(String(id) + '-out').textContent = id === 'quiet-depth' && v === 0 ? 'off' : String(v) + ' ft';
  }
  selectEl('rank').value = state.rank;
  selectEl('hub-dir').value = state.hubDir;
  for (const g of GROUPS) { selectEl('concern-' + g).value = state.concerns[g]; }
  inputEl('use-all').checked = state.useAll;
}

/** @param {Saved} entry */
function loadSaved(entry) {
  applySettings(entry.settings);
  loadCircles(entry.circles);
  state.hub = at(state.circles, entry.hub).id;
  state.cpick = state.hub;
  relabel();
  resolve();
  msg('Loaded "' + entry.name + '".', false);
  if (entry.pick) { selectPick(entry.pick); }
  renderAll();
}

/** @param {Saved} entry */
function deleteSaved(entry) {
  if (writeSaves(readSaves().filter((s) => s.at !== entry.at || s.name !== entry.name))) {
    msg('Deleted "' + entry.name + '".', false);
    renderSaves();
  }
}

/** @param {Saved} entry */
function saveRow(entry) {
  const li = document.createElement('li'), load = document.createElement('button'), del = document.createElement('button');
  const when = new Date(entry.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  load.type = 'button'; load.className = 'save-load';
  const title = document.createElement('b'), info = document.createElement('span');
  title.textContent = entry.name;
  info.textContent = (entry.len ? ft(entry.len) + ' · ' + fmtTime(entry.time) + ' · ' : '') + when;
  load.append(title, info);
  load.addEventListener('click', guard(() => { loadSaved(entry); }));
  del.type = 'button'; del.className = 'btn save-del'; del.textContent = 'Delete';
  del.setAttribute('aria-label', 'Delete ' + entry.name);
  del.addEventListener('click', guard(() => { deleteSaved(entry); }));
  li.append(load, del);
  return li;
}

function renderSaves() {
  const list = el('saves'), saves = readSaves();
  list.textContent = '';
  el('saves-empty').hidden = saves.length > 0;
  for (const s of saves) { list.appendChild(saveRow(s)); }
}

/* ---------- pointer input ---------- */

/** @param {MouseEvent} ev @returns {Pt | null} */
function toWorld(ev) {
  const g = state.geo;
  if (!g) { return null; }
  const rect = mainCanvas.getBoundingClientRect();
  return { x: (ev.clientX - rect.left - g.ox) / g.s, y: LOT_L - (ev.clientY - rect.top - g.oy) / g.s };
}

/** The circle under w, or null. @param {Pt} w @returns {Placed | null} */
function circleUnder(w) {
  let hit = null, bestD = Infinity;
  for (const c of state.circles) {
    const d = Math.hypot(c.x - w.x, c.y - w.y);
    if (d <= Math.max(c.r, 8) && d < bestD) { hit = c; bestD = d; }
  }
  return hit;
}

/** A new circle at w, unless that would pass the limit. @param {Pt} w */
function addCircle(w) {
  if (state.circles.length >= MAX_CIRCLES) {
    msg('That is the ' + String(MAX_CIRCLES) + '-circle limit. Remove one to add another.', true);
    return;
  }
  const made = { id: state.nextId++, x: w.x, y: w.y, r: state.circles.length ? 18 : 30, label: '' };
  state.circles.push(made);
  if (!state.hub) { state.hub = made.id; }
  state.cpick = made.id;
  relabel();
  msg('', false);
  solveNow();
}

/** Down on a circle starts a drag; down on grass waits to see if it's a tap. @param {Event} ev */
function onPointerDown(ev) {
  check(ev instanceof PointerEvent, 'expected a pointer event');
  const w = toWorld(ev);
  if (!w || w.x < 0 || w.x > LOT_W || w.y < 0 || w.y > LOT_L) { return; }
  const hit = circleUnder(w);
  if (!hit) { state.tap = { w, sx: ev.clientX, sy: ev.clientY }; return; }
  state.cpick = hit.id;
  state.drag = { id: hit.id, dx: hit.x - w.x, dy: hit.y - w.y };
  mainCanvas.setPointerCapture(ev.pointerId);
  ev.preventDefault();
  msg('', false);
  renderMain();
}

/** @param {Event} ev */
function onPointerMove(ev) {
  check(ev instanceof PointerEvent, 'expected a pointer event');
  const tap = state.tap;
  if (tap && Math.hypot(ev.clientX - tap.sx, ev.clientY - tap.sy) > 10) { state.tap = null; }
  const dr = state.drag, w = toWorld(ev);
  const c = dr ? state.circles.find((x) => x.id === dr.id) : undefined;
  if (!dr || !w || !c) { return; }
  c.x = Math.max(0, Math.min(LOT_W, w.x + dr.dx));
  c.y = Math.max(0, Math.min(LOT_L, w.y + dr.dy));
  state.cbad = circleProblems(state.circles, state.hub, state.width).bad;
  renderMain();
}

/** A tap on grass adds a circle; the end of a drag re-solves. */
function onPointerUp() {
  const tap = state.tap;
  state.tap = null;
  if (tap) { addCircle(tap.w); return; }
  if (!state.drag) { return; }
  state.drag = null;
  solveNow();
}

function onPointerCancel() {
  state.tap = null;
  onPointerUp();
}

/* ---------- wiring ---------- */

/** @param {string} id @param {(v: number) => void} set @param {(v: number) => string} label */
function wireSlider(id, set, label) {
  const input = inputEl(id), out = el(id + '-out');
  input.addEventListener('input', guard(() => { const v = Number(input.value); set(v); out.textContent = label(v); renderMain(); }));
  input.addEventListener('change', guard(() => { state.drag = null; solveNow(); }));
}

/**
 * A select whose value must be one of the allowed options.
 * @template {string} T
 * @param {string} id
 * @param {readonly T[]} allowed
 * @param {(v: T) => void} set
 */
function wireSelect(id, allowed, set) {
  const sel = selectEl(id);
  sel.addEventListener('change', guard(() => {
    const v = allowed.find((a) => a === sel.value);
    check(v !== undefined, 'unexpected choice for #' + id + ': ' + sel.value);
    set(v);
    solveNow();
  }));
}

function wireCircles() {
  wireSlider('radius', (v) => {
    const c = state.circles.find((x) => x.id === state.cpick);
    if (!c) { return; }
    c.r = Math.max(MIN_R, Math.min(MAX_R, v));
    state.cbad = circleProblems(state.circles, state.hub, state.width).bad;
    state.drag = { id: c.id, dx: 0, dy: 0 };
  }, (v) => String(v) + ' ft');
  el('make-hub').addEventListener('click', guard(() => { state.hub = state.cpick; relabel(); solveNow(); }));
  el('del-circle').addEventListener('click', guard(() => {
    state.circles = state.circles.filter((c) => c.id !== state.cpick);
    if (state.hub === state.cpick) { state.hub = state.circles.length ? at(state.circles, 0).id : 0; }
    state.cpick = state.hub; relabel(); solveNow();
  }));
  el('randomize').addEventListener('click', guard(randomize));
  el('example').addEventListener('click', guard(() => { loadCircles(EXAMPLE); msg('', false); solveNow(); }));
  el('clear-circles').addEventListener('click', guard(() => { state.circles = []; state.hub = 0; state.cpick = -1; solveNow(); }));
  inputEl('use-all').addEventListener('change', guard(() => { state.useAll = inputEl('use-all').checked; solveNow(); }));
  wireSelect('rank', RANKS, (v) => { state.rank = v; });
  wireSelect('hub-dir', HUB_DIRS, (v) => { state.hubDir = v; });
  el('save').addEventListener('click', guard(saveCurrent));
}

function wireNoise() {
  /** @param {number} v */
  const feet = (v) => String(v) + ' ft';
  wireSlider('width', (v) => { state.width = v; }, feet);
  wireSlider('back-gap', (v) => { state.gaps.back = v; }, feet);
  wireSlider('north-gap', (v) => { state.gaps.north = v; }, feet);
  wireSlider('south-gap', (v) => { state.gaps.south = v; }, feet);
  wireSlider('quiet-depth', (v) => { state.quietDepth = v; }, (v) => (v ? feet(v) : 'off'));
  wireSelect('concern-back', LEVELS, (v) => { state.concerns.back = v; });
  wireSelect('concern-north', LEVELS, (v) => { state.concerns.north = v; });
  wireSelect('concern-south', LEVELS, (v) => { state.concerns.south = v; });
  inputEl('noise-map').addEventListener('change', guard(() => { state.noiseMap = inputEl('noise-map').checked; renderMain(); }));
}

function wirePage() {
  mainCanvas.addEventListener('pointerdown', guard(onPointerDown));
  mainCanvas.addEventListener('pointermove', guard(onPointerMove));
  mainCanvas.addEventListener('pointerup', guard(onPointerUp));
  mainCanvas.addEventListener('pointercancel', guard(onPointerCancel));
  window.addEventListener('resize', () => {
    clearTimeout(state.resizeTimer);
    state.resizeTimer = setTimeout(() => { safely(() => { sizeMain(); renderAll(); }); }, 120);
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', guard(renderAll));
  new MutationObserver(() => { safely(renderAll); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  // fonts.ready doesn't reject; if fonts never load, labels keep their fallback faces, which is fine.
  void document.fonts.ready.then(() => { safely(renderAll); });
}

safely(() => {
  wireCircles(); wireNoise(); wirePage();
  sizeMain();
  loadCircles(EXAMPLE);
  solveNow();
  renderSaves();
});
