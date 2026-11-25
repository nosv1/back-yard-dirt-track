// Backyard Track Lab page: drawing, page state and the controls. All the yard math lives in core.js.
// Rule 5 here: a failed check throws, and guard() catches it at the event handler and shows it in the panel.
import {
  ASPECT, BATCH, CANDIDATES, CONCERN_DB, GROUPS, HILL, HOUSE, INSET, LOT_L, LOT_W, MAX_CIRCLES, MAX_R, MIN_GRASS,
  MIN_R, NI, NJ, NODES, NOISE, OBSTACLES, RANK_NAMES, SX, SY, TAU, at, blockedNodes, buildCircleTrack, buildTrack,
  check, circleProblems, closestPass, cornersFromLoop, distTo, features, finishScenic, finishShortest,
  fullThrottleShare, lapSim, lineNodes, makeBatch, neighbors, nodeXY, noiseAt, rng, solveCircles,
} from './core.js';

/** @typedef {import('./core.js').Track} Track */
/** @typedef {import('./core.js').Feat} Feat */
/** @typedef {import('./core.js').Sim} Sim */
/** @typedef {import('./core.js').Sample} Sample */
/** @typedef {import('./core.js').Straight} Straight */
/** @typedef {import('./core.js').Pt} Pt */
/** @typedef {import('./core.js').Placed} Placed */
/** @typedef {import('./core.js').Layout} Layout */
/** @typedef {import('./core.js').GridLayout} GridLayout */
/** @typedef {import('./core.js').Neighbor} Neighbor */
/** @typedef {import('./core.js').Concerns} Concerns */
/** @typedef {import('./core.js').Concern} Concern */
/** @typedef {import('./core.js').Rank} Rank */
/** @typedef {import('./core.js').HubDir} HubDir */
/** @typedef {import('./core.js').Group} Group */
/**
 * @typedef {{ bg: string, fg: string, muted: string, grass: string, grass2: string, dirt: string, edge: string,
 *   tape: string, bad: string, house: string, chalk: string, panel: string, loud: string, part: string,
 *   cool: string }} Palette
 */
/** @typedef {{ ctx: CanvasRenderingContext2D, s: number, ox: number, oy: number, col: Palette }} Pen */
/** @typedef {{ list: Placed[], hub: number, bad: Set<number>, sel: number, dir: number }} Rings */
/** @typedef {{ nbs: Neighbor[], concerns: Concerns, gaps: { back: number, north: number, south: number }, quietFrom: number, noiseMap: boolean }} Overlay */
/**
 * @typedef {{ thumb: boolean, width: number, track: Track | null, sim: Sim | null, draft: number[] | null,
 *   rings: Rings | null, nodes: boolean, overlay: Overlay | null }} YardOpts
 */
/** @typedef {{ ox: number, oy: number, s: number }} Geo */
/** @typedef {'circles' | 'gen' | 'draw'} Mode */

const MAIN_M = Object.freeze({ l: 34, r: 10, t: 40, b: 30 });
const THUMB_M = Object.freeze({ l: 3, r: 3, t: 3, b: 3 });
const EXAMPLE = Object.freeze([
  { x: 72, y: 160, r: 30 }, { x: 118, y: 62, r: 20 }, { x: 35, y: 90, r: 20 },
  { x: 138, y: 140, r: 16 }, { x: 40, y: 235, r: 22 }, { x: 125, y: 240, r: 20 },
]);

/**
 * @typedef {{ mode: Mode, seed: number, flow: number, fill: number, width: number, rmax: number,
 *   reversed: boolean, batch: GridLayout[], sel: number, draft: number[], groups: number[], drawn: Pt[] | null,
 *   geo: Geo | null, circles: Placed[], nextId: number, hub: number, csel: number, cpick: number,
 *   csol: Layout[], cbad: Set<number>, drag: { id: number, dx: number, dy: number } | null, useAll: boolean,
 *   rank: Rank, hubDir: HubDir, gaps: { back: number, north: number, south: number }, noiseMap: boolean,
 *   quietDepth: number, concerns: Concerns, resizeTimer: number }} UiState
 */

