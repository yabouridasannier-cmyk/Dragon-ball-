// shenron.js — introduction cinématique : Shenron surgit d'un ciel d'orage.
// Tout est dessiné et synthétisé par le code (aucune image ni aucun son de la série).
// frame(t) ne dépend que du temps t : on peut donc rendre n'importe quel instant (tests, saut).

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const easeOut = (t) => 1 - (1 - clamp(t, 0, 1)) ** 3;
const TAU = Math.PI * 2;

// Scénario (secondes, pour une intro de 5 s ; les durées plus courtes l'accélèrent proportionnellement)
export const SHN = {
  D: 5,
  bolts: [ // éclairs : instant, position horizontale (0-1), puissance. Jamais plus de 3 éclats par seconde.
    { t: 0.35, x: 0.28, size: 0.6 }, { t: 1.25, x: 0.72, size: 0.8 }, { t: 2.3, x: 0.45, size: 0.7 },
    { t: 2.8, x: 0.2, size: 0.8 }, { t: 3.35, x: 0.82, size: 0.9 }, { t: 3.9, x: 0.5, size: 0.9 },
    { t: 4.35, x: 0.6, size: 1.3, final: true },
  ],
  rise: [0.5, 2.5],      // le dragon monte
  eyes: [1.9, 2.4],      // les yeux s'allument
  growl: [1.45, 2.45],   // grognement grave
  roar: [2.7, 4.2],      // rugissement
  dissolve: [4.35, 4.95], // il se disperse en étincelles
  caps: [[0.75, 2.45, 'SHENRON S’ÉVEILLE…'], [2.85, 4.25, 'TON SOUHAIT VA ÊTRE EXAUCÉ…']],
};

const N = 110; // maillons du corps
const C = {
  dark: [10, 62, 44], mid: [30, 150, 98], light: [118, 232, 168], belly: [236, 222, 140],
  spikeA: [255, 150, 60], spikeB: [196, 38, 28], horn1: [240, 226, 168], horn2: [150, 108, 58],
};
const mixc = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const rgba = (c, k = 1, a = 1) => `rgba(${Math.min(255, c[0] * k) | 0},${Math.min(255, c[1] * k) | 0},${Math.min(255, c[2] * k) | 0},${a})`;

