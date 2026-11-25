// Backyard Track Lab core: yard data, track geometry, the solvers, the lap sim and the noise model.
// No DOM here, so tests can import it. Units are feet. x runs from the left (south) fence, y from the house
// end toward the back fence. Rule 5: a failed check throws, and the page's guard() shows the message.

/** @typedef {{ x: number, y: number }} Pt */
/**
 * @typedef {{ x: number, y: number, curv: number, berm: boolean, nx: number, ny: number, corner: number,
 *   ds: number }} Sample
 */
/** @typedef {{ len: number, first: number, dir: Pt, sx: number, sy: number, mid: Pt }} Straight */
/** @typedef {{ r: number, turn: 'L' | 'R', hair: boolean, lout: number }} Corner */
/**
 * @typedef {{ kind: 'grid' | 'circles', cs: Corner[], samples: Sample[], straights: Straight[],
 *   length: number }} Track
 */
/** @typedef {{ x: number, y: number, r: number, s: number, id: number }} Ring  s: +1 counterclockwise, -1 clockwise */
/** @typedef {{ id: number, x: number, y: number, r: number, label: string }} Placed */
/** @typedef {{ ax: number, ay: number, bx: number, by: number, ux: number, uy: number, len: number }} Tangent */
/** @typedef {{ time: number, top: number, avg: number, v: Float64Array, thr: Int8Array }} Sim */
/** @typedef {'back' | 'north' | 'south'} Group */
/** @typedef {{ group: Group, x: number, y: number }} Neighbor */
/** @typedef {{ peak: number, avg: number }} Level */
/** @typedef {{ back: Level, north: Level, south: Level }} Noise */
/** @typedef {'high' | 'some' | 'none'} Concern */
/** @typedef {{ back: Concern, north: Concern, south: Concern }} Concerns */
/** @typedef {{ back: number, north: number, south: number }} Gaps */
/** @typedef {'both' | 'quiet' | 'longest'} Rank */
/** @typedef {'either' | 'ccw' | 'cw'} HubDir */
/**
 * @typedef {{ name: string, label: string, kind: 'rect', x0: number, x1: number, y0: number, y1: number }
 *   | { name: string, label: string, kind: 'circle', x: number, y: number, r: number }} Obstacle
 */
/**
 * @typedef {{ jumps: Straight[], start: Straight, longest: number, lefts: number, rights: number,
 *   hairpins: number }} Feat
 */
/** @typedef {{ order: Ring[], len: number, score: number }} Layout */
/**
 * @typedef {{ useAll: boolean, rank: Rank, nbs: Neighbor[], quietFrom: number, hubDir: HubDir,
 *   concerns: Concerns }} SolveOpts
 */
/** @typedef {{ seed: number, fill: number, flow: number, rmax: number, width: number }} BatchOpts */
/** @typedef {{ set: Uint8Array, corners: Pt[], score: number }} GridLayout */

/* ---------- checks ---------- */

/**
 * @param {unknown} cond
 * @param {string} msg
 * @returns {asserts cond}
 */
export function check(cond, msg) {
  if (!cond) { throw new Error(msg); }
}

/**
 * Bounds-checked index: a miss is a bug, so it throws.
 * @template T
 * @param {ArrayLike<T>} arr
 * @param {number} i
 * @returns {T}
 */
export function at(arr, i) {
  const v = arr[i];
  if (v === undefined) { throw new Error('index ' + String(i) + ' is outside 0..' + String(arr.length - 1)); }
  return v;
}

/**
 * Cyclic index into a closed loop.
 * @template T
 * @param {ArrayLike<T>} arr
 * @param {number} i
 * @returns {T}
 */
export function wrap(arr, i) {
  check(arr.length > 0, 'wrap on an empty list');
  return at(arr, ((i % arr.length) + arr.length) % arr.length);
}

/* ---------- the yard, measured on the satellite map (2026-11-25) ---------- */

export const LOT_W = 164;
export const LOT_L = 282;
export const ASPECT = LOT_L / LOT_W;
/** House, deck and shed inside the fence. */
export const HOUSE = Object.freeze({ x0: 0, x1: 88, y0: 0, y1: 40 });
/** @type {readonly Obstacle[]} Keep-outs. A circle's r includes a margin. */
export const OBSTACLES = Object.freeze([
  { name: 'the house', label: 'HOUSE', kind: 'rect', x0: HOUSE.x0, x1: HOUSE.x1, y0: HOUSE.y0, y1: HOUSE.y1 },
  { name: 'the electrical box', label: 'ELECTRIC BOX', kind: 'circle', x: 154, y: 51, r: 4 },
  { name: 'the fire pit', label: 'FIRE PIT', kind: 'circle', x: 40, y: 47, r: 8 },
]);
/** Hilly area: an ellipse, drawn but not blocked. ang is the long axis, counterclockwise from +x. */
export const HILL = Object.freeze({ cx: 45, cy: 204, a: 89, b: 45, ang: 0.904 });
/** Back neighbours' doors, in ft along the back fence from its left corner. */
export const BACK_DOORS = Object.freeze([-49, 17, 91, 152, 220]);

export const INSET = 10;
export const C = Math.round((LOT_W - 2 * INSET) / 20);
export const R = Math.round((LOT_L - 2 * INSET) / 20);
export const SX = (LOT_W - 2 * INSET) / C;
export const SY = (LOT_L - 2 * INSET) / R;
export const NI = C + 1;
export const NJ = R + 1;
export const NODES = NI * NJ;
export const TAU = Math.PI * 2;
const STEP = Math.max(SX, SY);
const FT = 0.3048;
const G = 9.81;

/** Lap sim for a 125: 40 mph cap, 0.3 g drive (0.1 g past the ease-off line), 0.45 g brake. */
export const SIM = Object.freeze({ vcap: 40 * 0.44704, accel: 0.30 * G, quietAccel: 0.10 * G, brake: 0.45 * G,
  grip: 0.7, bermGrip: 1.0 });
