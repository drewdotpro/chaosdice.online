import { FACES, MAX_ROLLS, opposite, replay, roll, valueColor } from './chaos.js';
import { Die } from './die.js';
import { Effects } from './effects.js';
import { cardToFile, drawShareCard, nativeShare, shareFilename, shareText } from './share.js';
import rollSoundUrl from './assets/dice-roll.mp3';
import changeSoundUrl from './assets/change-magic.mp3';

const STORAGE_KEY = 'chaos-dice:v1'; // also read by the inline script in index.html
const $ = (id) => document.getElementById(id);

const els = {
  character: $('character'),
  charName: $('charName'),
  rollCount: $('rollCount'),
  resetBtn: $('resetBtn'),
  diceWrap: $('diceWrap'),
  rollBtn: $('rollBtn'),
  resultLabel: $('resultLabel'),
  resultValue: $('resultValue'),
  hud: $('hud'),
  history: $('history'),
  historyEmpty: $('historyEmpty'),
  startModal: $('startModal'),
  startForm: $('startForm'),
  nameInput: $('nameInput'),
  rollsInput: $('rollsInput'),
  formError: $('formError'),
  resetModal: $('resetModal'),
  resetSummary: $('resetSummary'),
  muteBtn: $('muteBtn'),
  shareBtn: $('shareBtn'),
  shareModal: $('shareModal'),
  sharePreview: $('sharePreview'),
  shareCaption: $('shareCaption'),
  shareCopy: $('shareCopy'),
  shareDownload: $('shareDownload'),
  shareNative: $('shareNative'),
};

let state = null; // { name, seed, rolls, values, history }
let lastFace = -1;
const die = createDie(els.diceWrap);
const fx = new Effects();
if (import.meta.env.DEV) window.__chaos = { die, fx }; // handy for debugging
die.onImpact = (pt, strength) => fx.burst(pt.x, pt.y, Math.round(10 + 22 * strength), 0.5 + 0.6 * strength);

/**
 * The 3D die, or (if WebGL is unavailable) a stand-in with the same interface
 * so the game still plays. Results, faces and history all live in the DOM.
 */
function createDie(container) {
  try {
    return new Die(container);
  } catch (err) {
    console.warn('3D die unavailable, using a simple fallback.', err);
    container.innerHTML = '<p class="no-webgl">Your browser can’t show the 3D die, but rolling still works. Your results show up below.</p>';
    const center = () => {
      const r = container.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };
    return {
      rolling: false,
      onImpact: null,
      setValues() {},
      redrawAll() {},
      showFace() {},
      finishMorph() {},
      morphFace() { return Promise.resolve(); },
      snapshot() { return null; },
      screenPoint: center,
      roll() {
        this.rolling = true;
        return new Promise((resolve) => setTimeout(() => { this.rolling = false; resolve(); }, 300));
      },
    };
  }
}