function mulberry(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function createShenron(canvas) {
  const g = canvas.getContext('2d');
  let W = 1, H = 1, dpr = 1, k = 1, calm = false, clouds = null, vig = null, sparks = [], rain = [];
  const pts = Array.from({ length: N }, () => ({ x: 0, y: 0, th: 0, r: 0 }));
  const sizeBase = () => Math.min(H, W * 1.6);

  function resize() {
    dpr = Math.min(1.25, devicePixelRatio || 1); W = innerWidth; H = innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const rng = mulberry(7);
    clouds = document.createElement('canvas'); clouds.width = 1024; clouds.height = 420;
    const c = clouds.getContext('2d');
    for (let i = 0; i < 40; i++) {
      const r = 60 + rng() * 80, x = rng() * 1024, y = r + rng() * (420 - 2 * r);
      for (const dx of [-1024, 0, 1024]) { // copies décalées : le motif se répète sans couture
        const gr = c.createRadialGradient(x + dx, y, 0, x + dx, y, r);
        gr.addColorStop(0, 'rgba(64,84,128,.30)'); gr.addColorStop(1, 'rgba(64,84,128,0)'); c.fillStyle = gr; c.fillRect(x + dx - r, y - r, 2 * r, 2 * r);
      }
    }
    c.globalCompositeOperation = 'destination-in'; // fondu vertical : pas de bord net en haut ni en bas
    const fade = c.createLinearGradient(0, 0, 0, 420); fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(0.3, 'rgba(0,0,0,1)'); fade.addColorStop(0.7, 'rgba(0,0,0,1)'); fade.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = fade; c.fillRect(0, 0, 1024, 420);
    vig = g.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.3, W / 2, H * 0.45, Math.max(W, H) * 0.75);
    vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(0,0,0,.72)');
    rain = Array.from({ length: Math.round(W < 720 ? 70 : 130) }, () => ({ x: rng(), y: rng(), v: 0.9 + rng() * 1.1, l: 0.03 + rng() * 0.05, a: 0.07 + rng() * 0.14 }));
  }

  // ── Corps : une colonne vertébrale qui ondule, ancrée à la tête ───────────────────────────────
  function buildSpine(tt) {
    const base = sizeBase(), R = 0.07 * base;
    const rise = easeOut((tt - SHN.rise[0]) / (SHN.rise[1] - SHN.rise[0]));
    const hx = Math.min(W * 0.6, W * 0.95 - 3.9 * R) + Math.sin(tt * 1.1) * base * 0.012; // museau (≈1,95 h) toujours visible
    const hy = lerp(H + base * 0.34, H * 0.31, rise) + Math.sin(tt * 1.7) * base * 0.012 * rise;
    const amp = (lerp(1.3, 0.9, rise) + 0.06 * Math.sin(tt * 2)) * (calm ? 0.6 : 1);
    const seg = (2.7 * base) / (N - 1);
    let x = hx, y = hy;
    for (let i = 0; i < N; i++) {
      const s = i / (N - 1);
      const neck = 1 - smooth(s / 0.1);
      const wave = amp * (0.35 + 0.65 * smooth(s / 0.35)) * Math.sin(s * 15 - tt * (calm ? 1.4 : 2.6));
      const th = lerp(Math.PI / 2 + wave, Math.PI - 0.55 + 0.12 * Math.sin(tt * 1.5), neck);
      const p = pts[i]; p.x = x; p.y = y; p.th = th;
      p.r = R * (0.22 + 0.78 * (1 - s) ** 0.8) * (i < 4 ? 0.78 + 0.055 * i : 1);
      x += Math.cos(th) * seg; y += Math.sin(th) * seg;
    }
    return { R, h: R * 2.0, seg };
  }

  function flashAt(tt) { // éclat de lumière, une seule impulsion par éclair (jamais de stroboscope)
    let f = 0;
    for (const b of SHN.bolts) {
      const a = tt - b.t; if (a < 0) continue;
      const peak = calm ? 0.1 : b.final ? 0.95 : Math.min(0.55, b.size * 0.52);
      f = Math.max(f, peak * clamp(a / 0.03, 0, 1) * Math.exp(-a / (b.final ? 0.32 : 0.1)));
    }
    return f;
  }

  function bolt(x0, y1, seed, spread) {
    const rng = mulberry(seed), out = [], main = [];
    const n = 16;
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      main.push([lerp(x0, x0 + (rng() - 0.5) * W * 0.18, u) + (i && i < n ? (rng() - 0.5) * spread : 0), u * y1]);
    }
    out.push({ p: main, w: 1 });
    for (let b = 0; b < 3; b++) {
      const s = 3 + Math.floor(rng() * (n - 6)), br = [main[s].slice()], dir = rng() < 0.5 ? -1 : 1;
      for (let i = 1; i < 6; i++) br.push([br[i - 1][0] + dir * (10 + rng() * 26), br[i - 1][1] + 14 + rng() * 26]);
      out.push({ p: br, w: 0.45 });
    }
    return out;
  }
  function drawBolts(tt) {
    for (let bi = 0; bi < SHN.bolts.length; bi++) {
      const b = SHN.bolts[bi], a = tt - b.t;
      if (a < 0 || a > 0.3) continue;
      const frame = Math.min(2, Math.floor(a / 0.07)), life = 1 - a / 0.3;
      const segs = bolt(b.x * W, H * (b.final ? 0.62 : 0.34 + 0.2 * b.size), bi * 31 + frame * 7 + 3, W * 0.05);
      g.lineJoin = 'round'; g.lineCap = 'round';
      for (const [lw, col, al] of [[9, '120,170,255', 0.22], [4, '190,220,255', 0.55], [1.8, '255,255,255', 1]]) {
        g.strokeStyle = `rgba(${col},${(al * life * (calm ? 0.35 : 1)).toFixed(3)})`;
        for (const s of segs) { g.lineWidth = lw * s.w * (b.final ? 1.5 : 1); g.beginPath(); s.p.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); }
      }
    }
  }

  function drawSky(tt, fl) {
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, rgba([4, 7, 20], 1 + fl * 5)); gr.addColorStop(0.55, rgba([7, 14, 34], 1 + fl * 4)); gr.addColorStop(1, rgba([2, 5, 12], 1 + fl * 3));
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    const ch = H * 0.95, cw = ch * (1024 / 420) * 0.8;
    for (let layer = 0; layer < 3; layer++) {
      const sp = (layer + 1) * 14 + 8, off = ((tt * sp) % cw + cw) % cw, y = -H * 0.12 + layer * H * 0.1;
      g.globalAlpha = 0.34 + layer * 0.14;
      for (let x = -off; x < W; x += cw) g.drawImage(clouds, x, y, cw, ch);
      if (fl > 0.02) { g.globalCompositeOperation = 'lighter'; g.globalAlpha = Math.min(1, fl * 1.1); for (let x = -off; x < W; x += cw) g.drawImage(clouds, x, y, cw, ch); g.globalCompositeOperation = 'source-over'; }
    }
    g.globalAlpha = 1;
    g.strokeStyle = 'rgba(165,190,235,1)'; g.lineWidth = 1;
    for (const d of rain) {
      const yy = ((d.y + tt * d.v * 0.9) % 1) * (H + 60) - 30, xx = ((d.x - tt * 0.05) % 1 + 1) % 1 * W;
      g.globalAlpha = d.a * (1 + fl); g.beginPath(); g.moveTo(xx, yy); g.lineTo(xx - d.l * H * 0.18, yy + d.l * H); g.stroke();
    }
    g.globalAlpha = 1;
  }

  // ── Dragon ──────────────────────────────────────────────────────────────────────────────────
  function drawBody(light, spineInfo) {
    const { seg } = spineInfo;
    for (let i = N - 1; i >= 0; i--) {
      const p = pts[i], r = p.r;
      if (p.y - r * 2 > H || p.y + r * 2 < 0 || p.x + r * 2 < 0 || p.x - r * 2 > W) continue;
      const nx = Math.sin(p.th), ny = -Math.cos(p.th); // normale « gauche » du sens tête → queue
      const kk = 0.3 + 0.7 * light;
      if (i > 3 && i < N * 0.9 && i % 3 === 0) { // pointes dorsales
        const bx = p.x - nx * r * 0.8, by = p.y - ny * r * 0.8, ax = bx - nx * r * 0.95 + Math.cos(p.th) * seg * 1.6, ay = by - ny * r * 0.95 + Math.sin(p.th) * seg * 1.6;
        const sg = g.createLinearGradient(bx, by, ax, ay); sg.addColorStop(0, rgba(C.spikeB, kk)); sg.addColorStop(1, rgba(C.spikeA, kk));
        g.fillStyle = sg; g.beginPath(); g.moveTo(bx - Math.cos(p.th) * seg * 1.1, by - Math.sin(p.th) * seg * 1.1); g.lineTo(ax, ay); g.lineTo(bx + Math.cos(p.th) * seg * 1.1, by + Math.sin(p.th) * seg * 1.1); g.closePath(); g.fill();
      }
      const gr = g.createRadialGradient(p.x, p.y - r * 0.38, r * 0.08, p.x, p.y, r);
      gr.addColorStop(0, rgba(C.light, kk)); gr.addColorStop(0.5, rgba(C.mid, kk)); gr.addColorStop(1, rgba(C.dark, kk * 0.8));
      g.fillStyle = gr; g.beginPath(); g.arc(p.x, p.y, r, 0, TAU); g.fill();
      g.strokeStyle = `rgba(0,20,10,${0.16 + 0.14 * (1 - light)})`; g.lineWidth = Math.max(1, r * 0.05); g.stroke();
      g.fillStyle = rgba(C.belly, kk * 0.95, 0.9); // ventre jaune, en écailles
      g.beginPath(); g.ellipse(p.x + nx * r * 0.58, p.y + ny * r * 0.58, r * 0.34, r * 0.72, p.th, 0, TAU); g.fill();
    }
  }

  function drawHead(x, y, phi, h, jaw, glow, light, tt) {
    g.save(); g.translate(x, y); g.rotate(phi); g.scale(h, h);
    const kk = 0.3 + 0.7 * light, lw = 0.035;
    const path = (arr) => { g.beginPath(); g.moveTo(arr[0][0], arr[0][1]); for (let i = 1; i < arr.length; i += 1) { const a = arr[i]; if (a.length === 2) g.lineTo(a[0], a[1]); else g.bezierCurveTo(a[0], a[1], a[2], a[3], a[4], a[5]); } g.closePath(); };
    // cornes (derrière)
    for (const [d, col, dy] of [[1, C.horn2, 0.12], [0, C.horn1, 0]]) {
      const hg = g.createLinearGradient(-0.2, -0.5, -1.6, -1.2); hg.addColorStop(0, rgba(col, kk)); hg.addColorStop(1, rgba(mixc(col, [60, 40, 20], 0.7), kk));
      g.fillStyle = hg;
      path(d ? [[-0.38, -0.46 + dy], [-0.72, -0.8, -1.12, -0.95, -1.55, -0.82], [-1.1, -0.72, -0.82, -0.58, -0.56, -0.32]]
        : [[-0.12, -0.6], [-0.55, -1.05, -1.0, -1.32, -1.65, -1.16], [-1.1, -1.02, -0.78, -0.8, -0.46, -0.44]]);
      g.fill();
    }
    // collerette rouge derrière le crâne
    for (let i = 0; i < 6; i++) {
      const a = 0.2 + i * 0.34, sw = Math.sin(tt * 3 + i) * 0.06, len = 0.95 - i * 0.07;
      const fg = g.createLinearGradient(-0.4, 0, -0.4 - len, 0.35 * i); fg.addColorStop(0, rgba(C.spikeB, kk)); fg.addColorStop(1, rgba(C.spikeA, kk));
      g.fillStyle = fg; g.beginPath(); g.moveTo(-0.35, -0.1 + i * 0.1); g.lineTo(-0.4 - len, -0.05 + i * 0.15 + sw); g.lineTo(-0.28, 0.12 + i * 0.1); g.closePath(); g.fill();
    }
    // moustaches
    g.strokeStyle = rgba([190, 236, 150], kk, 0.85); g.lineWidth = 0.05; g.lineCap = 'round';
    for (let j = 0; j < 2; j++) {
      const sx = 1.42 + j * 0.1, sy = -0.02 + j * 0.06, sw = Math.sin(tt * 2.4 + j * 1.7);
      g.beginPath(); g.moveTo(sx, sy); g.bezierCurveTo(sx - 0.7, sy + 0.55 + sw * 0.18, sx - 1.5 - sw * 0.2, sy + 0.4, sx - 2.5, sy + 1.05 + sw * 0.3 + j * 0.35); g.stroke();
    }
    // intérieur de la gueule (lueur), entre la mâchoire du haut et celle du bas
    if (jaw > 0.04) {
      const ca = Math.cos(jaw), sa = Math.sin(jaw), lx = 1.55 * ca - 0.02 * sa, ly = 0.14 + 1.55 * sa + 0.02 * ca;
      const mg = g.createRadialGradient(1.0, 0.3, 0.05, 1.0, 0.3, 1.3);
      mg.addColorStop(0, `rgba(255,${200 + glow * 40 | 0},90,${0.7 + 0.3 * glow})`); mg.addColorStop(0.6, 'rgba(230,70,10,.92)'); mg.addColorStop(1, 'rgba(90,6,0,.95)');
      g.fillStyle = mg; g.beginPath(); g.moveTo(0.0, 0.1); g.lineTo(1.78, 0.06); g.lineTo(lx, ly); g.lineTo(0.0, 0.3); g.closePath(); g.fill();
    }
    // mâchoire inférieure (pivote)
    g.save(); g.translate(0.0, 0.14); g.rotate(jaw); g.translate(0, -0.14);
    const jg = g.createLinearGradient(0, 0.1, 0, 0.55); jg.addColorStop(0, rgba(C.mid, kk)); jg.addColorStop(1, rgba(mixc(C.belly, C.mid, 0.35), kk));
    g.fillStyle = jg;
    path([[0.0, 0.14], [1.55, 0.16], [1.7, 0.2, 1.64, 0.36, 1.4, 0.4], [0.25, 0.5], [0.05, 0.52, -0.25, 0.42, -0.3, 0.28]]); g.fill();
    g.strokeStyle = 'rgba(0,20,10,.5)'; g.lineWidth = lw; g.stroke();
    g.fillStyle = 'rgba(255,248,226,.95)'; // dents du bas
    for (let i = 0; i < 6; i++) { const tx = 0.35 + i * 0.22; g.beginPath(); g.moveTo(tx, 0.16); g.lineTo(tx + 0.07, 0.03); g.lineTo(tx + 0.14, 0.16); g.fill(); }
    g.restore();
    // crâne et museau
    const sg = g.createLinearGradient(0, -0.7, 0, 0.2); sg.addColorStop(0, rgba(C.dark, kk)); sg.addColorStop(0.45, rgba(C.mid, kk)); sg.addColorStop(1, rgba(C.light, kk * 0.9));
    g.fillStyle = sg;
    path([[-0.55, -0.05], [-0.5, -0.62, 0.15, -0.78, 0.7, -0.5], [1.1, -0.4, 1.55, -0.38, 1.8, -0.22], [1.95, -0.14, 1.95, 0.02, 1.78, 0.07], [0.35, 0.12], [0.0, 0.15, -0.4, 0.22, -0.55, 0.12]]);
    g.fill(); g.strokeStyle = 'rgba(0,20,10,.55)'; g.lineWidth = lw; g.stroke();
    g.fillStyle = 'rgba(255,248,226,.97)'; // dents du haut (crocs)
    for (let i = 0; i < 6; i++) { const tx = 0.4 + i * 0.23, hh = i % 3 === 0 ? 0.2 : 0.12; g.beginPath(); g.moveTo(tx, 0.12); g.lineTo(tx + 0.07, 0.12 + hh); g.lineTo(tx + 0.14, 0.11); g.fill(); }
    g.fillStyle = 'rgba(0,15,8,.9)'; g.beginPath(); g.ellipse(1.72, -0.12, 0.05, 0.03, -0.3, 0, TAU); g.fill(); // narine
    // arcade sourcilière et œil
    g.fillStyle = rgba(C.dark, kk * 0.9); g.beginPath(); g.moveTo(0.08, -0.44); g.quadraticCurveTo(0.5, -0.66, 0.98, -0.4); g.lineTo(0.7, -0.3); g.quadraticCurveTo(0.45, -0.38, 0.08, -0.3); g.closePath(); g.fill();
    g.restore();
  }
  function drawEye(x, y, phi, h, ig) {
    // œil rouge incandescent, dessiné en repère écran pour que la lueur reste ronde
    const c = Math.cos(phi), s = Math.sin(phi), ex = x + (0.42 * c + 0.3 * s) * h, ey = y + (0.42 * s - 0.3 * c) * h;
    if (ig <= 0) return;
    g.save(); g.globalCompositeOperation = 'lighter';
    const gr = g.createRadialGradient(ex, ey, 0, ex, ey, h * 0.95 * ig); gr.addColorStop(0, `rgba(255,120,40,${0.8 * ig})`); gr.addColorStop(0.3, `rgba(255,50,20,${0.38 * ig})`); gr.addColorStop(1, 'rgba(255,30,0,0)');
    g.fillStyle = gr; g.fillRect(ex - h, ey - h, 2 * h, 2 * h); g.restore();
    g.save(); g.translate(ex, ey); g.rotate(phi - 0.32);
    g.fillStyle = `rgba(255,${200 - 90 * (1 - ig) | 0},${90 * ig | 0},1)`; g.beginPath(); g.ellipse(0, 0, h * 0.2, h * 0.095 * (0.4 + 0.6 * ig), 0, 0, TAU); g.fill();
    g.fillStyle = '#2a0300'; g.beginPath(); g.ellipse(h * 0.02, 0, h * 0.028, h * 0.085 * (0.4 + 0.6 * ig), 0, 0, TAU); g.fill();
    g.restore();
  }

  function begin(opts = {}) {
    k = opts.k || 1; calm = !!opts.calm; resize();
    // étincelles dorées : naissent le long du corps quand Shenron se disperse
    const rng = mulberry(99); sparks = [];
    for (let i = 0; i < (calm ? 30 : 90); i++) {
      const tb = lerp(SHN.dissolve[0], SHN.dissolve[1] - 0.15, rng());
      buildSpine(tb); const p = pts[Math.floor(rng() * 40)];
      sparks.push({ tb, x: p.x + (rng() - 0.5) * p.r * 1.6, y: p.y + (rng() - 0.5) * p.r * 1.6, vx: (rng() - 0.5) * 120, vy: -(60 + rng() * 260), r: 1.2 + rng() * 2.4 });
    }
  }

  // t : secondes écoulées dans l'intro réelle. Retourne la position de la tête (pour caler les effets).
  function frame(t) {
    const tt = t / k;
    const fl = flashAt(tt);
    const rise = easeOut((tt - SHN.rise[0]) / (SHN.rise[1] - SHN.rise[0]));
    const roarU = smooth((tt - SHN.roar[0]) / 0.25) * (1 - smooth((tt - (SHN.roar[1] - 0.25)) / 0.25));
    const growlU = smooth((tt - SHN.growl[0]) / 0.2) * (1 - smooth((tt - (SHN.growl[1] - 0.25)) / 0.25));
    const dis = smooth((tt - SHN.dissolve[0]) / (SHN.dissolve[1] - SHN.dissolve[0]));
    const eyes = smooth((tt - SHN.eyes[0]) / (SHN.eyes[1] - SHN.eyes[0])) * (1 - dis);
    const tremor = roarU * (calm ? 0 : 1);
    g.save();
    if (!calm) { const sh = tremor * 6 + (fl > 0.8 ? 5 : 0); if (sh) g.translate((Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh); }
    drawSky(tt, fl);
    // le dragon reste dans l'ombre tant qu'un éclair ne l'éclaire pas
    const light = clamp(0.1 + fl * 1.2 + roarU * 0.25 + growlU * 0.1 + 0.12 * rise * (1 - dis), 0, 1);
    const info = buildSpine(tt);
    g.globalAlpha = 1 - dis;
    drawBody(light, info);
    const jaw = (0.12 * growlU + 0.78 * roarU) * (1 + (tremor ? 0.1 * Math.sin(tt * 55) : 0));
    const phi = pts[0].th - Math.PI + 0.42 - 0.3 * roarU - 0.06 * Math.sin(tt * 1.9) + (tremor ? 0.025 * Math.sin(tt * 47) : 0);
    drawHead(pts[0].x, pts[0].y, phi, info.h, jaw, roarU, light, tt);
    g.globalAlpha = 1;
    drawEye(pts[0].x, pts[0].y, phi, info.h, eyes);
    drawBolts(tt);
    // éclat de la gueule pendant le rugissement
    if (roarU > 0.02) {
      const c = Math.cos(phi), s = Math.sin(phi), mx = pts[0].x + (1.1 * c - 0.2 * s) * info.h, my = pts[0].y + (1.1 * s + 0.2 * c) * info.h;
      g.save(); g.globalCompositeOperation = 'lighter';
      const mg = g.createRadialGradient(mx, my, 0, mx, my, info.h * 2.2); mg.addColorStop(0, `rgba(255,170,60,${0.45 * roarU})`); mg.addColorStop(1, 'rgba(255,90,0,0)');
      g.fillStyle = mg; g.fillRect(mx - info.h * 2.2, my - info.h * 2.2, info.h * 4.4, info.h * 4.4); g.restore();
    }
    // étincelles
    if (tt >= SHN.dissolve[0]) {
      g.save(); g.globalCompositeOperation = 'lighter';
      for (const p of sparks) {
        const a = tt - p.tb; if (a < 0 || a > 0.9) continue;
        const u = a * k; g.fillStyle = `rgba(255,${200 + 40 * (1 - a) | 0},90,${(1 - a / 0.9).toFixed(3)})`;
        g.beginPath(); g.arc(p.x + p.vx * u, p.y + p.vy * u, p.r, 0, TAU); g.fill();
      }
      g.restore();
    }
    g.fillStyle = vig; g.fillRect(0, 0, W, H);
    // éclat blanc de l'éclair final
    const white = fl * (calm ? 0 : 0.85) * (tt >= SHN.bolts[SHN.bolts.length - 1].t ? 1 : fl > 0.5 ? 0.35 : 0.18);
    if (white > 0.01) { g.fillStyle = `rgba(215,232,255,${white.toFixed(3)})`; g.fillRect(0, 0, W, H); }
    g.restore();
    return { tt, roar: roarU, growl: growlU, flash: fl };
  }

  return { begin, frame, resize };
}