/** dB at 50 ft for braking, part throttle, full throttle (index = throttle state 0..2). */
export const NOISE = Object.freeze({ ref: 50, levels: Object.freeze([-14, -7, 0]), minDist: 10 });
/** @type {readonly Group[]} */
export const GROUPS = Object.freeze(['back', 'north', 'south']);
/** How much each concern level counts: high as heard, some as if twice as far, none not at all. */
export const CONCERN_DB = Object.freeze({ high: 0, some: -6, none: null });
export const RANK_NAMES = Object.freeze({ both: 'length and quiet', quiet: 'quiet', longest: 'length' });
export const CANDIDATES = 220;
export const BATCH = 6;
export const MAX_CIRCLES = 7;
export const MIN_GRASS = 6;
export const FENCE = 5;
export const MIN_R = 10;
export const MAX_R = 50;
const DFS_BUDGET = 800;
const DFS_RESTARTS = 60;
const CHECK_BUDGET = 400;
const FOUND_CAP = 20000;
const EVAL_BUDGET = 2500;

/* ---------- random numbers ---------- */

/**
 * mulberry32: small, fast, seedable.
 * @param {number} seed
 * @returns {() => number}
 */
export function rng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @template T
 * @param {T[]} arr
 * @param {() => number} rand
 * @returns {T[]}
 */
export function shuffle(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = at(arr, i);
    arr[i] = at(arr, j);
    arr[j] = t;
  }
  return arr;
}

/* ---------- obstacles ---------- */

/**
 * Distance from a point to an obstacle's edge (negative inside a circle).
 * @param {Obstacle} o
 * @param {number} x
 * @param {number} y
 */
export function obstacleGap(o, x, y) {
  if (o.kind === 'circle') { return Math.hypot(x - o.x, y - o.y) - o.r; }
  const dx = Math.max(o.x0 - x, 0, x - o.x1), dy = Math.max(o.y0 - y, 0, y - o.y1);
  return Math.hypot(dx, dy);
}

/** @param {number} x @param {number} y */
export function obstacleDist(x, y) {
  let d = Infinity;
  for (const o of OBSTACLES) { d = Math.min(d, obstacleGap(o, x, y)); }
  return d;
}

/** @param {Sample[]} samples @param {number} width */
export function samplesHitObstacle(samples, width) {
  return samples.some((p) => obstacleDist(p.x, p.y) < width / 2 + 1);
}

/** @param {Tangent} t @param {number} width */
function segHitsObstacle(t, width) {
  const steps = Math.max(2, Math.ceil(t.len / 3));
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    if (obstacleDist(t.ax + (t.bx - t.ax) * f, t.ay + (t.by - t.ay) * f) < width / 2 + 2) { return true; }
  }
  return false;
}

/* ---------- grid mode: the track runs around a shape grown on 20 ft squares ---------- */

/** @param {Uint8Array} set @param {number} c @param {number} r */
function cellAt(set, c, r) {
  return (c >= 0 && c < C && r >= 0 && r < R) ? at(set, r * C + c) : 0;
}

/** True when two squares touch only at a corner, which would pinch the loop into a figure 8. @param {Uint8Array} set */
function hasPinch(set) {
  for (let r = 0; r < R - 1; r++) {
    for (let c = 0; c < C - 1; c++) {
      const diagA = cellAt(set, c, r) + cellAt(set, c + 1, r + 1);
      const diagB = cellAt(set, c + 1, r) + cellAt(set, c, r + 1);
      if ((diagA === 2 && diagB === 0) || (diagB === 2 && diagA === 0)) { return true; }
    }
  }
  return false;
}

/**
 * Empty squares around padded square k that the outside flood hasn't reached yet (padded grid: one ring of
 * empty squares around the yard, so the flood can get around the shape).
 * @param {Uint8Array} set
 * @param {Uint8Array} seen
 * @param {number} k
 */
function floodNext(set, seen, k) {
  const W = C + 2, H = R + 2, x = k % W, y = (k - x) / W;
  return [{ x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 }]
    .filter((p) => p.x >= 0 && p.y >= 0 && p.x < W && p.y < H)
    .map((p) => p.y * W + p.x)
    .filter((nk) => at(seen, nk) === 0 && cellAt(set, (nk % W) - 1, Math.floor(nk / W) - 1) === 0);
}

/** True when the shape encloses empty squares, so its edge would not be one loop. @param {Uint8Array} set */
function hasHole(set) {
  const W = C + 2, H = R + 2, seen = new Uint8Array(W * H), stack = [0];
  seen[0] = 1;
  let reached = 0;
  for (let guard = 0; guard < W * H && stack.length > 0; guard++) {
    const k = stack.pop();
    if (k === undefined) { break; }
    reached++;
    for (const nk of floodNext(set, seen, k)) { seen[nk] = 1; stack.push(nk); }
  }
  return reached + set.reduce((n, v) => n + v, 0) !== W * H;
}

/** @param {Uint8Array} set @param {number} i */
function tryAdd(set, i) {
  set[i] = 1;
  if (hasPinch(set) || hasHole(set)) { set[i] = 0; return false; }
  return true;
}

/**
 * Squares whose edges pass too close to an obstacle for a track of this width (5 points per edge).
 * @param {number} width
 */
export function blockedCells(width) {
  const out = new Uint8Array(C * R);
  for (let i = 0; i < C * R; i++) {
    const x0 = INSET + (i % C) * SX, y0 = INSET + Math.floor(i / C) * SY;
    let near = false;
    for (let t = 0; t <= 4 && !near; t++) {
      const f = t / 4;
      const pts = [{ x: x0 + f * SX, y: y0 }, { x: x0 + f * SX, y: y0 + SY }, { x: x0, y: y0 + f * SY }, { x: x0 + SX, y: y0 + f * SY }];
      near = pts.some((p) => obstacleDist(p.x, p.y) < width / 2 + 2);
    }
    out[i] = near ? 1 : 0;
  }
  return out;
}

/**
 * A one-square-wide strip from the back toward the house, with random jogs. It stops at the first blocked
 * square, so it never runs into an obstacle.
 * @param {() => number} rand
 * @param {number} flow
 * @param {Uint8Array} blocked
 */
function makeSpine(rand, flow, blocked) {
  const set = new Uint8Array(C * R);
  let c = Math.floor(rand() * C);
  const top = R - 1 - Math.floor(rand() * 2), bot = Math.floor(rand() * 2);
  for (let r = top; r >= bot && at(blocked, r * C + c) === 0; r--) {
    set[r * C + c] = 1;
    const nc = c + (rand() < 0.5 ? -1 : 1);
    const canJog = nc >= 0 && nc < C && at(blocked, r * C + nc) === 0;
    if (r > bot && canJog && rand() < 0.35 - 0.25 * flow) { c = nc; set[r * C + c] = 1; }
  }
  return set;
}