// ---------- sound ----------
// Web Audio rather than <audio>: lower latency, and once unlocked by a tap it can
// play later (the transformation sound fires ~2s after the click), which iOS
// Safari blocks for media elements that weren't started inside a gesture.
//
// Autoplay rules: an AudioContext may only start in response to a user gesture.
// So the files are downloaded up front, but the context is created (and the files
// decoded) inside the first gesture, never at page load.
const MUTE_KEY = 'chaos-dice:muted';
const SOUND_URLS = { roll: rollSoundUrl, change: changeSoundUrl };
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audio = null;
const buffers = {}; // name -> Promise<AudioBuffer | null>
const soundData = {}; // name -> Promise<ArrayBuffer | null>, fetched early
if (AudioCtx) {
  for (const [name, url] of Object.entries(SOUND_URLS)) {
    soundData[name] = fetch(url).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
  }
  // iOS (every iPhone browser uses Safari's engine) only unlocks reliably on
  // touchend/click, and can later put the context into an "interrupted" state
  // (calls, app switches), so we keep listening and re-resume whenever needed.
  const GESTURES = ['pointerdown', 'pointerup', 'mousedown', 'touchend', 'keydown', 'click'];
  const unlock = () => {
    if (!audio) {
      try {
        audio = new AudioCtx();
      } catch {
        return;
      }
      for (const [name, data] of Object.entries(soundData)) {
        // Callback form: older Safari's decodeAudioData doesn't return a promise.
        buffers[name] = data
          .then((d) => (d ? new Promise((res, rej) => audio.decodeAudioData(d, res, rej)) : null))
          .catch(() => null);
      }
    }
    if (audio.state !== 'running') {
      audio.resume?.().catch(() => {});
      // Older iOS only fully unlocks if something actually plays during the
      // gesture: play one silent sample.
      try {
        const src = audio.createBufferSource();
        src.buffer = audio.createBuffer(1, 1, 22050);
        src.connect(audio.destination);
        src.start(0);
      } catch { /* ignore */ }
    }
  };
  for (const t of GESTURES) document.addEventListener(t, unlock, { capture: true, passive: true });
}
let muted = false;
try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch { /* ignore */ }
function renderMute() {
  els.muteBtn.setAttribute('aria-pressed', String(muted));
  els.muteBtn.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
  els.muteBtn.title = muted ? 'Sound off' : 'Sound on';
  els.muteBtn.classList.toggle('muted', muted);
}
els.muteBtn.addEventListener('click', () => {
  muted = !muted;
  try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch { /* ignore */ }
  renderMute();
});
renderMute();
function playSound(name) {
  if (muted || !audio || !buffers[name]) return;
  if (audio.state !== 'running') audio.resume?.().catch(() => {});
  const requested = performance.now();
  // The very first sound can be requested while its file is still decoding (the
  // gesture that created the context is the same click that rolled). Wait for it,
  // but don't play a sound that would arrive noticeably late.
  buffers[name].then((buf) => {
    if (!buf || muted || performance.now() - requested > 300) return;
    const src = audio.createBufferSource();
    src.buffer = buf;
    src.connect(audio.destination);
    src.start();
  });
}

// ---------- storage (fails soft: private mode etc.) ----------
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (typeof data?.name !== 'string' || !data.name.trim()) return null;
    const rolls = Number.isSafeInteger(data.rolls) && data.rolls >= 0 ? Math.min(data.rolls, MAX_ROLLS) : 0;
    return { name: data.name, rolls };
  } catch {
    return null;
  }
}
function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ name: state.name, rolls: state.rolls }));
  } catch { /* storage unavailable; on-screen values still allow resuming */ }
}
function clear() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

// ---------- rendering ----------
function fmt(v) {
  return v < 0 ? `−${Math.abs(v).toLocaleString('en-US')}` : v.toLocaleString('en-US');
}

function renderHud() {
  // Laid out as opposite pairs: A|F, B|E, C|D.
  const pairs = [[0, 5], [1, 4], [2, 3]];
  els.hud.innerHTML = pairs
    .map((pair) => `<div class="pair">${pair.map((i) => {
      const v = state.values[i];
      let mark = '';
      if (lastFace === i) mark = '<span class="delta up">+1</span>';
      else if (lastFace >= 0 && opposite(lastFace) === i) mark = '<span class="delta down">−1</span>';
      return `<div class="face ${lastFace === i ? 'active' : ''}">
        <span class="face-letter">${FACES[i]}</span>
        <span class="face-value" style="color:${valueColor(v)}">${fmt(v)}</span>
        ${mark}
      </div>`;
    }).join('<span class="vs" aria-hidden="true">⇄</span>')}</div>`)
    .join('');
}

function renderHistory() {
  const items = state.history.slice().reverse();
  els.historyEmpty.hidden = items.length > 0;
  els.history.innerHTML = items
    .map((h) => `<li>
      <span class="h-n">#${h.n.toLocaleString('en-US')}</span>
      <span class="h-face">Face ${FACES[h.face]}</span>
      <span class="h-result" style="color:${valueColor(h.result)}">${fmt(h.result)}</span>
    </li>`)
    .join('');
}

function renderMeta() {
  els.character.hidden = false;
  els.charName.textContent = state.name;
  els.rollCount.textContent = state.rolls.toLocaleString('en-US');
  els.shareBtn.hidden = state.rolls === 0; // nothing to show off before the first roll
}

