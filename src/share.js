// "Share my die": draws a portrait share card (1080×1350) of the player's die
// and shares it through the native share sheet, or returns it for a download
// fallback where file sharing isn't supported (most desktop browsers).

import { FACES, valueColor } from './chaos.js';

const W = 1080;
const H = 1350;
const SITE = 'https://chaosdice.online';

const fmt = (v) => (v < 0 ? `−${Math.abs(v).toLocaleString('en-US')}` : v.toLocaleString('en-US'));
const signed = (v) => (v > 0 ? `+${fmt(v)}` : fmt(v));

/**
 * Filename for the card: chaosdice-online-<character>-roll-<n>.png, so repeated
 * downloads don't collide. The name is slugged to be safe on every OS.
 */
export function shareFilename(name, rolls) {
  const slug = String(name)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // drop accents: é → e
    .toLowerCase()
    // Letters with no accent to strip, common in fantasy names.
    .replace(/[æœøßðþłđ]/g, (c) => ({ æ: 'ae', œ: 'oe', ø: 'o', ß: 'ss', ð: 'd', þ: 'th', ł: 'l', đ: 'd' })[c])
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return `chaosdice-online-${slug || 'character'}-roll-${rolls}.png`;
}

/** Caption to go with the image. */
export function shareText({ rolls, values }) {
  const hi = Math.max(...values);
  const lo = Math.min(...values);
  const n = rolls.toLocaleString('en-US');
  return `My Chaos Die after ${n} roll${rolls === 1 ? '' : 's'}: highest face ${signed(hi)}, lowest ${fmt(lo)}. Roll yours at ${SITE}`;
}

/**
 * Draw the card. `dieImage` is a canvas snapshot of the 3D die (or null when
 * WebGL isn't available). Returns a canvas.
 */
export function drawShareCard({ name, rolls, values, last, dieImage }) {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');

  // Plum night background, as on the site.
  const bg = ctx.createRadialGradient(W / 2, H * 0.32, 0, W / 2, H * 0.32, H * 0.85);
  bg.addColorStop(0, '#2f1d40');
  bg.addColorStop(0.4, '#1c1228');
  bg.addColorStop(1, '#0b0712');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  drawEmbers(ctx);

  // Title
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  // Mixed case: Cinzel's lowercase are small capitals, matching the site's title.
  setSpacing(ctx, '5px');
  ctx.font = '700 76px Cinzel, Georgia, serif';
  ctx.fillStyle = '#000';
  ctx.fillText('Chaos Dice Online!', W / 2, 116 + 4);
  ctx.shadowColor = 'rgba(200, 144, 42, 0.55)';
  ctx.shadowBlur = 30;
  ctx.fillStyle = '#e4b965';
  ctx.fillText('Chaos Dice Online!', W / 2, 116);
  ctx.shadowBlur = 0;
  setSpacing(ctx, '0px');

  // The die, faded softly into the background.
  if (dieImage) {
    const size = 540;
    const x = (W - size) / 2;
    const y = 146;
    const tmp = document.createElement('canvas');
    tmp.width = tmp.height = size;
    const t = tmp.getContext('2d');
    t.drawImage(dieImage, 0, 0, size, size);
    t.globalCompositeOperation = 'destination-in';
    const m = t.createRadialGradient(size / 2, size / 2, size * 0.3, size / 2, size / 2, size / 2);
    m.addColorStop(0, '#000');
    m.addColorStop(1, 'rgba(0,0,0,0)');
    t.fillStyle = m;
    t.fillRect(0, 0, size, size);
    ctx.drawImage(tmp, x, y);
  }
  const top = dieImage ? 690 : 230;

  // Character name, shrunk to fit.
  ctx.fillStyle = 'rgba(241, 230, 207, 0.92)';
  let nameSize = 52;
  do {
    ctx.font = `italic 400 ${nameSize}px "EB Garamond", Georgia, serif`;
    nameSize -= 2;
  } while (ctx.measureText(name).width > W - 160 && nameSize > 24);
  ctx.fillText(name, W / 2, top);

  // Result plaque
  const px = 190;
  const pw = W - px * 2;
  const py = top + 34;
  const ph = 170;
  parchment(ctx, px, py, pw, ph, 18);
  ctx.fillStyle = '#6b5440';
  ctx.font = '700 26px Cinzel, Georgia, serif';
  ctx.fillText(
    last ? `ROLL #${last.n.toLocaleString('en-US')} · FACE ${FACES[last.face]}` : `${rolls.toLocaleString('en-US')} ROLLS`,
    W / 2, py + 48,
  );
  if (last) {
    const text = fmt(last.result);
    let vs = 96;
    do {
      ctx.font = `400 ${vs}px Marcellus, Georgia, serif`;
      vs -= 4;
    } while (ctx.measureText(text).width > pw - 60 && vs > 40);
    ctx.fillStyle = valueColor(last.result);
    ctx.fillText(text, W / 2, py + 140);
  }

  // The six faces, as opposite pairs.
  const gy = py + ph + 36;
  const tileW = 400;
  const tileH = 78;
  const gap = 14;
  const leftX = W / 2 - tileW - 40;
  const rightX = W / 2 + 40;
  [[0, 5], [1, 4], [2, 3]].forEach(([a, b], row) => {
    const y = gy + row * (tileH + gap);
    faceTile(ctx, leftX, y, tileW, tileH, a, values[a], last?.face === a);
    faceTile(ctx, rightX, y, tileW, tileH, b, values[b], last?.face === b);
    ctx.fillStyle = 'rgba(241, 230, 207, 0.6)';
    ctx.font = '400 30px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText('⇄', W / 2, y + tileH / 2 + 10);
  });

  // Footer
  ctx.textAlign = 'center';
  ctx.fillStyle = '#c8902a';
  setSpacing(ctx, '6px');
  ctx.font = '700 40px Cinzel, Georgia, serif';
  ctx.fillText('chaosdice.online', W / 2, H - 56);
  setSpacing(ctx, '0px');

  return c;
}