/* ───────────────────────── Sons : orage, grognement et rugissement de synthèse ─────────────────────────
   scheduleShenronSfx(ctx, out, noiseBuf, t0, k, calm) programme tout le son sur l'horloge audio.
   Fonction pure vis-à-vis de l'application (testable avec un OfflineAudioContext). */
export function scheduleShenronSfx(ctx, out, noiseBuf, t0, k = 1, calm = false) {
  const T = (s) => t0 + s * k;
  const vol = calm ? 0.6 : 1;
  const stops = [];
  const track = (n) => { stops.push(n); return n; };
  const gainEnv = (gn, pts) => { // pts : [secondes du scénario, valeur] ; montée/descente exponentielles
    gn.gain.setValueAtTime(0.0001, T(pts[0][0]));
    for (let i = 1; i < pts.length; i++) gn.gain.exponentialRampToValueAtTime(Math.max(0.0001, pts[i][1]), T(pts[i][0]));
  };
  const noise = (t, dur, { type = 'lowpass', f0 = 200, f1 = 0, q = 0.7, gain = 0.3, attack = 0.02, loop = false } = {}) => {
    const s = track(ctx.createBufferSource()); s.buffer = noiseBuf; s.loop = loop;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(f0, t); f.Q.value = q;
    if (f1) f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const gn = ctx.createGain(); gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(gain * vol, t + attack); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(gn); gn.connect(out); s.start(t, Math.random() * 0.4); s.stop(t + dur + 0.05);
  };
  const sine = (t, dur, f0, f1, gain) => {
    const o = track(ctx.createOscillator()), gn = ctx.createGain();
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(gain * vol, t + 0.04); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(gn); gn.connect(out); o.start(t); o.stop(t + dur + 0.05);
  };

  // 1) grondement continu du ciel
  const bed = ctx.createGain(); bed.connect(out); gainEnv(bed, [[0, 0.1], [0.02, 0.1], [1.2, 0.24], [2.7, 0.32], [3.5, 0.5], [4.9, 0.0001]]);
  { const s = track(ctx.createBufferSource()); s.buffer = noiseBuf; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 120; f.Q.value = 0.8;
    s.connect(f); f.connect(bed); s.start(T(0)); s.stop(T(4.95)); }
  { const o = track(ctx.createOscillator()), lfo = track(ctx.createOscillator()), lg = ctx.createGain(), gn = ctx.createGain();
    o.frequency.value = 41; lfo.frequency.value = 4.5; lg.gain.value = 3; lfo.connect(lg); lg.connect(o.frequency);
    gn.gain.value = 0.5 * vol; o.connect(gn); gn.connect(bed); o.start(T(0)); lfo.start(T(0)); o.stop(T(4.95)); lfo.stop(T(4.95)); }

  // 2) tonnerre : craquement sec + roulement qui s'éloigne + coup de grave
  SHN.bolts.forEach((b) => {
    const t = T(b.t), s = b.size;
    if (!calm) noise(t, 0.16, { type: 'highpass', f0: 2200, q: 0.6, gain: 0.34 * s, attack: 0.004 });
    noise(t + 0.03, 1.5 * s * k + 0.3, { type: 'lowpass', f0: 900, f1: 70, q: 0.9, gain: 0.5 * s, attack: 0.05 });
    sine(t + 0.02, 0.9 * s + 0.2, 62, 30, 0.42 * s);
  });

  // 3) voix de Shenron : source en dents de scie + formants + modulation d'amplitude (le « râle »)
  const voice = (t, dur, { f0 = 70, bend = 0.8, rattle = 30, power = 1, formants = [[340, 520], [980, 720]], breath = 0.2, sub = 0.6 } = {}) => {
    const bus = ctx.createGain(), am = ctx.createGain(), env = ctx.createGain(), pre = ctx.createGain(), sh = ctx.createWaveShaper();
    const curve = new Float32Array(257); for (let i = 0; i < 257; i++) { const x = (i / 128) - 1; curve[i] = Math.tanh(x * 5) * 0.8; } sh.curve = curve;
    const srcs = [[f0, 1, 'sawtooth'], [f0 * 1.012, 0.7, 'sawtooth'], [f0 * 0.5, sub, 'sawtooth']];
    srcs.forEach(([f, gv, type]) => {
      const o = track(ctx.createOscillator()), og = ctx.createGain(); o.type = type;
      o.frequency.setValueAtTime(f * 1.12, t); o.frequency.linearRampToValueAtTime(f, t + dur * 0.3); o.frequency.linearRampToValueAtTime(f * bend, t + dur);
      og.gain.value = gv * 0.4; o.connect(og); og.connect(pre); o.start(t); o.stop(t + dur + 0.1);
    });
    pre.connect(sh);
    formants.forEach(([a, b], i) => {
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 5 + i * 2; f.frequency.setValueAtTime(a, t); f.frequency.linearRampToValueAtTime(b, t + dur);
      const fg = ctx.createGain(); fg.gain.value = i ? 2.2 : 3.4; sh.connect(f); f.connect(fg); fg.connect(bus);
    });
    // souffle rauque
    { const s = track(ctx.createBufferSource()); s.buffer = noiseBuf; s.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 650; f.Q.value = 0.9; const ng = ctx.createGain(); ng.gain.value = breath;
      s.connect(f); f.connect(ng); ng.connect(bus); s.start(t); s.stop(t + dur + 0.1); }
    // râle : modulation d'amplitude rapide
    const lfo = track(ctx.createOscillator()), lg = ctx.createGain(); lfo.frequency.value = rattle; lg.gain.value = 0.42; am.gain.value = 0.58;
    lfo.connect(lg); lg.connect(am.gain); lfo.start(t); lfo.stop(t + dur + 0.1);
    bus.connect(am); am.connect(env);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200; env.connect(lp); lp.connect(out);
    env.gain.setValueAtTime(0.0001, t); env.gain.exponentialRampToValueAtTime(0.5 * power * vol, t + Math.min(0.25, dur * 0.25));
    env.gain.setValueAtTime(0.5 * power * vol, t + dur * 0.6); env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  };
  voice(T(SHN.growl[0]), (SHN.growl[1] - SHN.growl[0]) * k, { f0: 58, bend: 0.78, rattle: 24, power: 0.75, breath: 0.15 });
  const rs = T(SHN.roar[0]), rd = (SHN.roar[1] - SHN.roar[0]) * k;
  voice(rs, rd, { f0: 66, bend: 0.74, rattle: 34, power: 1.15, breath: 0.3, sub: 0.9 });
  voice(rs + 0.18 * k, rd - 0.25 * k, { f0: 132, bend: 1.25, rattle: 41, power: 0.55, formants: [[520, 760], [1250, 1000]], breath: 0.25, sub: 0.2 });

  // 4) éclair final : craquement, souffle descendant et grosse note grave
  const f = T(SHN.bolts[SHN.bolts.length - 1].t);
  noise(f, 0.7 * k + 0.2, { type: 'bandpass', f0: 3800, f1: 260, q: 0.8, gain: 0.34, attack: 0.01 });
  sine(f, 1.0 * k + 0.2, 52, 26, 0.55);

  return () => { for (const n of stops) { try { n.stop(); } catch { /* déjà arrêté */ } } };
}