function renderResult(entry) {
  if (!entry) {
    els.resultLabel.textContent = state.rolls === 0 ? 'Roll the die' : 'Ready';
    els.resultValue.innerHTML = '&nbsp;';
    els.resultValue.style.color = '';
    return;
  }
  els.resultLabel.textContent = `Roll #${entry.n.toLocaleString('en-US')} · Face ${FACES[entry.face]}`;
  els.resultValue.textContent = fmt(entry.result);
  els.resultValue.style.color = valueColor(entry.result);
  els.resultValue.classList.remove('pop');
  void els.resultValue.offsetWidth; // restart animation
  els.resultValue.classList.add('pop');
}

function renderAll(entry = null) {
  renderMeta();
  renderHud();
  renderHistory();
  renderResult(entry);
  die.setValues(state.values, lastFace);
}

// ---------- game flow ----------
function start(name, rolls) {
  const s = replay(name, rolls);
  state = { name: name.trim().replace(/\s+/g, ' '), ...s };
  const last = state.history.at(-1);
  lastFace = last ? last.face : -1;
  save();
  renderAll(last ?? null);
  if (last) die.showFace(last.face);
  els.rollBtn.disabled = false;
}

// After landing, the rolled number lingers on the die, then magically
// transforms into its new value. Rolling again mid-way skips to the end.
const LINGER_MS = 650;
let settle = null; // { timer, face }

function completeSettle() {
  if (!settle) return;
  clearTimeout(settle.timer);
  lastFace = settle.face;
  settle = null;
  die.setValues(state.values, lastFace);
  renderHud();
}

function cancelSettle() {
  if (settle) clearTimeout(settle.timer);
  settle = null;
}

async function doRoll() {
  if (!state || die.rolling) return;
  completeSettle();
  const game = state; // if a reset/new character happens mid-roll, this roll is abandoned
  const before = state.values.slice();
  const entry = roll(state);
  playSound('roll');
  save();
  els.rollBtn.disabled = true;
  els.resultLabel.textContent = 'Rolling…';
  els.resultValue.innerHTML = '&nbsp;';
  // Tumble showing the pre-roll values; the face lands showing the result.
  die.setValues(before, -1);
  await die.roll(entry.face);
  if (state !== game) return; // reset while rolling

  // Landed: the result, history and count update now; the die still shows
  // the rolled value.
  renderMeta();
  renderHistory();
  renderResult(entry);
  die.setValues(before, entry.face);
  els.rollBtn.disabled = false;

  // Sparks on landing, more for wilder results; lightning when the die
  // lands on its most extreme face.
  const pt = die.screenPoint(0);
  fx.burst(pt.x, pt.y, 16 + Math.min(50, Math.abs(entry.result) * 3), 0.8);
  const peak = Math.max(...before.map(Math.abs));
  if (peak > 0 && Math.abs(entry.result) === peak) fx.strike(true);

  // A moment later, the face transforms into its new value.
  const mine = {
    face: entry.face,
    timer: setTimeout(() => {
      if (settle !== mine) return;
      lastFace = entry.face;
      renderHud();
      const top = die.screenPoint(1); // top face of the die
      fx.magic(top.x, top.y);
      playSound('change');
      die.morphFace(entry.face, state.values).then(() => {
        if (settle === mine) settle = null;
      });
    }, LINGER_MS),
  };
  settle = mine;
}

function openStart(prefill = {}) {
  els.nameInput.value = prefill.name ?? '';
  els.rollsInput.value = prefill.rolls ? String(prefill.rolls) : '';
  els.formError.textContent = '';
  els.rollBtn.disabled = true;
  els.startModal.showModal();
  setTimeout(() => els.nameInput.focus(), 50);
}

// ---------- landing screen ----------
function showLanding() {
  document.body.classList.add('landing-mode');
  els.rollBtn.disabled = true;
}
function hideLanding() {
  document.body.classList.remove('landing-mode');
}
$('playBtn').addEventListener('click', () => openStart());
$('startBack').addEventListener('click', () => els.startModal.close());

els.startForm.addEventListener('submit', (e) => {
  const name = els.nameInput.value.trim();
  const rollsRaw = els.rollsInput.value.trim();
  const rolls = rollsRaw === '' ? 0 : Number(rollsRaw);
  let err = '';
  if (!name) err = 'Give your character a name first.';
  // A number input reports '' for unparseable text (e.g. letters in Firefox), so check badInput too.
  else if (els.rollsInput.validity.badInput || !Number.isInteger(rolls) || rolls < 0) err = 'Roll count needs to be a whole number, like 0 or 42.';
  else if (rolls > MAX_ROLLS) err = `That's more rolls than we can count. The limit is ${MAX_ROLLS.toLocaleString('en-US')}.`;
  if (err) {
    e.preventDefault();
    els.formError.textContent = err;
    return;
  }
  hideLanding();
  start(name, rolls);
});

