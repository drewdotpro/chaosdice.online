import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { FACES, valueColor } from './chaos.js';

// Face placement on the cube. Each face is a plane whose local +Z is its
// outward normal and local +Y is "up" for its text. Opposites: A↔F, B↔E, C↔D.
const FACE_EULERS = [
  new THREE.Euler(0, 0, 0),             // A  front  (+z)
  new THREE.Euler(0, Math.PI / 2, 0),   // B  right  (+x)
  new THREE.Euler(-Math.PI / 2, 0, 0),  // C  top    (+y)
  new THREE.Euler(Math.PI / 2, 0, 0),   // D  bottom (-y)
  new THREE.Euler(0, -Math.PI / 2, 0),  // E  left   (-x)
  new THREE.Euler(0, Math.PI, 0),       // F  back   (-z)
];

const SIZE = 2;
const TEX = 512;
const TABLE_Y = -SIZE / 2;
// Lays a face's outward normal flat on the table (pointing up) with its text
// reading upright for a viewer sitting at the near (+z) side of the table.
const FACE_UP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

export class Die {
  constructor(container) {
    this.container = container;
    this.values = [0, 0, 0, 0, 0, 0];
    this.highlight = -1;
    this.rolling = false;
    this.onImpact = null; // (screenPoint {x,y}, strength 0..1) => void
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    // Seated at the table, looking down at the die.
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    this.camera.position.set(0, 7.4, 5.2);
    this.lookTarget = new THREE.Vector3(0, -0.35, 0);
    this.camera.lookAt(this.lookTarget);

    // Lighting: warm overhead lantern, cool fill.
    this.scene.add(new THREE.HemisphereLight(0xfff1d6, 0x2a1d3a, 1.0));
    const key = new THREE.DirectionalLight(0xffe2b0, 2.4);
    key.position.set(2.5, 8, 3);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = key.shadow.camera.bottom = -6;
    key.shadow.camera.right = key.shadow.camera.top = 6;
    key.shadow.bias = -0.0005;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x9fb4ff, 0.6);
    rim.position.set(-4, 3, -4);
    this.scene.add(rim);

    // The table: a felt dice mat that fades into the page.
    const mat = new THREE.Mesh(
      new THREE.PlaneGeometry(16, 16),
      new THREE.MeshStandardMaterial({ map: makeFeltTexture(), transparent: true, roughness: 1, metalness: 0 }),
    );
    mat.rotation.x = -Math.PI / 2;
    mat.position.y = TABLE_Y;
    mat.receiveShadow = true;
    this.scene.add(mat);

    // Die body: aged-bone rounded cube.
    this.die = new THREE.Group();
    const body = new THREE.Mesh(
      new RoundedBoxGeometry(SIZE, SIZE, SIZE, 6, 0.22),
      new THREE.MeshStandardMaterial({ color: 0xf1e6cf, roughness: 0.45, metalness: 0.0 }),
    );
    body.castShadow = true;
    this.die.add(body);

