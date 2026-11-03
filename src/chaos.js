// Pure, deterministic Chaos Dice logic. No DOM, no randomness beyond the seed.
//
// Rules:
//  - Faces are A–F. Opposite pairs: A↔F, B↔E, C↔D (index i ↔ 5 - i).
//  - At roll 0 every face reads 0.
//  - Roll n (1-based) picks a face from hash(seed, n), each face equally likely.
//  - The result is that face's current value. AFTER the result, the face is
//    incremented by 1 and its opposite face is decremented by 1.

export const FACES = ['A', 'B', 'C', 'D', 'E', 'F'];
export const HISTORY_LIMIT = 50;
export const MAX_ROLLS = 100_000_000;

export const opposite = (i) => 5 - i;

/** Trim, collapse whitespace and ignore case so retyped names still match. */
export function normalizeName(name) {
  return String(name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** cyrb53-style string hash → unsigned 32-bit seed. */
export function seedFromName(name) {
  const str = normalizeName(name);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h1 ^ h2) >>> 0;
}

/** Strong 32-bit integer mixer (lowbias32). */
function mix32(x) {
  x |= 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}

/** Face index (0–5) for roll number n (1-based) with the given seed. */
export function faceForRoll(seed, n) {
  const h = mix32(seed ^ mix32((n + 0x9e3779b9) | 0));
  const h2 = mix32(h + seed);
  return Math.floor((h2 / 4294967296) * 6);
}

/**
 * Rebuild the full state for a character after `rolls` rolls by replaying.
 * Returns { seed, rolls, values[6], history[] (newest last) }.
 */
export function replay(name, rolls) {
  const seed = seedFromName(name);
  const values = [0, 0, 0, 0, 0, 0];
  const history = [];
  const keepFrom = rolls - HISTORY_LIMIT;
  for (let n = 1; n <= rolls; n++) {
    const face = faceForRoll(seed, n);
    if (n > keepFrom) history.push({ n, face, result: values[face] });
    values[face] += 1;
    values[opposite(face)] -= 1;
  }
  return { seed, rolls, values, history };
}

/**
 * Perform the next roll, mutating state. Returns { n, face, result }.
 * `result` is the face's value before the post-roll increment/decrement.
 */
export function roll(state) {
  const n = state.rolls + 1;
  const face = faceForRoll(state.seed, n);
  const entry = { n, face, result: state.values[face] };
  state.values[face] += 1;
  state.values[opposite(face)] -= 1;
  state.rolls = n;
  state.history.push(entry);
  if (state.history.length > HISTORY_LIMIT) state.history.shift();
  return entry;
}

/**
 * Colour for a value: black at zero, bluer as it rises, redder as it falls.
 * Saturates gradually so even large swings stay distinguishable.
 */
export function valueColor(v) {
  const dark = [22, 18, 16];
  if (v === 0) return `rgb(${dark.join(',')})`;
  const t = 1 - Math.exp(-Math.abs(v) / 6);
  const target = v > 0 ? [18, 78, 230] : [205, 18, 28];
  const c = dark.map((d, i) => Math.round(d + (target[i] - d) * (0.35 + 0.65 * t)));
  return `rgb(${c.join(',')})`;
}