els.rollBtn.addEventListener('click', doRoll);
els.diceWrap.addEventListener('click', doRoll);
// Space rolls from anywhere, except where Space already means something:
// on a focused button/link/field it must keep its normal behaviour.
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || e.repeat || !state) return;
  if (document.querySelector('dialog[open]')) return;
  if (e.target instanceof Element && e.target.closest('button, a, input, textarea, select, [contenteditable]')) return;
  e.preventDefault();
  doRoll();
});

els.resetBtn.addEventListener('click', () => {
  els.resetSummary.textContent = `${state.name}, ${state.rolls.toLocaleString('en-US')} rolls`;
  els.resetModal.returnValue = '';
  els.resetModal.showModal();
});
els.resetModal.addEventListener('close', () => {
  if (els.resetModal.returnValue !== 'confirm') return;
  cancelSettle();
  clear();
  state = null;
  lastFace = -1;
  els.character.hidden = true;
  els.shareBtn.hidden = true;
  els.hud.innerHTML = '';
  els.history.innerHTML = '';
  els.historyEmpty.hidden = false;
  els.resultLabel.textContent = 'Roll the die';
  els.resultValue.innerHTML = '&nbsp;';
  die.setValues([0, 0, 0, 0, 0, 0], -1);
  showLanding();
});

// ---------- share my die ----------
// Phones: the native share sheet with the image and a caption. Elsewhere (or if
// the browser refuses), a dialog with a preview, a download button and the caption.
let shareUrl = null;
let shareFile = null;
// Phones and tablets (no precise pointer) go straight to the native share sheet.
const TOUCH_FIRST = window.matchMedia('(pointer: coarse)').matches;
els.shareBtn.addEventListener('click', async () => {
  if (!state || state.rolls === 0 || die.rolling) return;
  completeSettle(); // show final values, not a face mid-transformation
  const card = drawShareCard({
    name: state.name,
    rolls: state.rolls,
    values: state.values,
    last: state.history.at(-1) ?? null,
    dieImage: die.snapshot(),
  });
  const text = shareText(state);
  let file;
  try {
    file = await cardToFile(card, shareFilename(state.name, state.rolls));
  } catch {
    return;
  }
  // Touch devices: straight to the native share sheet. Desktop: our dialog, since
  // people there mostly want to download or copy (the system sheet offers neither).
  if (TOUCH_FIRST) {
    const result = await nativeShare(file, text);
    if (result !== 'unsupported') return; // shared, or the player cancelled the sheet
  }
  if (shareUrl) URL.revokeObjectURL(shareUrl);
  shareUrl = URL.createObjectURL(file);
  shareFile = file;
  els.sharePreview.src = shareUrl;
  els.shareDownload.href = shareUrl;
  els.shareDownload.download = file.name;
  els.shareCaption.textContent = text;
  els.shareCopy.textContent = 'Copy text';
  els.shareNative.hidden = !(navigator.canShare && navigator.canShare({ files: [file] }));
  els.shareModal.showModal();
});
els.shareNative.addEventListener('click', () => {
  if (shareFile) nativeShare(shareFile, els.shareCaption.textContent);
});
els.shareCopy.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(els.shareCaption.textContent);
    els.shareCopy.textContent = 'Copied!';
  } catch {
    // Clipboard blocked: select the caption so it can be copied by hand.
    const range = document.createRange();
    range.selectNodeContents(els.shareCaption);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
});

// "How it works" — available from the landing screen and the header.
const infoModal = $('infoModal');
document.querySelectorAll('[data-info]').forEach((btn) =>
  btn.addEventListener('click', () => infoModal.showModal()));

// Redraw die faces once the web font is ready (canvas won't use it until loaded).
Promise.all([document.fonts?.load('700 64px Cinzel'), document.fonts?.load('64px Marcellus')]).then(() => die.redrawAll()).catch(() => {});

// ---------- boot ----------
const saved = load();
if (saved) start(saved.name, saved.rolls);
else showLanding();