/**
 * Everything the controls change, shared by the render and event functions (module state, rule 6).
 * Circles mode: circles, hub, cpick (selected), csol (solutions). Grid modes: batch and the drawn loop.
 * @type {UiState}
 */
const state = {
  mode: 'circles', seed: 2611, flow: 0.55, fill: 0.30, width: 10, rmax: 20, reversed: false,
  batch: [], sel: 0, draft: [], groups: [], drawn: null, geo: null,
  circles: [], nextId: 1, hub: 0, csel: 0, cpick: -1, csol: [], cbad: new Set(), drag: null,
  useAll: false, rank: 'both', hubDir: 'either',
  gaps: { back: 45, north: 30, south: 75 }, noiseMap: true, quietDepth: 100,
  concerns: { back: 'high', north: 'some', south: 'none' },
  resizeTimer: 0,
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

/** Grass, mow stripes and the fence. @param {Pen} pen */
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

/** @param {Pen} pen */
function drawNodes(pen) {
  const { ctx, col } = pen;
  ctx.fillStyle = col.fg; ctx.globalAlpha = 0.4;
  for (let k = 0; k < NODES; k++) {
    const p = nodeXY(k);
    ctx.beginPath(); ctx.arc(px(pen, p.x), py(pen, p.y), 2, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
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

/** @param {Pen} pen @param {Feat} f @param {number} width @param {boolean} thumb */
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

/** @param {Pen} pen @param {number[]} draft */
function drawDraft(pen, draft) {
  const { ctx, col } = pen;
  ctx.strokeStyle = col.tape; ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  strokePath(pen, draft.map(nodeXY), false);
  const a = nodeXY(at(draft, 0)), b = nodeXY(at(draft, draft.length - 1));
  ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(px(pen, a.x), py(pen, a.y), 8, 0, TAU); ctx.stroke();
  ctx.fillStyle = col.tape;
  ctx.beginPath(); ctx.arc(px(pen, b.x), py(pen, b.y), 5, 0, TAU); ctx.fill();
}

/** Draws the whole yard; returns where it landed for turning clicks into feet. @param {HTMLCanvasElement} canvas @param {YardOpts} opts @returns {Geo | null} */
function drawYard(canvas, opts) {
  const pen = makePen(canvas, opts.thumb), ov = opts.overlay;
  if (!pen) { return null; }
  drawGround(pen);
  if (ov && ov.noiseMap) { drawNoiseMap(pen, ov); }
  if (ov) { drawQuietLine(pen, ov.quietFrom); }
  drawFeatures(pen, opts.thumb);
  drawFence(pen);
  if (ov) { drawLabels(pen, ov); }
  drawContent(pen, opts);
  return { ox: pen.ox, oy: pen.oy, s: pen.s };
}

/** Grid points, track, draft and circles over the yard. @param {Pen} pen @param {YardOpts} opts */
function drawContent(pen, opts) {
  if (opts.nodes) { drawNodes(pen); }
  if (opts.track) { drawTrack(pen, opts.track, opts); }
  if (opts.draft && opts.draft.length > 0) { drawDraft(pen, opts.draft); }
  if (opts.rings) { drawRings(pen, opts.rings, opts.thumb); }
}

/* ---------- page state helpers ---------- */

function quietFrom() { return state.quietDepth > 0 ? LOT_L - state.quietDepth : Infinity; }
function nbList() { return neighbors(state.gaps); }

/** @param {Pt[]} corners */
function orient(corners) { return state.reversed ? corners.slice().reverse() : corners; }

function relabel() {
  let n = 1;
  for (const c of state.circles) { c.label = c.id === state.hub ? 'R' : String(n++); }
}

/** @param {readonly { x: number, y: number, r: number }[]} list */
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

function solveNow() {
  state.csol = [];
  state.csel = 0;
  state.cbad = new Set();
  el('solve-line').textContent = solveLine();
  renderAll();
}

/** @returns {Track | null} */
function currentTrack() {
  if (state.mode === 'circles') {
    const it = state.csol[state.csel];
    return it ? buildCircleTrack(it.order) : null;
  }
  const item = state.batch[state.sel];
  const corners = state.mode === 'gen' ? (item ? orient(item.corners) : null) : (state.drawn ? orient(state.drawn) : null);
  return corners ? buildTrack(corners, state.rmax) : null;
}

function sizeMain() {
  const H = Math.max(440, Math.min(780, Math.round(window.innerHeight * 0.84)));
  mainCanvas.style.height = String(H) + 'px';
  mainCanvas.style.width = String(Math.round((H - MAIN_M.t - MAIN_M.b) / ASPECT + MAIN_M.l + MAIN_M.r)) + 'px';
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
  const drawing = state.mode === 'draw', circ = state.mode === 'circles';
  const tr = circ && state.drag ? null : currentTrack();
  const sim = tr ? lapSim(tr.samples, quietFrom()) : null;
  state.geo = drawYard(mainCanvas, { thumb: false, width: state.width, track: tr, sim,
    draft: drawing && !state.drawn ? state.draft : null, rings: circ ? ringsOpts(state.cpick, hubDirShown()) : null,
    nodes: drawing && !state.drawn, overlay: overlay() });
  setStats(tr, sim);
  renderSelBox();
}

/** @param {number} i @param {Track} tr @param {number} hubDir */
function makeThumb(i, tr, hubDir) {
  const circ = state.mode === 'circles';
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'thumb'; b.id = 'thumb-' + String(i);
  b.setAttribute('aria-pressed', String(circ ? i === state.csel : (state.mode === 'gen' && i === state.sel)));
  const canvas = document.createElement('canvas'), name = document.createElement('b'), info = document.createElement('span');
  name.textContent = 'Layout ' + String.fromCharCode(65 + i);
  b.append(canvas, name, info);
  b.addEventListener('click', guard(() => {
    if (circ) { state.csel = i; renderAll(); } else { state.sel = i; setMode('gen'); }
  }));
  el('thumbs').appendChild(b);
  const sim = lapSim(tr.samples, quietFrom());
  drawYard(canvas, { thumb: true, width: state.width, track: tr, sim, draft: null,
    rings: circ ? ringsOpts(-1, hubDir) : null, nodes: false, overlay: null });
  info.textContent = ft(tr.length) + ' · ' + fmtTime(sim.time) + ' · back ' + dB(noiseAt(tr.samples, sim, nbList()).back.peak);
}

function renderThumbs() {
  const circ = state.mode === 'circles', box = el('thumbs');
  el('batch-title').textContent = circ ? 'Ways to connect these circles' : 'Six layouts from this grid batch';
  box.textContent = '';
  const count = circ ? state.csol.length : state.batch.length;
  if (count === 0) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = circ ? 'No layouts yet. Place circles in the yard and the solver fills this in.' : 'No layouts in this batch.';
    box.appendChild(p);
    return;
  }
  for (let i = 0; i < count && i < BATCH; i++) { thumbFor(i, circ); }
}

/** @param {number} i @param {boolean} circ */
function thumbFor(i, circ) {
  const sol = state.csol[i], item = state.batch[i];
  if (circ && sol) { makeThumb(i, buildCircleTrack(sol.order), at(sol.order, 0).s); }
  if (!circ && item) { makeThumb(i, buildTrack(orient(item.corners), state.rmax), 0); }
}

function renderAll() { renderMain(); renderThumbs(); }

function regenerate() {
  state.batch = makeBatch({ seed: state.seed, fill: state.fill, flow: state.flow, rmax: state.rmax, width: state.width });
  state.sel = 0;
  el('seed-line').textContent = 'Batch #' + String(state.seed) + ' · best ' + String(state.batch.length) + ' of ' +
    String(CANDIDATES) + ' candidates';
}

/** @param {Mode} mode */
function setMode(mode) {
  state.mode = mode;
  el('tab-circles').setAttribute('aria-pressed', String(mode === 'circles'));
  el('tab-gen').setAttribute('aria-pressed', String(mode === 'gen'));
  el('tab-draw').setAttribute('aria-pressed', String(mode === 'draw'));
  el('circle-controls').hidden = mode !== 'circles';
  el('gen-controls').hidden = mode !== 'gen';
  el('draw-controls').hidden = mode !== 'draw';
  el('rmax-label').hidden = mode === 'circles';
  mainCanvas.classList.toggle('drawing', mode === 'draw');
  mainCanvas.classList.toggle('circles', mode === 'circles');
  msg(mode === 'draw' && state.draft.length === 0 ? 'Click any grid point to start the track.' : '', false);
  if (mode === 'gen' && state.batch.length === 0) { regenerate(); }
  renderAll();
}

/* ---------- pointer input ---------- */

/** @param {MouseEvent} ev @returns {Pt | null} */
function toWorld(ev) {
  const g = state.geo;
  if (!g) { return null; }
  const rect = mainCanvas.getBoundingClientRect();
  return { x: (ev.clientX - rect.left - g.ox) / g.s, y: LOT_L - (ev.clientY - rect.top - g.oy) / g.s };
}

/** @param {MouseEvent} ev */
function pickNode(ev) {
  const w = toWorld(ev);
  if (!w) { return -1; }
  const i = Math.round((w.x - INSET) / SX), j = Math.round((w.y - INSET) / SY);
  if (i < 0 || i >= NI || j < 0 || j >= NJ) { return -1; }
  const p = nodeXY(j * NI + i);
  return Math.hypot(p.x - w.x, p.y - w.y) <= 0.45 * SX ? j * NI + i : -1;
}

/** @param {number[] | null} loop @param {string} how */
function closeWith(loop, how) {
  if (!loop) { msg("The track boxed itself in, so there's no way back to the start. Undo a piece and try again.", true); return; }
  state.groups.push(state.draft.length);
  state.draft = loop;
  state.drawn = cornersFromLoop(loop);
  msg('Loop closed' + how + '. Undo to reopen it.', false);
  renderMain();
}

/** Why a straight from the end of the draft to node can't be laid, or '' if it can. @param {number[]} seg @param {Uint8Array} blocked */
function segmentProblem(seg, blocked) {
  const d = state.draft, used = new Set(d);
  for (let q = 0; q < seg.length; q++) {
    const k = at(seg, q), closing = k === at(d, 0) && q === seg.length - 1;
    if (used.has(k) && !closing) { return "That would run over track you've already laid."; }
    if (at(blocked, k) === 1) { return 'That would run through the house, fire pit, or electrical box.'; }
  }
  return '';
}

/** @param {number} node */
function extendDraft(node) {
  const d = state.draft, end = at(d, d.length - 1);
  if (node === end) { return; }
  const seg = lineNodes(end, node);
  if (!seg) { msg('Track runs along the grid. Click a point in the same row or column as the end of the track.', true); return; }
  const problem = segmentProblem(seg, blockedNodes(state.width));
  if (problem) { msg(problem, true); return; }
  if (at(seg, seg.length - 1) === at(d, 0)) {
    const loop = d.concat(seg.slice(0, -1));
    if (loop.length < 4) { msg('That loop is too small to ride.', true); return; }
    closeWith(loop, '');
    return;
  }
  state.groups.push(d.length);
  state.draft = d.concat(seg);
  msg('', false);
  renderMain();
}

/** @param {Event} ev */
function onYardClick(ev) {
  if (state.mode !== 'draw') { return; }
  check(ev instanceof MouseEvent, 'expected a mouse event');
  if (state.drawn) { msg('This loop is closed. Undo or Clear to change it.', false); return; }
  const node = pickNode(ev);
  if (node < 0) { return; }
  if (at(blockedNodes(state.width), node) === 1) { msg('That point is too close to the house, fire pit, or electrical box.', true); return; }
  if (state.draft.length === 0) {
    state.groups.push(0);
    state.draft = [node];
    msg('Now click a point in the same row or column.', false);
    renderMain();
    return;
  }
  extendDraft(node);
}

/** The circle under w, or a new one there. @param {Pt} w @returns {Placed | null} */
function circleAt(w) {
  let hit = null, bestD = Infinity;
  for (const c of state.circles) {
    const d = Math.hypot(c.x - w.x, c.y - w.y);
    if (d <= Math.max(c.r, 8) && d < bestD) { hit = c; bestD = d; }
  }
  if (hit) { return hit; }
  if (state.circles.length >= MAX_CIRCLES) {
    msg('That is the ' + String(MAX_CIRCLES) + '-circle limit. Remove one to add another.', true);
    return null;
  }
  const made = { id: state.nextId++, x: w.x, y: w.y, r: state.circles.length ? 18 : 30, label: '' };
  state.circles.push(made);
  if (!state.hub) { state.hub = made.id; }
  relabel();
  return made;
}

/** @param {Event} ev */
function onPointerDown(ev) {
  if (state.mode !== 'circles') { return; }
  check(ev instanceof PointerEvent, 'expected a pointer event');
  const w = toWorld(ev);
  if (!w || w.x < 0 || w.x > LOT_W || w.y < 0 || w.y > LOT_L) { return; }
  const hit = circleAt(w);
  if (!hit) { return; }
  state.cpick = hit.id;
  state.drag = { id: hit.id, dx: hit.x - w.x, dy: hit.y - w.y };
  mainCanvas.setPointerCapture(ev.pointerId);
  ev.preventDefault();
  msg('', false);
  renderMain();
}

/** @param {Event} ev */
function onPointerMove(ev) {
  const dr = state.drag;
  if (!dr || state.mode !== 'circles') { return; }
  check(ev instanceof PointerEvent, 'expected a pointer event');
  const w = toWorld(ev), c = state.circles.find((x) => x.id === dr.id);
  if (!w || !c) { return; }
  c.x = Math.max(0, Math.min(LOT_W, w.x + dr.dx));
  c.y = Math.max(0, Math.min(LOT_L, w.y + dr.dy));
  state.cbad = circleProblems(state.circles, state.hub, state.width).bad;
  renderMain();
}

function onPointerUp() {
  if (!state.drag) { return; }
  state.drag = null;
  solveNow();
}

/* ---------- wiring ---------- */

/** @param {string} id @param {(v: number) => void} set @param {(v: number) => string} label @param {() => void} done */
function wireSlider(id, set, label, done) {
  const input = inputEl(id), out = el(id + '-out');
  input.addEventListener('input', guard(() => { const v = Number(input.value); set(v); out.textContent = label(v); renderMain(); }));
  input.addEventListener('change', guard(done));
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
    resolveAll();
  }));
}