/**
 * A random free square next to the shape, weighted toward squares with more filled neighbours.
 * @param {Uint8Array} set
 * @param {Uint8Array} blocked
 * @param {() => number} rand
 * @param {number} p
 */
function pickFrontier(set, blocked, rand, p) {
  /** @type {number[]} */
  const cand = [];
  /** @type {number[]} */
  const weight = [];
  let total = 0;
  for (let i = 0; i < C * R; i++) {
    const cc = i % C, rr = (i - cc) / C;
    const nb = cellAt(set, cc + 1, rr) + cellAt(set, cc - 1, rr) + cellAt(set, cc, rr + 1) + cellAt(set, cc, rr - 1);
    if (at(set, i) === 1 || at(blocked, i) === 1 || nb === 0) { continue; }
    cand.push(i); weight.push(Math.pow(nb, p)); total += Math.pow(nb, p);
  }
  let x = rand() * total;
  for (let k = 0; k < cand.length; k++) {
    x -= at(weight, k);
    if (x <= 0) { return at(cand, k); }
  }
  return cand.length ? at(cand, cand.length - 1) : -1;
}

/**
 * @param {() => number} rand
 * @param {number} fill
 * @param {number} flow
 * @param {Uint8Array} blocked squares the shape may not use (blockedCells)
 */
export function growShape(rand, fill, flow, blocked) {
  check(fill >= 0 && fill <= 1 && flow >= 0 && flow <= 1, 'fill and flow must be 0..1');
  check(blocked.length === C * R, 'blocked must cover every square');
  const set = makeSpine(rand, flow, blocked);
  let count = set.reduce((n, v) => n + v, 0);
  const target = count + Math.round(fill * (C * R - count));
  const p = 0.5 + flow * 3;
  for (let step = 0; step < C * R * 4 && count < target; step++) {
    const pick = pickFrontier(set, blocked, rand, p);
    if (pick < 0) { break; }
    if (tryAdd(set, pick)) { count++; }
  }
  return set;
}

/** @param {number} i @param {number} j */
function nodeKey(i, j) { return j * NI + i; }

/** @param {number} k @returns {Pt} */
export function nodeXY(k) {
  check(k >= 0 && k < NODES, 'grid point out of range');
  const i = k % NI, j = (k - i) / NI;
  return { x: INSET + i * SX, y: INSET + j * SY };
}

/** Edges of one square that face empty squares, clockwise. @param {Uint8Array} set @param {number} c @param {number} r */
function cellEdges(set, c, r) {
  /** @type {{ a: number, b: number }[]} */
  const out = [];
  if (!cellAt(set, c, r - 1)) { out.push({ a: nodeKey(c, r), b: nodeKey(c + 1, r) }); }
  if (!cellAt(set, c + 1, r)) { out.push({ a: nodeKey(c + 1, r), b: nodeKey(c + 1, r + 1) }); }
  if (!cellAt(set, c, r + 1)) { out.push({ a: nodeKey(c + 1, r + 1), b: nodeKey(c, r + 1) }); }
  if (!cellAt(set, c - 1, r)) { out.push({ a: nodeKey(c, r + 1), b: nodeKey(c, r) }); }
  return out;
}

/** @param {Uint8Array} set @returns {Int32Array | null} each node's next node on the edge, or null at a fork */
function boundaryNext(set) {
  const next = new Int32Array(NODES).fill(-1);
  for (let i = 0; i < C * R; i++) {
    if (at(set, i) !== 1) { continue; }
    for (const e of cellEdges(set, i % C, Math.floor(i / C))) {
      if (at(next, e.a) !== -1) { return null; }
      next[e.a] = e.b;
    }
  }
  return next;
}

/** The shape's edge as a loop of grid points, or null if it isn't one loop. @param {Uint8Array} set */
export function traceBoundary(set) {
  const next = boundaryNext(set);
  if (!next) { return null; }
  const edges = next.reduce((n, v) => n + (v >= 0 ? 1 : 0), 0);
  if (edges < 4) { return null; }
  const start = next.findIndex((v) => v >= 0);
  const loop = [start];
  let cur = at(next, start);
  for (let g = 0; g < edges && cur !== start; g++) {
    if (cur < 0) { return null; }
    loop.push(cur);
    cur = at(next, cur);
  }
  return (cur === start && loop.length === edges) ? loop : null;
}

/** Grid points where the loop turns. @param {number[]} loop @returns {Pt[]} */
export function cornersFromLoop(loop) {
  check(loop.length >= 4, 'a loop needs at least 4 grid points');
  /** @type {Pt[]} */
  const out = [];
  for (let k = 0; k < loop.length; k++) {
    const d1 = at(loop, k) - wrap(loop, k - 1), d2 = wrap(loop, k + 1) - at(loop, k);
    check(Math.abs(d1) === 1 || Math.abs(d1) === NI, 'loop points must be grid neighbours');
    if (d1 !== d2) { out.push(nodeXY(at(loop, k))); }
  }
  return out;
}

/** @param {number} k */
export function gridNbs(k) {
  const i = k % NI, j = (k - i) / NI, out = [];
  if (i > 0) { out.push(k - 1); }
  if (i < NI - 1) { out.push(k + 1); }
  if (j > 0) { out.push(k - NI); }
  if (j < NJ - 1) { out.push(k + NI); }
  return out;
}

/* ---------- track samples, shared by both modes ---------- */

/** @param {number} x @param {number} y @returns {Sample} */
function straightSample(x, y) {
  return { x, y, curv: 0, berm: false, nx: 0, ny: 0, corner: -1, ds: 0 };
}

/**
 * Samples along a straight, 1 ft apart, not including its end.
 * @param {Sample[]} out
 * @param {Pt} from
 * @param {Pt} dir
 * @param {number} len
 * @returns {Straight}
 */
function appendStraight(out, from, dir, len) {
  check(len >= 0, 'a straight cannot be negative');
  const steps = Math.max(1, Math.ceil(len)), first = out.length;
  for (let t = 0; t < steps; t++) {
    const f = len * t / steps;
    out.push(straightSample(from.x + dir.x * f, from.y + dir.y * f));
  }
  const mid = { x: from.x + dir.x * len / 2, y: from.y + dir.y * len / 2 };
  return { len, first, dir, sx: from.x, sy: from.y, mid };
}

