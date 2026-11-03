import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replay, roll, seedFromName, faceForRoll, normalizeName, opposite } from '../src/chaos.js';

test('names are normalized', () => {
  assert.equal(normalizeName('  Drew   the  Bold '), 'drew the bold');
  assert.equal(seedFromName('Drew'), seedFromName(' drew '));
  assert.notEqual(seedFromName('Drew'), seedFromName('Drew2'));
});

test('roll 0 is all zeros and first result is always zero', () => {
  const s = replay('Grimble', 0);
  assert.deepEqual(s.values, [0, 0, 0, 0, 0, 0]);
  const r = roll(s);
  assert.equal(r.result, 0);
  assert.equal(s.values[r.face], 1);
  assert.equal(s.values[opposite(r.face)], -1);
});

test('values always sum to zero', () => {
  const s = replay('Sum Check', 5000);
  assert.equal(s.values.reduce((a, b) => a + b, 0), 0);
});

test('incremental rolling matches replay (resume works)', () => {
  const live = replay('Thalia', 0);
  for (let i = 0; i < 777; i++) roll(live);
  const resumed = replay('thalia', 777);
  assert.deepEqual(resumed.values, live.values);
  assert.deepEqual(resumed.history, live.history);
});

test('faces are roughly uniform', () => {
  const seed = seedFromName('Uniform');
  const counts = [0, 0, 0, 0, 0, 0];
  const N = 600_000;
  for (let n = 1; n <= N; n++) counts[faceForRoll(seed, n)]++;
  for (const c of counts) assert.ok(Math.abs(c / N - 1 / 6) < 0.005, `skewed: ${counts}`);
});