function resolveAll() { if (state.mode === 'circles') { solveNow(); } else { renderAll(); } }

function wireCircles() {
  wireSlider('radius', (v) => {
    const c = state.circles.find((x) => x.id === state.cpick);
    if (!c) { return; }
    c.r = Math.max(MIN_R, Math.min(MAX_R, v));
    state.cbad = circleProblems(state.circles, state.hub, state.width).bad;
    state.drag = { id: c.id, dx: 0, dy: 0 };
  }, (v) => String(v) + ' ft', () => { state.drag = null; solveNow(); });
  el('make-hub').addEventListener('click', guard(() => { state.hub = state.cpick; relabel(); solveNow(); }));
  el('del-circle').addEventListener('click', guard(() => {
    state.circles = state.circles.filter((c) => c.id !== state.cpick);
    if (state.hub === state.cpick) { state.hub = state.circles.length ? at(state.circles, 0).id : 0; }
    state.cpick = state.hub; relabel(); solveNow();
  }));
  el('example').addEventListener('click', guard(() => { loadCircles(EXAMPLE); solveNow(); }));
  el('clear-circles').addEventListener('click', guard(() => { state.circles = []; state.hub = 0; state.cpick = -1; solveNow(); }));
  inputEl('use-all').addEventListener('change', guard(() => { state.useAll = inputEl('use-all').checked; solveNow(); }));
  wireSelect('rank', /** @type {Rank[]} */ (['both', 'quiet', 'longest']), (v) => { state.rank = v; });
  wireSelect('hub-dir', /** @type {HubDir[]} */ (['either', 'ccw', 'cw']), (v) => { state.hubDir = v; });
}