/** Fills each sample's ds (distance to the next) and returns the lap length. @param {Sample[]} samples */
function finishSamples(samples) {
  let total = 0;
  samples.forEach((a, i) => {
    const b = wrap(samples, i + 1);
    a.ds = Math.hypot(b.x - a.x, b.y - a.y);
    total += a.ds;
  });
  return total;
}

/** @typedef {{ P: Pt, d1: Pt, d2: Pt, r: number, lout: number, turn: 'L' | 'R', hair: boolean }} GridCorner */

/** @param {Pt[]} corners @param {number} rmax @returns {GridCorner[]} */
function gridCorners(corners, rmax) {
  return corners.map((P, k) => {
    const A = wrap(corners, k - 1), B = wrap(corners, k + 1);
    const lin = Math.hypot(P.x - A.x, P.y - A.y), lout = Math.hypot(B.x - P.x, B.y - P.y);
    const d1 = { x: (P.x - A.x) / lin, y: (P.y - A.y) / lin }, d2 = { x: (B.x - P.x) / lout, y: (B.y - P.y) / lout };
    const cross = d1.x * d2.y - d1.y * d2.x;
    check(Math.abs(cross) > 0.5, 'every grid corner must be a 90 degree turn');
    /** @type {'L' | 'R'} */
    const turn = cross > 0 ? 'L' : 'R';
    return { P, d1, d2, r: Math.min(rmax, lin / 2, lout / 2), lout, turn, hair: false };
  });
}

/** Two same-way corners one square apart make a hairpin. @param {GridCorner[]} cs */
function markHairpins(cs) {
  cs.forEach((c, k) => {
    const nx = wrap(cs, k + 1);
    if (c.lout <= 1.2 * STEP && c.turn === nx.turn) { c.hair = true; nx.hair = true; }
  });
}

/** A rounded 90 degree corner. @param {Sample[]} out @param {GridCorner} c @param {number} k */
function appendGridArc(out, c, k) {
  const cx = c.P.x - c.d1.x * c.r + c.d2.x * c.r, cy = c.P.y - c.d1.y * c.r + c.d2.y * c.r;
  const m = Math.max(3, Math.ceil(Math.PI * c.r / 2));
  for (let t = 0; t < m; t++) {
    const th = (t / m) * Math.PI / 2, co = Math.cos(th), si = Math.sin(th);
    const ox = -c.d2.x * c.r * co + c.d1.x * c.r * si, oy = -c.d2.y * c.r * co + c.d1.y * c.r * si;
    out.push({ x: cx + ox, y: cy + oy, curv: 1 / c.r, berm: c.hair, nx: ox / c.r, ny: oy / c.r, corner: k, ds: 0 });
  }
}

/** A grid loop's corners rounded into a rideable track. @param {Pt[]} corners @param {number} rmax @returns {Track} */
export function buildTrack(corners, rmax) {
  check(corners.length >= 4, 'a track needs at least 4 corners');
  check(rmax > 0, 'corner radius must be positive');
  const cs = gridCorners(corners, rmax);
  markHairpins(cs);
  /** @type {Sample[]} */
  const samples = [];
  /** @type {Straight[]} */
  const straights = [];
  cs.forEach((c, k) => {
    appendGridArc(samples, c, k);
    const len = Math.max(0, c.lout - c.r - wrap(cs, k + 1).r);
    straights.push(appendStraight(samples, { x: c.P.x + c.d2.x * c.r, y: c.P.y + c.d2.y * c.r }, c.d2, len));
  });
  return { kind: 'grid', cs, samples, straights, length: finishSamples(samples) };
}

/* ---------- circles mode: straights are tangent lines between rings ---------- */

/**
 * The line that leaves ring A and joins ring B, given the way each is ridden. Null when none exists
 * (one ring inside the other, or crossing lines for overlapping rings).
 * @param {Ring} A
 * @param {Ring} B
 * @returns {Tangent | null}
 */
export function tangent(A, B) {
  const dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy);
  const q = B.s * B.r - A.s * A.r;
  if (d < 1e-6 || Math.abs(q) >= d) { return null; }
  const off = Math.asin(q / d), al = Math.atan2(dy, dx) - off;
  const ux = Math.cos(al), uy = Math.sin(al), kx = -uy, ky = ux;
  return { ax: A.x - A.s * A.r * kx, ay: A.y - A.s * A.r * ky, bx: B.x - B.s * B.r * kx, by: B.y - B.s * B.r * ky,
    ux, uy, len: d * Math.cos(off) };
}

/** How far round a ring the track rides, 0..2π. @param {Ring} c @param {Tangent} tin @param {Tangent} tout */
export function sweep(c, tin, tout) {
  const a = Math.atan2(tin.by - c.y, tin.bx - c.x), b = Math.atan2(tout.ay - c.y, tout.ax - c.x);
  return (((c.s * (b - a)) % TAU) + TAU) % TAU;
}

/** @param {Pt} a @param {Pt} b @param {Pt} p */
function sideOf(a, b, p) { return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x); }

/** @param {Tangent} a @param {Tangent} b */
function segsCross(a, b) {
  const a0 = { x: a.ax, y: a.ay }, a1 = { x: a.bx, y: a.by }, b0 = { x: b.ax, y: b.ay }, b1 = { x: b.bx, y: b.by };
  const straddleA = (sideOf(a0, a1, b0) > 0) !== (sideOf(a0, a1, b1) > 0);
  const straddleB = (sideOf(b0, b1, a0) > 0) !== (sideOf(b0, b1, a1) > 0);
  return straddleA && straddleB;
}

/** @param {Pt} p @param {Tangent} t */
function segDist(p, t) {
  const vx = t.bx - t.ax, vy = t.by - t.ay, L2 = vx * vx + vy * vy;
  const u = L2 > 0 ? Math.max(0, Math.min(1, ((p.x - t.ax) * vx + (p.y - t.ay) * vy) / L2)) : 0;
  return Math.hypot(p.x - (t.ax + vx * u), p.y - (t.ay + vy * u));
}

/** @param {Ring[]} order @returns {Tangent[] | null} */
function tangentsFor(order) {
  /** @type {Tangent[]} */
  const tans = [];
  for (let k = 0; k < order.length; k++) {
    const t = tangent(at(order, k), wrap(order, k + 1));
    if (!t) { return null; }
    tans.push(t);
  }
  return tans;
}

