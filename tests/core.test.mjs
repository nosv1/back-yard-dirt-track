// Tests for src/core.js: the geometry, solvers, sim and noise model. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  at, buildCircleTrack, circleProblems, closestPass, exhaustDb, NOISE, lapSim, neighbors, noiseAt, randomCircles, rng,
  samplesHitObstacle, solveCircles, tangent, weightedPeak,
} from '../src/core.js';

const EXAMPLE = [
  { x: 72, y: 160, r: 30 }, { x: 118, y: 62, r: 20 }, { x: 35, y: 90, r: 20 },
  { x: 138, y: 140, r: 16 }, { x: 40, y: 235, r: 22 }, { x: 125, y: 240, r: 20 },
].map((c, i) => ({ ...c, id: i + 1, label: i === 0 ? 'R' : String(i) }));
const GAPS = { back: 45, north: 30, south: 75 };
const CONCERNS = { back: 'high', north: 'some', south: 'none' };

/** @param {{ hubDir?: string, quietFrom?: number, useAll?: boolean }} over */
function solve(over) {
  return solveCircles(EXAMPLE, 1, 10, { useAll: false, rank: 'both', nbs: neighbors(GAPS), quietFrom: 182,
    hubDir: 'either', concerns: CONCERNS, ...over });
}

test('tangent leaves and joins each ring in its riding direction', () => {
  const rand = rng(9);
  let checked = 0;
  for (let t = 0; t < 2000; t++) {
    const A = { x: rand() * 100, y: rand() * 300, r: 10 + rand() * 30, s: rand() < 0.5 ? 1 : -1, id: 1 };
    const B = { x: rand() * 100, y: rand() * 300, r: 10 + rand() * 30, s: rand() < 0.5 ? 1 : -1, id: 2 };
    const T = tangent(A, B);
    if (!T) { continue; }
    checked++;
    const va = { x: -(T.ay - A.y) / A.r * A.s, y: (T.ax - A.x) / A.r * A.s };
    const vb = { x: -(T.by - B.y) / B.r * B.s, y: (T.bx - B.x) / B.r * B.s };
    assert.ok(Math.hypot(va.x - T.ux, va.y - T.uy) < 1e-9, 'leaves A along its direction');
    assert.ok(Math.hypot(vb.x - T.ux, vb.y - T.uy) < 1e-9, 'joins B along its direction');
    assert.ok(Math.abs(Math.hypot(T.ax - A.x, T.ay - A.y) - A.r) < 1e-9, 'touches A');
  }
  assert.ok(checked > 1000);
});

test('the example circles are valid and the solver links them', () => {
  assert.deepEqual(circleProblems(EXAMPLE, 1, 10).notes, []);
  const res = solve({});
  assert.equal(res.layouts.length, 6);
  for (const l of res.layouts) {
    const tr = buildCircleTrack(l.order);
    assert.ok(closestPass(tr.samples, tr.length) >= 16, 'at least 6 ft of grass at 10 ft wide');
    assert.ok(!samplesHitObstacle(tr.samples, 10), 'clear of the house, fire pit and box');
  }
});

test('roundabout direction: either way finds both directions of every loop', () => {
  const ccw = solve({ hubDir: 'ccw' }).passed, cw = solve({ hubDir: 'cw' }).passed;
  assert.equal(solve({ hubDir: 'either' }).passed, ccw + cw);
  assert.ok(solve({ hubDir: 'cw' }).layouts.every((l) => at(l.order, 0).s === -1));
});

test('using every circle finds fewer loops than allowing skips', () => {
  assert.ok(solve({ useAll: true }).passed < solve({ useAll: false }).passed);
});

test('easing off near the back lowers the back neighbours peak', () => {
  const order = at(solve({ quietFrom: Infinity, rank: 'longest' }).layouts, 0).order;
  const tr = buildCircleTrack(order), nbs = neighbors(GAPS);
  const loud = noiseAt(tr.samples, lapSim(tr.samples, Infinity), nbs).back.peak;
  const eased = noiseAt(tr.samples, lapSim(tr.samples, 182), nbs).back.peak;
  assert.ok(eased < loud - 2, 'at least 2 dB quieter: ' + String(loud) + ' -> ' + String(eased));
});

test('weightedPeak ignores neighbours he does not mind', () => {
  const nz = { back: { peak: -9, avg: -12 }, north: { peak: -2, avg: -8 }, south: { peak: 5, avg: 0 } };
  assert.equal(weightedPeak(nz, { back: 'high', north: 'some', south: 'none' }), -8);
  assert.equal(weightedPeak(nz, { back: 'high', north: 'none', south: 'none' }), -9);
  assert.equal(weightedPeak(nz, { back: 'none', north: 'none', south: 'none' }), -99);
});

test('random circles always fit, and most sets solve', () => {
  const rand = rng(77);
  let solved = 0;
  for (let t = 0; t < 30; t++) {
    const placed = randomCircles(rand, 10).map((c, i) => ({ ...c, id: i + 1, label: String(i) }));
    assert.ok(placed.length >= 2 && placed.length <= 7, 'between 2 and 7 circles');
    assert.deepEqual(circleProblems(placed, 1, 10).notes, [], 'clear of the fence, obstacles and each other');
    const res = solveCircles(placed, 1, 10, { useAll: false, rank: 'both', nbs: neighbors(GAPS), quietFrom: 182,
      hubDir: 'either', concerns: CONCERNS });
    if (res.layouts.length > 0) { solved++; }
  }
  assert.ok(solved >= 20, 'at least 20 of 30 random sets have a loop (got ' + String(solved) + ')');
});

test('exhaust: loudest behind the bike, quietest ahead, a bit louder on the pipe side', () => {
  const p = { x: 0, y: 0 }, q = { x: 0, y: 1 };
  assert.equal(exhaustDb(p, q, { x: 0, y: -50 }), 0);
  assert.equal(exhaustDb(p, q, { x: 0, y: 50 }), -NOISE.spread);
  assert.ok(Math.abs(exhaustDb(p, q, { x: 50, y: 0 }) - (NOISE.side - NOISE.spread / 2)) < 1e-12, 'right side');
  assert.ok(Math.abs(exhaustDb(p, q, { x: -50, y: 0 }) + NOISE.spread / 2) < 1e-12, 'left side');
});