function wireGrid() {
  el('newbatch').addEventListener('click', guard(() => { state.seed++; regenerate(); renderAll(); }));
  el('reverse').addEventListener('click', guard(() => { state.reversed = !state.reversed; renderAll(); }));
  wireSlider('flow', (v) => { state.flow = v / 100; }, String, () => { regenerate(); renderAll(); });
  wireSlider('fill', (v) => { state.fill = v / 100; }, (v) => String(v) + '%', () => { regenerate(); renderAll(); });
  wireSlider('rmax', (v) => { state.rmax = v; }, (v) => String(v) + ' ft', renderAll);
}

/** @param {number[] | null} loop @param {string} how */
function finishWith(loop, how) {
  if (state.drawn) { msg('This loop is already closed.', false); return; }
  closeWith(loop, how);
}

function draftReady() {
  if (state.draft.length >= 2) { return true; }
  msg('Lay at least one piece of track first.', true);
  return false;
}

function wireDraw() {
  const seed = () => rng((Math.random() * 4294967296) >>> 0);
  el('finish-short').addEventListener('click', guard(() => {
    if (draftReady()) { finishWith(finishShortest(state.draft, seed(), blockedNodes(state.width)), ' the shortest way'); }
  }));
  el('finish-scenic').addEventListener('click', guard(() => {
    if (draftReady()) { finishWith(finishScenic(state.draft, seed(), blockedNodes(state.width)), ' the scenic way (press again for another)'); }
  }));
  el('undo').addEventListener('click', guard(() => {
    const back = state.groups.pop();
    if (back === undefined) { return; }
    state.draft = state.draft.slice(0, back); state.drawn = null; msg('', false); renderMain();
  }));
  el('clear').addEventListener('click', guard(() => {
    state.draft = []; state.groups = []; state.drawn = null;
    msg('Click any grid point to start the track.', false); renderMain();
  }));
}