    this.faceCanvases = [];
    this.faceTextures = [];
    this.faceQuats = [];
    this.faceMats = [];
    const planeGeo = new THREE.PlaneGeometry(SIZE * 0.88, SIZE * 0.88);
    FACE_EULERS.forEach((euler) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = TEX;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      const m = new THREE.MeshStandardMaterial({
        map: tex, transparent: true, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -1,
        // Lets drawn marks glow from within during the transformation.
        emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0,
      });
      this.faceMats.push(m);
      const plane = new THREE.Mesh(planeGeo, m);
      const q = new THREE.Quaternion().setFromEuler(euler);
      plane.quaternion.copy(q);
      plane.position.set(0, 0, SIZE / 2 + 0.002).applyQuaternion(q);
      this.die.add(plane);
      this.faceCanvases.push(canvas);
      this.faceTextures.push(tex);
      this.faceQuats.push(q);
    });
    this.scene.add(this.die);

    // Violet arcane light that pulses over the die while a face transforms.
    this.arcLight = new THREE.PointLight(0xa070ff, 0, 0, 2);
    this.arcLight.position.set(0, 2.4, 0);
    this.scene.add(this.arcLight);

    // Resting before the first roll: face A up, slightly askew like a real die.
    this.die.quaternion.copy(this.targetFor(0, 0.12));

    this.redrawAll();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    new ResizeObserver(() => this.resize()).observe(container);

    this.now = () => performance.now() / 1000;
    this.anim = null;
    this.renderer.setAnimationLoop(() => this.tick());
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Widen the view on narrow (portrait) screens so the toss stays in frame.
    this.camera.fov = w / h < 1 ? 34 / Math.max(w / h, 0.55) * 0.95 : 34;
    this.camera.updateProjectionMatrix();
  }

  /** Orientation with face i on top, upright for the viewer, turned by `yaw`. */
  targetFor(i, yaw = 0) {
    return new THREE.Quaternion()
      .setFromAxisAngle(Y_AXIS, yaw)
      .multiply(FACE_UP)
      .multiply(this.faceQuats[i].clone().invert());
  }

  /** Lands with the current face on top (used when resuming). */
  showFace(i) {
    this.die.quaternion.copy(this.targetFor(i, (Math.random() - 0.5) * 0.2));
    this.die.position.set(0, 0, 0);
  }

  setValues(values, highlight = -1) {
    const m = this.morph;
    this.morph = null;
    if (m) {
      this.faceMats[m.face].emissiveIntensity = 0;
      this.arcLight.intensity = 0;
      m.resolve();
    }
    this.values = values.slice();
    this.highlight = highlight;
    this.redrawAll();
  }

  redrawAll() {
    for (let i = 0; i < 6; i++) this.drawFace(i);
  }

  /**
   * Magically transform face i from its shown value into `values[i]`.
   * Other faces update instantly (they're out of view). Resolves when done.
   */
  morphFace(i, values, highlight = i) {
    const from = this.values[i];
    this.finishMorph();
    this.values = values.slice();
    this.highlight = highlight;
    for (let f = 0; f < 6; f++) if (f !== i) this.drawFace(f);
    return new Promise((resolve) => {
      this.morph = {
        face: i, from, t0: this.now(), dur: this.reducedMotion ? 0.3 : 1.0, resolve,
        motes: Array.from({ length: 26 }, () => ({
          a: Math.random() * Math.PI * 2,
          r: 120 + Math.random() * 110,
          spin: (Math.random() < 0.5 ? -1 : 1) * (1.5 + Math.random() * 2.5),
          size: 3 + Math.random() * 6,
          delay: Math.random() * 0.35,
          gold: Math.random() < 0.45,
        })),
      };
      this.drawFace(i, 0);
    });
  }

  /** Jump any in-progress transformation to its end. */
  finishMorph() {
    if (!this.morph) return;
    const m = this.morph;
    this.morph = null;
    this.faceMats[m.face].emissiveIntensity = 0;
    this.arcLight.intensity = 0;
    this.drawFace(m.face);
    m.resolve();
  }

  /** Draw face i. With `morphP` (0..1) it renders a frame of the transformation. */
  drawFace(i, morphP = null) {
    const ctx = this.faceCanvases[i].getContext('2d');
    const S = TEX;
    const cx = S / 2;
    const cy = S / 2 + 20;
    ctx.clearRect(0, 0, S, S);

    // Engraved border
    ctx.strokeStyle = 'rgba(90, 60, 30, 0.35)';
    ctx.lineWidth = 6;
    roundRect(ctx, 18, 18, S - 36, S - 36, 48);
    ctx.stroke();

    if (i === this.highlight) {
      ctx.strokeStyle = 'rgba(200, 140, 30, 0.9)';
      ctx.lineWidth = 12;
      roundRect(ctx, 30, 30, S - 60, S - 60, 40);
      ctx.stroke();
    }

    // Face letter, top-left corner
    ctx.fillStyle = 'rgba(90, 60, 30, 0.75)';
    ctx.font = '700 64px Cinzel, Georgia, serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(FACES[i], 56, 52);

    if (morphP === null) {
      drawValue(ctx, this.values[i], cx, cy);
    } else {
      const m = this.morph;
      const p = morphP;
      const swell = Math.sin(Math.PI * p); // 0 → 1 → 0 over the transformation
      drawRuneCircle(ctx, cx, cy - 20, p, swell);
      // Old value glows, swells and dissolves away…
      const out = 1 - smooth(0.05, 0.5, p);
      if (out > 0) drawValue(ctx, m.from, cx, cy, { alpha: out, scale: 1 + (1 - out) * 0.35, glow: 1 - out * 0.4 });
      // …and the new one condenses out of the light.
      const inn = smooth(0.42, 0.85, p);
      if (inn > 0) drawValue(ctx, this.values[i], cx, cy, { alpha: inn, scale: 1.4 - inn * 0.4, glow: 1 - smooth(0.7, 1, p) });
      drawMotes(ctx, m.motes, cx, cy - 20, p);
      // Flash of light at the moment of change.
      const flash = Math.max(0, 1 - Math.abs(p - 0.47) / 0.12);
      if (flash > 0) {
        const g = ctx.createRadialGradient(cx, cy - 20, 0, cx, cy - 20, S * 0.45);
        g.addColorStop(0, `rgba(255, 245, 255, ${0.9 * flash})`);
        g.addColorStop(0.4, `rgba(190, 140, 255, ${0.5 * flash})`);
        g.addColorStop(1, 'rgba(190, 140, 255, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, S, S);
      }
    }

    this.faceTextures[i].needsUpdate = true;
  }

  /** Page coordinates of a point on the die (default: where it meets the table). */
  screenPoint(yOffset = TABLE_Y) {
    const p = this.die.position.clone();
    p.y += yOffset;
    p.project(this.camera);
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
  }

  /** Toss the die across the table so it settles with face i on top. */
  roll(faceIndex) {
    return new Promise((resolve) => {
      const target = this.targetFor(faceIndex, (Math.random() - 0.5) * 0.24);
      const startQ = this.die.quaternion.clone();
      // delta * target = start  →  spin around delta's axis, adding full turns.
      const delta = startQ.clone().multiply(target.clone().invert()).normalize();
      if (delta.w < 0) { delta.x *= -1; delta.y *= -1; delta.z *= -1; delta.w *= -1; }
      let angle = 2 * Math.acos(Math.min(1, delta.w));
      let axis = new THREE.Vector3(delta.x, delta.y, delta.z);
      if (axis.lengthSq() < 1e-8) {
        axis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
        angle = 0;
      }
      axis.normalize();
      const turns = this.reducedMotion ? 0 : 2 + Math.floor(Math.random() * 2);
      // Thrown in from the far side of the table, drifting to the centre.
      const side = Math.random() < 0.5 ? -1 : 1;
      const from = this.reducedMotion
        ? new THREE.Vector3()
        : new THREE.Vector3(side * (0.6 + Math.random() * 0.9), 0, -(0.8 + Math.random() * 0.8));
      this.anim = {
        t0: this.now(),
        dur: this.reducedMotion ? 0.35 : 1.35,
        axis, total: angle + turns * Math.PI * 2, target, resolve, from,
        bounce: -1,
        wobbleAxis: new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize(),
      };
      this.rolling = true;
    });
  }

  tick() {
    const t = this.now();
    if (this.anim) {
      const a = this.anim;
      const p = Math.min(1, (t - a.t0) / a.dur);
      const e = 1 - Math.pow(1 - p, 3); // ease-out cubic
      const spin = new THREE.Quaternion().setFromAxisAngle(a.axis, a.total * (1 - e));
      // A little rocking as it settles.
      const wob = new THREE.Quaternion().setFromAxisAngle(
        a.wobbleAxis, Math.sin(p * Math.PI * 4) * 0.18 * Math.pow(1 - p, 2),
      );
      this.die.quaternion.copy(wob).multiply(spin).multiply(a.target);

      // Bounces that shrink, while sliding toward the centre of the mat.
      const BOUNCES = 3;
      const phase = p * BOUNCES;
      const k = Math.floor(phase);
      const hop = this.reducedMotion || k >= BOUNCES ? 0
        : Math.sin((phase - k) * Math.PI) * 1.5 * Math.pow(0.42, k) * (1 - p * 0.3);
      const slide = 1 - Math.pow(1 - p, 2);
      this.die.position.set(a.from.x * (1 - slide), Math.max(0, hop), a.from.z * (1 - slide));

      // Each time it strikes the table, let listeners throw sparks.
      if (k !== a.bounce && k > 0 && k <= BOUNCES && !this.reducedMotion) {
        a.bounce = k;
        this.onImpact?.(this.screenPoint(), Math.pow(0.55, k - 1));
      }

      if (p >= 1) {
        this.die.quaternion.copy(a.target);
        this.die.position.set(0, 0, 0);
        this.anim = null;
        this.rolling = false;
        a.resolve();
      }
    }
    if (this.morph) {
      const m = this.morph;
      const p = Math.min(1, (t - m.t0) / m.dur);
      if (p >= 1) this.finishMorph();
      else {
        this.drawFace(m.face, p);
        const swell = Math.sin(Math.PI * p);
        const flash = Math.max(0, 1 - Math.abs(p - 0.47) / 0.15);
        this.faceMats[m.face].emissiveIntensity = 0.25 * swell + 0.5 * flash;
        this.arcLight.intensity = 18 * swell + 30 * flash;
      }
    }
    this.renderer.render(this.scene, this.camera);
  }
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Draw a value centred on the face, shrunk to fit. Optional magical glow. */
function drawValue(ctx, v, cx, cy, { alpha = 1, scale = 1, glow = 0 } = {}) {
  const S = TEX;
  const text = formatValue(v);
  const maxW = S * 0.78;
  const maxH = S * 0.5;
  let size = 280;
  ctx.font = `400 ${size}px Marcellus, Georgia, serif`;
  const w = ctx.measureText(text).width;
  if (w > maxW) size = Math.floor(size * (maxW / w));
  size = Math.min(size, maxH / 0.75);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.font = `400 ${size}px Marcellus, Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (glow > 0) {
    ctx.shadowColor = `rgba(170, 100, 255, ${glow})`;
    ctx.shadowBlur = 50 * glow;
    ctx.fillStyle = `rgba(200, 160, 255, ${0.6 * glow})`;
    ctx.fillText(text, 0, 0);
    ctx.shadowBlur = 0;
  } else {
    // Carved look: light highlight below, colour on top.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.fillText(text, 2, 4);
  }
  ctx.fillStyle = valueColor(v);
  ctx.fillText(text, 0, 0);

  // Disambiguate 6/9-style numbers when seen rotated.
  const digits = String(Math.abs(v));
  if (/^[01689]+$/.test(digits) && /[69]/.test(digits)) {
    ctx.fillRect(-size * 0.25, size * 0.42, size * 0.5, Math.max(4, size * 0.04));
  }
  ctx.restore();
}

/** Spinning arcane circle with rune ticks, fading in and out. */
function drawRuneCircle(ctx, cx, cy, p, a) {
  if (a <= 0.01) return;
  const R = TEX * 0.36;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.globalAlpha = a;
  ctx.shadowColor = 'rgba(160, 90, 255, 0.9)';
  ctx.shadowBlur = 24;
  ctx.strokeStyle = 'rgba(130, 70, 230, 1)';
  ctx.lineWidth = 7;
  ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(0, 0, R * 0.84, 0, Math.PI * 2); ctx.stroke();
  // Rune ticks between the rings, rotating.
  ctx.rotate(p * Math.PI * 1.5);
  ctx.lineWidth = 5;
  for (let k = 0; k < 12; k++) {
    ctx.rotate(Math.PI / 6);
    ctx.beginPath();
    if (k % 3 === 0) {
      ctx.moveTo(R * 0.87, -8); ctx.lineTo(R * 0.97, 0); ctx.lineTo(R * 0.87, 8);
    } else {
      ctx.moveTo(R * 0.86, 0); ctx.lineTo(R * 0.98, 0);
    }
    ctx.stroke();
  }
  // Inner counter-rotating triangle.
  ctx.rotate(-p * Math.PI * 3);
  ctx.strokeStyle = 'rgba(210, 150, 40, 0.95)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  for (let k = 0; k < 3; k++) {
    const ang = -Math.PI / 2 + (k * 2 * Math.PI) / 3;
    const x = Math.cos(ang) * R * 0.8;
    const y = Math.sin(ang) * R * 0.8;
    if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

/** Sparkling motes that spiral inward toward the number. */
function drawMotes(ctx, motes, cx, cy, p) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const m of motes) {
    const q = Math.min(1, Math.max(0, (p - m.delay) / (1 - m.delay)));
    if (q <= 0 || q >= 1) continue;
    const r = m.r * (1 - q * 0.85);
    const ang = m.a + m.spin * q;
    const x = cx + Math.cos(ang) * r;
    const y = cy + Math.sin(ang) * r;
    const a = Math.sin(Math.PI * q);
    const size = m.size * (0.6 + 0.4 * a);
    const col = m.gold ? '255, 210, 120' : '200, 160, 255';
    const g = ctx.createRadialGradient(x, y, 0, x, y, size * 3);
    g.addColorStop(0, `rgba(255, 255, 255, ${a})`);
    g.addColorStop(0.3, `rgba(${col}, ${a * 0.8})`);
    g.addColorStop(1, `rgba(${col}, 0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, size * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Soft-edged felt mat texture (deep crimson, with fibre noise and a stitched ring). */
function makeFeltTexture() {
  const S = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');

  // Gradient radius S/2 spans 8 world units: solid felt to ~3.2u, gone by ~4.6u.
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(100, 24, 30, 1)');
  g.addColorStop(0.3, 'rgba(80, 18, 24, 1)');
  g.addColorStop(0.42, 'rgba(52, 14, 16, 0.75)');
  g.addColorStop(0.56, 'rgba(30, 14, 10, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);

  // Felt fibres
  const img = ctx.getImageData(0, 0, S, S);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 22;
    d[i] = Math.max(0, d[i] + n);
    d[i + 1] = Math.max(0, d[i + 1] + n * 0.5);
    d[i + 2] = Math.max(0, d[i + 2] + n * 0.5);
  }
  ctx.putImageData(img, 0, 0);

  // Gold stitched ring
  ctx.strokeStyle = 'rgba(200, 144, 42, 0.45)';
  ctx.lineWidth = 4;
  ctx.setLineDash([14, 12]);
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S * 0.19, 0, Math.PI * 2);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function formatValue(v) {
  return v < 0 ? `−${Math.abs(v).toLocaleString('en-US')}` : v.toLocaleString('en-US');
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
