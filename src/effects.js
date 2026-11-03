// Ambient page effects: drifting embers, occasional distant lightning, and
// spark bursts on demand. Drawn on one fixed canvas behind the UI.

const rand = (a, b) => a + Math.random() * (b - a);

export class Effects {
  constructor() {
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'fx';
    this.canvas.setAttribute('aria-hidden', 'true');
    document.body.prepend(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    this.embers = [];
    this.sparks = [];
    this.motes = [];
    this.bolts = [];
    this.flash = 0;
    this.nextBolt = performance.now() + rand(3000, 7000);
    this.last = performance.now();

    this.resize();
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => { this.last = performance.now(); });
    requestAnimationFrame((t) => this.frame(t));
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const target = Math.min(90, Math.round((this.w * this.h) / (this.reduced ? 40000 : 16000)));
    while (this.embers.length < target) this.embers.push(this.newEmber(true));
    this.embers.length = target;
  }

  newEmber(anywhere = false) {
    return {
      x: rand(0, this.w),
      y: anywhere ? rand(0, this.h) : this.h + rand(5, 40),
      vy: rand(12, 38) * (this.reduced ? 0.4 : 1),
      sway: rand(8, 26),
      freq: rand(0.4, 1.3),
      phase: rand(0, Math.PI * 2),
      r: rand(0.6, 2.1),
      hue: rand(22, 48),
      flick: rand(2, 7),
      life: 0,
    };
  }

  /** Burst of sparks at page coordinates (e.g. where the die hits the table). */
  burst(x, y, count = 24, power = 1) {
    if (this.reduced) count = Math.ceil(count / 3);
    for (let i = 0; i < count; i++) {
      const a = rand(Math.PI * 1.05, Math.PI * 1.95); // mostly upward fan
      const s = rand(120, 380) * power;
      this.sparks.push({
        x: x + rand(-14, 14), y,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 0, max: rand(0.35, 0.8),
        hue: rand(28, 52),
      });
    }
  }