function wireNoise() {
  wireSlider('width', (v) => { state.width = v; }, (v) => String(v) + ' ft', resolveAll);
  wireSlider('back-gap', (v) => { state.gaps.back = v; }, (v) => String(v) + ' ft', resolveAll);
  wireSlider('north-gap', (v) => { state.gaps.north = v; }, (v) => String(v) + ' ft', resolveAll);
  wireSlider('south-gap', (v) => { state.gaps.south = v; }, (v) => String(v) + ' ft', resolveAll);
  wireSlider('quiet-depth', (v) => { state.quietDepth = v; }, (v) => (v ? String(v) + ' ft' : 'off'), resolveAll);
  /** @type {Concern[]} */
  const levels = ['high', 'some', 'none'];
  wireSelect('concern-back', levels, (v) => { state.concerns.back = v; });
  wireSelect('concern-north', levels, (v) => { state.concerns.north = v; });
  wireSelect('concern-south', levels, (v) => { state.concerns.south = v; });
  inputEl('noise-map').addEventListener('change', guard(() => { state.noiseMap = inputEl('noise-map').checked; renderMain(); }));
}

function wirePage() {
  el('tab-circles').addEventListener('click', guard(() => { setMode('circles'); }));
  el('tab-gen').addEventListener('click', guard(() => { setMode('gen'); }));
  el('tab-draw').addEventListener('click', guard(() => { setMode('draw'); }));
  mainCanvas.addEventListener('click', guard(onYardClick));
  mainCanvas.addEventListener('pointerdown', guard(onPointerDown));
  mainCanvas.addEventListener('pointermove', guard(onPointerMove));
  mainCanvas.addEventListener('pointerup', guard(onPointerUp));
  mainCanvas.addEventListener('pointercancel', guard(onPointerUp));
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
  wireCircles(); wireGrid(); wireDraw(); wireNoise(); wirePage();
  sizeMain();
  loadCircles(EXAMPLE);
  setMode('circles');
  solveNow();
});
