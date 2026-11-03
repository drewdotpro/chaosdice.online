import { FACES, MAX_ROLLS, opposite, replay, roll, valueColor } from './chaos.js';
import { Die } from './die.js';
import { Effects } from './effects.js';
import rollSoundUrl from './assets/dice-roll.mp3';
import changeSoundUrl from './assets/change-magic.mp3';

const STORAGE_KEY = 'chaos-dice:v1';
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
};

let state = null; // { name, seed, rolls, values, history }
let lastFace = -1;
const die = new Die(els.diceWrap);
const fx = new Effects();
if (import.meta.env.DEV) window.__chaos = { die, fx }; // handy for debugging
die.onImpact = (pt, strength) => fx.burst(pt.x, pt.y, Math.round(10 + 22 * strength), 0.5 + 0.6 * strength);

// ---------- sound ----------
const MUTE_KEY = 'chaos-dice:muted';
const sounds = {
  roll: new Audio(rollSoundUrl),
  change: new Audio(changeSoundUrl),
};
for (const a of Object.values(sounds)) a.preload = 'auto';
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
  if (muted) return;
  const a = sounds[name];
  a.currentTime = 0;
  a.play().catch(() => { /* autoplay blocked or unsupported; silent is fine */ });
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
  if (!state) return; // reset while rolling

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
const landing = $('landing');
function showLanding() {
  landing.hidden = false;
  document.body.classList.add('landing-mode');
  els.rollBtn.disabled = true;
}
function hideLanding() {
  landing.hidden = true;
  document.body.classList.remove('landing-mode');
}
$('playBtn').addEventListener('click', () => openStart());
$('startBack').addEventListener('click', () => els.startModal.close());

els.startForm.addEventListener('submit', (e) => {
  const name = els.nameInput.value.trim();
  const rollsRaw = els.rollsInput.value.trim();
  const rolls = rollsRaw === '' ? 0 : Number(rollsRaw);
  let err = '';
  if (!name) err = 'Your character needs a name.';
  else if (!Number.isInteger(rolls) || rolls < 0) err = 'Roll count must be a whole number, 0 or more.';
  else if (rolls > MAX_ROLLS) err = `Roll count can't exceed ${MAX_ROLLS.toLocaleString('en-US')}.`;
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
els.diceWrap.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); doRoll(); }
});
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || e.repeat) return;
  if (document.querySelector('dialog[open]')) return;
  if (e.target instanceof HTMLInputElement) return;
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
  els.hud.innerHTML = '';
  els.history.innerHTML = '';
  els.historyEmpty.hidden = false;
  els.resultLabel.textContent = 'Roll the die';
  els.resultValue.innerHTML = '&nbsp;';
  die.setValues([0, 0, 0, 0, 0, 0], -1);
  showLanding();
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