/** Canvas letter-spacing where supported (Chrome, Safari 17+); harmless elsewhere. */
function setSpacing(ctx, v) {
  if ('letterSpacing' in ctx) ctx.letterSpacing = v;
}

function faceTile(ctx, x, y, w, h, face, v, active) {
  parchment(ctx, x, y, w, h, 14);
  if (active) {
    ctx.strokeStyle = '#c8902a';
    ctx.lineWidth = 5;
    roundRect(ctx, x + 2.5, y + 2.5, w - 5, h - 5, 12);
    ctx.stroke();
  }
  ctx.textAlign = 'left';
  ctx.fillStyle = '#6b5440';
  ctx.font = '700 34px Cinzel, Georgia, serif';
  ctx.fillText(FACES[face], x + 26, y + h / 2 + 12);
  ctx.textAlign = 'right';
  ctx.fillStyle = valueColor(v);
  let size = 44;
  do {
    ctx.font = `400 ${size}px Marcellus, Georgia, serif`;
    size -= 2;
  } while (ctx.measureText(fmt(v)).width > w - 110 && size > 20);
  ctx.fillText(fmt(v), x + w - 26, y + h / 2 + 15);
  ctx.textAlign = 'center';
}

function parchment(ctx, x, y, w, h, r) {
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, '#f1e6cf');
  g.addColorStop(1, '#e5d5b4');
  ctx.fillStyle = g;
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();
  ctx.strokeStyle = '#c8902a';
  ctx.lineWidth = 3;
  ctx.stroke();
}

function drawEmbers(ctx) {
  // Fixed positions so every card looks consistent.
  const pts = [[90, 210, 3], [980, 160, 2.5], [140, 640, 2], [960, 560, 3], [70, 980, 2.5],
    [1010, 1040, 2], [520, 40, 2], [860, 300, 1.8], [220, 1180, 2.2], [880, 1230, 2.6]];
  for (const [x, y, r] of pts) {
    ctx.fillStyle = 'rgba(255, 170, 60, 0.18)';
    ctx.beginPath(); ctx.arc(x, y, r * 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255, 214, 140, 0.9)';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Canvas → PNG File. */
export function cardToFile(canvas, filename) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(new File([blob], filename, { type: 'image/png' })) : reject(new Error('toBlob failed'))), 'image/png');
  });
}

/**
 * Try the native share sheet with the image. Resolves 'shared', 'cancelled',
 * or 'unsupported' (caller should show the download fallback).
 */
export async function nativeShare(file, text) {
  const data = { files: [file], text, title: 'Chaos Dice Online!' };
  if (!navigator.canShare || !navigator.canShare({ files: [file] })) return 'unsupported';
  try {
    await navigator.share(data);
    return 'shared';
  } catch (err) {
    return err?.name === 'AbortError' ? 'cancelled' : 'unsupported';
  }
}