/** @param {Tangent[]} tans */
function anyCross(tans) {
  for (let i = 0; i < tans.length; i++) {
    for (let j = i + 1; j < tans.length; j++) {
      if (segsCross(at(tans, i), at(tans, j))) { return true; }
    }
  }
  return false;
}

/** A straight that runs through a ring it doesn't belong to. @param {Ring[]} order @param {Tangent[]} tans @param {number} width */
function cutsRing(order, tans, width) {
  const n = order.length;
  for (let k = 0; k < n; k++) {
    for (let j = 0; j < n; j++) {
      const own = j === k || j === (k + 1) % n;
      if (!own && segDist(at(order, j), at(tans, k)) < at(order, j).r + width / 2) { return true; }
    }
  }
  return false;
}

/**
 * Cheap test of one ordering: the lap length, or -1 if a straight is missing, crosses another, cuts a
 * ring or hits an obstacle. Grass between sections is checked later, on the survivors only.
 * @param {Ring[]} order
 * @param {number} width
 */
export function quickLayout(order, width) {
  const tans = tangentsFor(order);
  if (!tans || anyCross(tans) || cutsRing(order, tans, width)) { return -1; }
  if (tans.some((t) => segHitsObstacle(t, width))) { return -1; }
  let len = 0;
  order.forEach((c, k) => { len += at(tans, k).len + c.r * sweep(c, wrap(tans, k - 1), at(tans, k)); });
  return len;
}

/**
 * @param {Sample[]} out
 * @param {Ring} c
 * @param {{ a0: number, sw: number, hair: boolean }} span
 * @param {number} k
 */
function appendRingArc(out, c, span, k) {
  const m = Math.max(2, Math.ceil(c.r * span.sw));
  for (let t = 0; t < m; t++) {
    const th = span.a0 + c.s * span.sw * (t / m), nx = Math.cos(th), ny = Math.sin(th);
    out.push({ x: c.x + c.r * nx, y: c.y + c.r * ny, curv: 1 / c.r, berm: span.hair, nx, ny, corner: k, ds: 0 });
  }
}

/** @param {Ring[]} order @returns {Track} */
export function buildCircleTrack(order) {
  check(order.length >= 2, 'a circle layout needs at least 2 circles');
  const tans = tangentsFor(order);
  check(tans !== null, 'these circles have no connecting lines');
  /** @type {Sample[]} */
  const samples = [];
  /** @type {Straight[]} */
  const straights = [];
  /** @type {Corner[]} */
  const cs = [];
  order.forEach((c, k) => {
    const tin = wrap(tans, k - 1), tout = at(tans, k);
    const sw = sweep(c, tin, tout), hair = sw >= 0.75 * Math.PI;
    cs.push({ r: c.r, turn: c.s > 0 ? 'L' : 'R', hair, lout: tout.len });
    appendRingArc(samples, c, { a0: Math.atan2(tin.by - c.y, tin.bx - c.x), sw, hair }, k);
    straights.push(appendStraight(samples, { x: tout.ax, y: tout.ay }, { x: tout.ux, y: tout.uy }, tout.len));
  });
  return { kind: 'circles', cs, samples, straights, length: finishSamples(samples) };
}

/** @param {Placed} c @param {number} width */
function nearFence(c, width) {
  const e = c.r + width / 2 + FENCE;
  return c.x < e || c.x > LOT_W - e || c.y < e || c.y > LOT_L - e;
}

/**
 * Placed circles that are too close to the fence, an obstacle or each other.
 * @param {Placed[]} circles
 * @param {number} hubId
 * @param {number} width
 */
export function circleProblems(circles, hubId, width) {
  /** @type {Set<number>} */
  const bad = new Set();
  /** @type {string[]} */
  const notes = [];
  /** @param {Placed} c */
  const name = (c) => (c.id === hubId ? 'The roundabout' : 'Circle ' + c.label);
  circles.forEach((c, i) => {
    if (nearFence(c, width)) { bad.add(c.id); notes.push(name(c) + ' runs too close to the fence.'); }
    for (const o of OBSTACLES) {
      if (obstacleGap(o, c.x, c.y) < c.r + width / 2 + 3) { bad.add(c.id); notes.push(name(c) + ' runs into ' + o.name + '.'); }
    }
    for (const o of circles.slice(i + 1)) {
      if (Math.hypot(c.x - o.x, c.y - o.y) >= c.r + o.r + width + MIN_GRASS) { continue; }
      bad.add(c.id); bad.add(o.id);
      notes.push(name(c) + ' and ' + name(o).toLowerCase() + ' are too close.');
    }
  });
  return { bad, notes };
}

/**
 * Calls visit with every ordering of items (Heap's algorithm, iterative).
 * @template T
 * @param {T[]} items
 * @param {(perm: T[]) => void} visit
 */
export function permute(items, visit) {
  check(items.length <= MAX_CIRCLES, 'too many items to permute');
  const a = items.slice(), n = a.length, c = new Array(n).fill(0);
  visit(a);
  let i = 0;
  for (let guard = 0; guard < 100000 && i < n; guard++) {
    if (at(c, i) < i) {
      const j = i % 2 === 0 ? 0 : at(c, i);
      const t = at(a, j);
      a[j] = at(a, i);
      a[i] = t;
      visit(a);
      c[i] = at(c, i) + 1;
      i = 0;
    } else {
      c[i] = 0;
      i++;
    }
  }
}

/** @param {HubDir} dir */
function hubSigns(dir) {
  if (dir === 'either') { return [1, -1]; }
  return [dir === 'cw' ? -1 : 1];
}

/**
 * The roundabout first, then perm, each ridden the way its bit in mask says.
 * @param {Placed} hub
 * @param {Placed[]} perm
 * @param {number} hubSign
 * @param {number} mask
 * @returns {Ring[]}
 */
function ringOrder(hub, perm, hubSign, mask) {
  /** @type {Ring[]} */
  const order = [{ x: hub.x, y: hub.y, r: hub.r, s: hubSign, id: hub.id }];
  perm.forEach((c, q) => { order.push({ x: c.x, y: c.y, r: c.r, s: ((mask >> q) & 1) ? -1 : 1, id: c.id }); });
  return order;
}

/**
 * Every loop through the roundabout that passes the quick test.
 * @param {Placed} hub
 * @param {Placed[]} others
 * @param {number} width
 * @param {SolveOpts} opts
 */