  /** Arcane motes that swirl up and away from a point (violet and gold). */
  magic(x, y, count = 40) {
    if (this.reduced) count = Math.ceil(count / 4);
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(30, 130);
      this.motes.push({
        x: x + Math.cos(a) * rand(10, 50), y: y + Math.sin(a) * rand(5, 25),
        vx: Math.cos(a) * s, vy: -rand(40, 140),
        swirl: rand(2, 5) * (Math.random() < 0.5 ? -1 : 1),
        life: 0, max: rand(0.8, 1.6),
        r: rand(1, 2.8),
        hue: Math.random() < 0.6 ? rand(265, 290) : rand(38, 50),
      });
    }
  }

  /** Lightning bolt from the top of the screen. `near` = brighter, more branched. */
  strike(near = false) {
    if (this.reduced) return;
    const x0 = rand(this.w * 0.05, this.w * 0.95);
    const y1 = rand(this.h * 0.35, this.h * (near ? 0.85 : 0.6));
    const x1 = x0 + rand(-this.w * 0.15, this.w * 0.15);
    const main = jagged(x0, -10, x1, y1, near ? 7 : 6);
    const branches = [];
    const nb = near ? 4 : 2;
    for (let i = 0; i < nb; i++) {
      const p = main[Math.floor(rand(main.length * 0.2, main.length * 0.8))];
      const len = rand(60, 180);
      const a = rand(Math.PI * 0.25, Math.PI * 0.75) + (Math.random() < 0.5 ? -0.5 : 0.5);
      branches.push(jagged(p.x, p.y, p.x + Math.cos(a) * len, p.y + Math.sin(a) * len, 4));
    }
    this.bolts.push({ main, branches, life: 0, max: near ? 0.55 : 0.45, alpha: near ? 1 : 0.6 });
    this.flash = Math.max(this.flash, near ? 0.16 : 0.07);
  }

  frame(t) {
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;
    const { ctx, w, h } = this;
    ctx.clearRect(0, 0, w, h);

    if (!this.reduced && t > this.nextBolt) {
      this.strike(false);
      this.nextBolt = t + rand(7000, 16000);
    }

    // Sky flash
    if (this.flash > 0.001) {
      ctx.fillStyle = `rgba(170, 190, 255, ${this.flash})`;
      ctx.fillRect(0, 0, w, h);
      this.flash *= Math.pow(0.02, dt);
    }

    ctx.globalCompositeOperation = 'lighter';

    // Lightning
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.life += dt;
      const p = b.life / b.max;
      if (p >= 1) { this.bolts.splice(i, 1); continue; }
      // Flicker: a couple of re-strikes before fading.
      const flick = p < 0.15 || (p > 0.28 && p < 0.38) ? 1 : 0.35;
      const a = b.alpha * flick * (1 - p);
      drawBolt(ctx, b.main, a, 2.2);
      for (const br of b.branches) drawBolt(ctx, br, a * 0.6, 1.2);
    }

    // Embers
    for (const e of this.embers) {
      e.life += dt;
      e.y -= e.vy * dt;
      const x = e.x + Math.sin(e.life * e.freq + e.phase) * e.sway;
      if (e.y < -20) Object.assign(e, this.newEmber());
      const fadeTop = Math.min(1, e.y / (h * 0.35));
      const flicker = 0.55 + 0.45 * Math.sin(e.life * e.flick + e.phase);
      const a = Math.max(0, fadeTop) * flicker * 0.75;
      ctx.fillStyle = `hsla(${e.hue}, 100%, 60%, ${a * 0.18})`;
      ctx.beginPath();
      ctx.arc(x, e.y, e.r * 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `hsla(${e.hue}, 100%, 72%, ${a})`;
      ctx.beginPath();
      ctx.arc(x, e.y, e.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Sparks
    ctx.lineCap = 'round';
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life += dt;
      if (s.life >= s.max) { this.sparks.splice(i, 1); continue; }
      s.vy += 700 * dt; // gravity
      s.vx *= Math.pow(0.3, dt);
      const px = s.x, py = s.y;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      const a = 1 - s.life / s.max;
      ctx.strokeStyle = `hsla(${s.hue}, 100%, ${60 + a * 30}%, ${a})`;
      ctx.lineWidth = 1.6 * a + 0.4;
      ctx.beginPath();
      ctx.moveTo(px - (s.x - px) * 1.5, py - (s.y - py) * 1.5);
      ctx.lineTo(s.x, s.y);
      ctx.stroke();
    }

    // Magic motes
    for (let i = this.motes.length - 1; i >= 0; i--) {
      const m = this.motes[i];
      m.life += dt;
      if (m.life >= m.max) { this.motes.splice(i, 1); continue; }
      const q = m.life / m.max;
      // Swirl: rotate velocity a little each frame, slow down horizontally.
      const ang = m.swirl * dt;
      const vx = m.vx * Math.cos(ang) - m.vy * Math.sin(ang) * 0.3;
      m.vx = vx * Math.pow(0.4, dt);
      m.vy -= 20 * dt;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      const a = Math.sin(Math.PI * Math.min(1, q * 1.4)) * (1 - q) * 1.4;
      const tw = 0.6 + 0.4 * Math.sin(m.life * 25 + i);
      ctx.fillStyle = `hsla(${m.hue}, 100%, 70%, ${a * 0.2})`;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r * 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `hsla(${m.hue}, 100%, 88%, ${Math.min(1, a * tw)})`;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalCompositeOperation = 'source-over';
    requestAnimationFrame((tt) => this.frame(tt));
  }
}

/** Midpoint-displacement jagged line. */
function jagged(x0, y0, x1, y1, depth) {
  let pts = [{ x: x0, y: y0 }, { x: x1, y: y1 }];
  let spread = Math.hypot(x1 - x0, y1 - y0) * 0.22;
  for (let d = 0; d < depth; d++) {
    const next = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      next.push({ x: (a.x + b.x) / 2 + rand(-spread, spread), y: (a.y + b.y) / 2 + rand(-spread, spread) * 0.3 });
      next.push(b);
    }
    pts = next;
    spread *= 0.55;
  }
  return pts;
}

function drawBolt(ctx, pts, alpha, width) {
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  };
  ctx.lineJoin = 'round';
  // Outer glow, then hot core.
  ctx.strokeStyle = `rgba(120, 150, 255, ${alpha * 0.25})`;
  ctx.lineWidth = width * 6;
  path(); ctx.stroke();
  ctx.strokeStyle = `rgba(190, 210, 255, ${alpha * 0.6})`;
  ctx.lineWidth = width * 2.2;
  path(); ctx.stroke();
  ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
  ctx.lineWidth = width * 0.7;
  path(); ctx.stroke();
}