function enumerateLoops(hub, others, width, opts) {
  const signs = hubSigns(opts.hubDir), full = (1 << others.length) - 1;
  /** @type {{ order: Ring[], len: number }[]} */
  const found = [];
  let passed = 0;
  for (let sub = opts.useAll ? full : 1; sub <= full; sub++) {
    const chosen = others.filter((_c, q) => ((sub >> q) & 1) === 1);
    permute(chosen, (perm) => {
      for (let combo = 0; combo < signs.length * (1 << perm.length); combo++) {
        const order = ringOrder(hub, perm, at(signs, combo % signs.length), Math.floor(combo / signs.length));
        const len = quickLayout(order, width);
        if (len < 0) { continue; }
        passed++;
        if (found.length < FOUND_CAP) { found.push({ order, len }); }
      }
    });
  }
  return { found, passed };
}

/** @param {Rank} rank @param {number} len @param {number} peak loudest weighted neighbour, dB */
function rankScore(rank, len, peak) {
  if (rank === 'longest') { return len; }
  if (rank === 'quiet') { return -peak * 1000 + len / 100; }
  return len / 100 - peak;
}

/** @param {{ order: Ring[], len: number }[]} found @param {SolveOpts} opts @returns {Layout[]} */
function rankLoops(found, opts) {
  const stride = Math.max(1, Math.ceil(found.length / EVAL_BUDGET));
  /** @type {Layout[]} */
  const scored = [];
  for (let i = 0; i < found.length; i += stride) {
    const order = at(found, i).order, tr = buildCircleTrack(order), sim = lapSim(tr.samples, opts.quietFrom);
    const peak = weightedPeak(noiseAt(tr.samples, sim, opts.nbs), opts.concerns);
    scored.push({ order, len: tr.length, score: rankScore(opts.rank, tr.length, peak) });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

/** The best few that leave enough grass and clear every obstacle. @param {Layout[]} scored @param {number} width */
function acceptLoops(scored, width) {
  /** @type {Layout[]} */
  const out = [];
  for (let i = 0; i < scored.length && i < CHECK_BUDGET && out.length < BATCH; i++) {
    const it = at(scored, i), tr = buildCircleTrack(it.order);
    if (closestPass(tr.samples, tr.length) >= width + MIN_GRASS && !samplesHitObstacle(tr.samples, width)) { out.push(it); }
  }
  return out;
}

/**
 * Every way to link the roundabout with some or all of the other circles, best first.
 * @param {Placed[]} circles
 * @param {number} hubId
 * @param {number} width
 * @param {SolveOpts} opts
 */
export function solveCircles(circles, hubId, width, opts) {
  check(circles.length >= 2 && circles.length <= MAX_CIRCLES, 'need 2 to ' + String(MAX_CIRCLES) + ' circles');
  check(opts.nbs.length > 0, 'the solver needs the neighbours');
  const hub = circles.find((c) => c.id === hubId) ?? at(circles, 0);
  const { found, passed } = enumerateLoops(hub, circles.filter((c) => c !== hub), width, opts);
  return { layouts: acceptLoops(rankLoops(found, opts), width), passed };
}

/* ---------- lap sim ---------- */

/** Corner speed limits from grip. @param {Sample[]} samples */
function speedLimits(samples) {
  return Float64Array.from(samples, (s) => {
    const mu = s.berm ? SIM.bermGrip : SIM.grip;
    return s.curv > 0 ? Math.min(SIM.vcap, Math.sqrt(mu * G * (FT / s.curv))) : SIM.vcap;
  });
}

/** Accelerate as hard as allowed; two laps so the start carries speed. @param {Sample[]} samples @param {Float64Array} vmax @param {number} quietFrom */
function forwardPass(samples, vmax, quietFrom) {
  const n = samples.length, v = new Float64Array(n);
  let cur = 0;
  for (let i = 0; i < 2 * n; i++) {
    const k = i % n, acc = at(samples, k).y >= quietFrom ? SIM.quietAccel : SIM.accel;
    cur = Math.min(at(vmax, k), Math.sqrt(cur * cur + 2 * acc * wrap(samples, k - 1).ds * FT));
    if (i >= n) { v[k] = cur; }
  }
  return v;
}

/** Brake in time for every corner. @param {Sample[]} samples @param {Float64Array} v */
function backwardPass(samples, v) {
  const n = samples.length;
  let cur = at(v, 0);
  for (let i = 2 * n - 1; i >= 0; i--) {
    const k = i % n;
    cur = Math.min(at(v, k), Math.sqrt(cur * cur + 2 * SIM.brake * at(samples, k).ds * FT));
    if (i < n) { v[k] = cur; }
  }
}

/** @param {Sample[]} samples @param {Float64Array} v @returns {Sim} */
function summarize(samples, v) {
  const n = samples.length, thr = new Int8Array(n);
  let time = 0, top = 0, dist = 0;
  for (let i = 0; i < n; i++) {
    const ds = at(samples, i).ds * FT, vi = at(v, i), vn = wrap(v, i + 1);
    time += ds / Math.max(0.3, (vi + vn) / 2);
    dist += ds;
    top = Math.max(top, vi);
    const a = ds > 1e-6 ? (vn * vn - vi * vi) / (2 * ds) : 0;
    thr[i] = a > 0.4 * SIM.accel ? 2 : (a < -0.4 * SIM.brake ? 0 : 1);
  }
  return { time, top, avg: dist / time, v, thr };
}

/**
 * Point-mass lap: speed at every sample and the throttle state (0 brake, 1 part, 2 full).
 * @param {Sample[]} samples
 * @param {number} quietFrom y past which the rider eases off; Infinity for none
 * @returns {Sim}
 */
export function lapSim(samples, quietFrom) {
  check(samples.length > 10, 'track too short to simulate');
  check(!Number.isNaN(quietFrom), 'ease-off line must be a number');
  const v = forwardPass(samples, speedLimits(samples), quietFrom);
  backwardPass(samples, v);
  return summarize(samples, v);
}

/** Share of lap time at full throttle. @param {Sample[]} samples @param {Sim} sim */
export function fullThrottleShare(samples, sim) {
  let t = 0;
  samples.forEach((p, i) => { if (at(sim.thr, i) === 2) { t += (p.ds * FT) / Math.max(0.3, at(sim.v, i)); } });
  return t / sim.time;
}

/* ---------- noise at the neighbours ---------- */

/** @param {Gaps} gaps @returns {Neighbor[]} */
export function neighbors(gaps) {
  check(gaps.back > 0 && gaps.north > 0 && gaps.south > 0, 'neighbour distances must be positive');
  /** @type {Neighbor[]} */
  const list = BACK_DOORS.map((x) => ({ group: 'back', x, y: LOT_L + gaps.back }));
  list.push({ group: 'north', x: LOT_W + gaps.north, y: 0 });
  list.push({ group: 'south', x: -gaps.south, y: -25 });
  return list;
}

/** @param {Neighbor} nb @param {number} x @param {number} y */
export function distTo(nb, x, y) { return Math.max(NOISE.minDist, Math.hypot(nb.x - x, nb.y - y)); }

/** Peak and time-averaged level at one door. @param {Sample[]} samples @param {Sim} sim @param {Neighbor} nb */
function levelAt(samples, sim, nb) {
  let peak = -Infinity, energy = 0, T = 0;
  samples.forEach((p, i) => {
    const L = at(NOISE.levels, at(sim.thr, i)) - 20 * Math.log10(distTo(nb, p.x, p.y) / NOISE.ref);
    const dt = (p.ds * FT) / Math.max(0.3, at(sim.v, i));
    peak = Math.max(peak, L);
    energy += dt * Math.pow(10, L / 10);
    T += dt;
  });
  return { peak, avg: 10 * Math.log10(Math.max(energy, 1e-12) / Math.max(T, 1e-6)) };
}

/**
 * Loudest door in each group, in dB compared with full throttle 50 ft away.
 * @param {Sample[]} samples
 * @param {Sim} sim
 * @param {Neighbor[]} nbs
 * @returns {Noise}
 */
export function noiseAt(samples, sim, nbs) {
  check(sim.thr.length === samples.length, 'sim and track must match');
  /** @type {Noise} */
  const out = { back: { peak: -99, avg: -99 }, north: { peak: -99, avg: -99 }, south: { peak: -99, avg: -99 } };
  for (const nb of nbs) {
    const lv = levelAt(samples, sim, nb), g = out[nb.group];
    g.peak = Math.max(g.peak, lv.peak);
    g.avg = Math.max(g.avg, lv.avg);
  }
  return out;
}

/** The loudest peak among the groups he cares about, each offset by its concern. @param {Noise} nz @param {Concerns} concerns */
export function weightedPeak(nz, concerns) {
  let worst = -99;
  for (const g of GROUPS) {
    const off = CONCERN_DB[concerns[g]];
    if (off !== null) { worst = Math.max(worst, nz[g].peak + off); }
  }
  return worst;
}

/* ---------- reading a track ---------- */

/** Closest approach between two parts of the track that aren't neighbours along it. @param {Sample[]} samples @param {number} total */
export function closestPass(samples, total) {
  /** @type {Sample[]} */
  const pick = [];
  /** @type {number[]} */
  const along = [];
  let acc = 0;
  samples.forEach((p, i) => { if (i % 3 === 0) { pick.push(p); along.push(acc); } acc += p.ds; });
  let best = Infinity;
  for (let a = 0; a < pick.length; a++) {
    for (let b = a + 1; b < pick.length; b++) {
      const gap = at(along, b) - at(along, a);
      if (Math.min(gap, total - gap) < 45) { continue; }
      const pa = at(pick, a), pb = at(pick, b);
      best = Math.min(best, Math.hypot(pa.x - pb.x, pa.y - pb.y));
    }
  }
  return best;
}

/** Jumps, start gate, corner counts. @param {Track} tr @returns {Feat} */
export function features(tr) {
  check(tr.straights.length > 0, 'a track needs straights');
  const longestStraight = tr.straights.reduce((a, b) => (b.len > a.len ? b : a));
  const usable = tr.straights.filter((s) => s.len >= 30);
  const start = usable.length ? usable.reduce((a, b) => (b.mid.y < a.mid.y ? b : a)) : longestStraight;
  const lefts = tr.cs.filter((c) => c.turn === 'L').length, hair = tr.cs.filter((c) => c.hair).length;
  return { jumps: tr.straights.filter((s) => s.len >= 70), start, longest: longestStraight.len, lefts,
    rights: tr.cs.length - lefts, hairpins: tr.kind === 'grid' ? Math.round(hair / 2) : hair };
}

/** Grid batch score: length, a jump straight, use of the yard, mixed turns, few wiggles. @param {Track} tr @param {Uint8Array} set */
function scoreTrack(tr, set) {
  const f = features(tr);
  const jogs = tr.cs.filter((c, k) => c.lout <= 1.2 * STEP && c.turn !== wrap(tr.cs, k + 1).turn).length;
  const rows = [];
  for (let i = 0; i < set.length; i++) { if (at(set, i) === 1) { rows.push(Math.floor(i / C)); } }
  const span = rows.length ? (Math.max(...rows) - Math.min(...rows) + 1) / R : 0;
  const balance = Math.min(f.lefts, f.rights) / Math.max(1, f.lefts, f.rights);
  return tr.length / 1000 + (f.longest >= 70 ? 0.6 : 0) + (span >= 0.85 ? 0.5 : 0)
    - 0.15 * Math.max(0, jogs - 1) - 0.03 * Math.max(0, tr.cs.length - 18) + 0.4 * balance;
}

/** @param {Uint8Array} a @param {Uint8Array} b */
function jaccard(a, b) {
  let inter = 0, uni = 0;
  a.forEach((v, i) => { const w = at(b, i); inter += v & w; uni += v | w; });
  return uni ? inter / uni : 1;
}

/** Random grid layouts that form one loop and clear every obstacle. @param {BatchOpts} opts @returns {GridLayout[]} */
function batchCandidates(opts) {
  const rand = rng(opts.seed), blocked = blockedCells(opts.width);
  /** @type {GridLayout[]} */
  const cands = [];
  for (let t = 0; t < CANDIDATES; t++) {
    const set = growShape(rand, opts.fill, opts.flow, blocked), loop = traceBoundary(set);
    const corners = loop ? cornersFromLoop(loop) : [];
    if (corners.length < 4) { continue; }
    const tr = buildTrack(corners, opts.rmax);
    if (!samplesHitObstacle(tr.samples, opts.width)) { cands.push({ set, corners, score: scoreTrack(tr, set) }); }
  }
  return cands;
}

/** Six different grid layouts, best first. @param {BatchOpts} opts @returns {GridLayout[]} */
export function makeBatch(opts) {
  const cands = batchCandidates(opts);
  cands.sort((a, b) => b.score - a.score);
  /** @type {GridLayout[]} */
  const chosen = [];
  for (const c of cands) {
    if (chosen.length < BATCH && chosen.every((x) => jaccard(x.set, c.set) <= 0.75)) { chosen.push(c); }
  }
  for (const c of cands) {
    if (chosen.length < BATCH && !chosen.includes(c)) { chosen.push(c); }
  }
  return chosen;
}

/* ---------- draw mode: finish the loop ---------- */

/** Grid points too close to an obstacle to lay track on. @param {number} width */
export function blockedNodes(width) {
  const out = new Uint8Array(NODES);
  for (let k = 0; k < NODES; k++) {
    const p = nodeXY(k);
    out[k] = obstacleDist(p.x, p.y) < width / 2 + 2 ? 1 : 0;
  }
  return out;
}

/** @param {Int32Array} prev @param {number} from @param {number} end */
function unwind(prev, from, end) {
  const tail = [];
  for (let x = from, g = 0; x !== end && g < NODES; g++) { tail.push(x); x = at(prev, x); }
  return tail.reverse();
}

/**
 * Breadth-first: the shortest way from the end of the draft back to its start.
 * @param {number[]} draft
 * @param {() => number} rand
 * @param {Uint8Array} blocked
 * @returns {number[] | null}
 */
export function finishShortest(draft, rand, blocked) {
  check(draft.length >= 2 && blocked.length === NODES, 'lay at least one piece first');
  const start = at(draft, 0), end = at(draft, draft.length - 1);
  const used = Uint8Array.from(blocked), seen = new Uint8Array(NODES);
  const prev = new Int32Array(NODES).fill(-1), depth = new Int32Array(NODES);
  for (const k of draft) { used[k] = 1; }
  const queue = [end];
  seen[end] = 1;
  for (let h = 0; h < queue.length && h < NODES; h++) {
    const u = at(queue, h);
    for (const nb of shuffle(gridNbs(u), rand)) {
      if (nb === start && draft.length + at(depth, u) >= 4) { return draft.concat(unwind(prev, u, end)); }
      if (at(used, nb) === 1 || at(seen, nb) === 1) { continue; }
      seen[nb] = 1; prev[nb] = u; depth[nb] = at(depth, u) + 1;
      queue.push(nb);
    }
  }
  return null;
}

/** Turn direction at b: 0 straight, ±1 left/right. @param {number} a @param {number} b @param {number} c */
function turnSign(a, b, c) {
  /** @param {number} d */
  const vec = (d) => (Math.abs(d) === 1 ? { x: d, y: 0 } : { x: 0, y: Math.sign(d) });
  const d1 = vec(b - a), d2 = vec(c - b);
  return d1.x * d2.y - d1.y * d2.x;
}

/** Longer is better, some corners are good, 20 ft wiggles are bad. @param {number[]} loop */
function loopScore(loop) {
  const sign = loop.map((b, k) => turnSign(wrap(loop, k - 1), b, wrap(loop, k + 1)));
  const turns = sign.filter((s) => s !== 0).length;
  const jogs = sign.filter((s, k) => s !== 0 && s === -wrap(sign, k + 1)).length;
  return loop.length + Math.min(turns, 16) - 2.5 * jogs;
}

/** Score of the loop that closing path back to its start would make; -Infinity if it's too small. @param {number[]} path */
function closedScore(path) { return path.length >= 4 ? loopScore(path) : -Infinity; }

/** Neighbours in random order, straight ahead first more often than not. @param {number} u @param {number} from @param {() => number} rand */
function orderNbs(u, from, rand) {
  const nbs = shuffle(gridNbs(u), rand), ix = nbs.indexOf(u + (u - from));
  if (from >= 0 && ix > 0 && rand() < 0.6) { nbs.splice(ix, 1); nbs.unshift(u + (u - from)); }
  return nbs;
}

/**
 * One bounded depth-first search for a good way back to the start.
 * @param {number[]} draft
 * @param {() => number} rand
 * @param {Uint8Array} blocked
 */
function scenicOnce(draft, rand, blocked) {
  const start = at(draft, 0), used = Uint8Array.from(blocked), path = draft.slice();
  for (const k of draft) { used[k] = 1; }
  const stack = [{ u: at(path, path.length - 1), nbs: orderNbs(at(path, path.length - 1), at(path, path.length - 2), rand), i: 0 }];
  let best = null, bestScore = -Infinity;
  for (let ex = 0; ex < DFS_BUDGET && stack.length > 0; ex++) {
    const top = at(stack, stack.length - 1);
    if (top.i >= top.nbs.length) {
      stack.pop();
      if (stack.length > 0) { used[top.u] = 0; path.pop(); }
      continue;
    }
    const nb = at(top.nbs, top.i++), closing = nb === start ? closedScore(path) : -Infinity;
    if (closing > bestScore) { bestScore = closing; best = path.slice(); }
    if (at(used, nb) === 1) { continue; }
    used[nb] = 1;
    path.push(nb);
    stack.push({ u: nb, nbs: orderNbs(nb, top.u, rand), i: 0 });
  }
  return best ? { loop: best, score: bestScore } : null;
}

/**
 * Many short random searches; keeps the best loop found.
 * @param {number[]} draft
 * @param {() => number} rand
 * @param {Uint8Array} blocked
 * @returns {number[] | null}
 */
export function finishScenic(draft, rand, blocked) {
  check(draft.length >= 2 && blocked.length === NODES, 'lay at least one piece first');
  let best = null, bestScore = -Infinity;
  for (let tryNo = 0; tryNo < DFS_RESTARTS; tryNo++) {
    const found = scenicOnce(draft, rand, blocked);
    if (found && found.score > bestScore) { bestScore = found.score; best = found.loop; }
  }
  return best;
}

/** Grid points from a (exclusive) to b (inclusive) along a row or column, or null if not in line. @param {number} a @param {number} b */
export function lineNodes(a, b) {
  const ai = a % NI, aj = (a - ai) / NI, bi = b % NI, bj = (b - bi) / NI;
  if (ai !== bi && aj !== bj) { return null; }
  const di = Math.sign(bi - ai), dj = Math.sign(bj - aj), out = [];
  for (let g = 1; g <= NI + NJ; g++) {
    out.push((aj + dj * g) * NI + ai + di * g);
    if (ai + di * g === bi && aj + dj * g === bj) { return out; }
  }
  return out;
}
