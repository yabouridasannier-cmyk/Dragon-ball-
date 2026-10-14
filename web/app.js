// app.js — Invocation Z, version 0 : interface, animation, son.
import { PROFILES, randomInt, rand01, position, velocity, vmaxFor, buildPool, buildStrip } from './engine.js';
import { loadData } from './data.js';
import { createShenron, scheduleShenronSfx, SHN } from './shenron.js';
import { createJournal } from './journal.js';

const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage indisponible */ } },
};
const vibrate = (p) => { try { navigator.vibrate && !settings.calm && navigator.vibrate(p); } catch { /* ignore */ } };

const { players: PLAYERS, cards: CARDS, demo } = await loadData();
const byId = new Map(CARDS.map((c) => [c.id, c]));
const playerOf = (pid) => PLAYERS.find((p) => p.id === pid) || PLAYERS[0];
const colorOf = (pid) => playerOf(pid).color;

// Journal des combats : toutes les invocations, pour toujours. Les decks se déduisent du journal (propriétaire d'origine + combats gagnés).
const journal = createJournal({ cards: CARDS, store, claudeApi: window.claude });
const originOf = (id) => journal.originOf(id);
function applyOwners() { const m = journal.ownerMap(); for (const c of CARDS) c.owner = m.get(c.id) || originOf(c.id); }
applyOwners();
let history = journal.current(); // tirages de la session en cours (hors annulés), du plus récent au plus ancien

const settings = Object.assign(
  { profile: 'spectacle', sound: true, music: true, intro: true, calm: matchMedia('(prefers-reduced-motion: reduce)').matches },
  store.get('iz.settings', {}),
);
const saveSettings = () => store.set('iz.settings', settings);
/* ───────────────────────── Son (Web Audio, sons de synthèse) ───────────────────────── */
const audio = (() => {
  let ctx = null, master = null, noiseBuf = null, whirrNode = null;
  const A = {
    unlock() {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
        master = ctx.createGain(); master.gain.value = 0.55;
        const lim = ctx.createDynamicsCompressor();
        master.connect(lim); lim.connect(ctx.destination);
        noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      if (ctx.state === 'suspended') ctx.resume();
      A.musicStart();
    },
    pause(hidden) { if (ctx) (hidden ? ctx.suspend() : ctx.resume()); },
    ok() { return ctx && settings.sound; },
    tone(freq, dur, { type = 'sine', gain = 0.2, slide = 0, delay = 0 } = {}) {
      if (!A.ok()) return;
      const t = ctx.currentTime + delay;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
    },
    noise(dur, { gain = 0.2, freq = 1000, q = 1, type = 'bandpass', delay = 0, sweep = 0 } = {}) {
      if (!A.ok()) return;
      const t = ctx.currentTime + delay;
      const s = ctx.createBufferSource(); s.buffer = noiseBuf;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
      if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq + sweep), t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t + dur + 0.05);
    },
    click() { A.tone(900, 0.04, { type: 'square', gain: 0.05 }); },
    chime(i) { const f = [262, 294, 330, 392, 440, 523, 587][i % 7]; A.tone(f, 0.55, { type: 'triangle', gain: 0.2 }); A.tone(f * 2, 0.4, { gain: 0.07 }); },
    pick(stars) { const f = [330, 440, 587][(stars - 1) % 3]; A.tone(f, 0.25, { type: 'triangle', gain: 0.16 }); A.noise(0.35, { gain: 0.06, freq: 2500, type: 'highpass' }); },
    filter() { A.noise(0.55, { gain: 0.14, freq: 900, q: 0.8, sweep: -600 }); },
    riser(dur) {
      if (!A.ok()) return;
      const t = ctx.currentTime;
      const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
      o.type = 'sawtooth'; o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(880, t + dur);
      f.type = 'lowpass'; f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(3200, t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09, t + dur * 0.9); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.1);
      o.connect(f); f.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.15);
    },
    shnBus: null, shnStop: null,
    shenron(k, calm) { // orage + grognement + rugissement, sur un bus à part pour pouvoir couper net si on passe l'intro
      if (!A.ok()) return;
      A.shenronStop(true);
      A.shnBus = ctx.createGain(); A.shnBus.gain.value = 0.9; A.shnBus.connect(master);
      A.shnStop = scheduleShenronSfx(ctx, A.shnBus, noiseBuf, ctx.currentTime + 0.05, k, calm);
    },
    shenronStop(now) { // fondu rapide (intro passée) ; now = coupe aussitôt
      if (!ctx || !A.shnBus) return;
      const bus = A.shnBus, stop = A.shnStop; A.shnBus = null; A.shnStop = null;
      bus.gain.cancelScheduledValues(ctx.currentTime); bus.gain.setTargetAtTime(0, ctx.currentTime, now ? 0.01 : 0.06);
      setTimeout(() => { try { stop && stop(); bus.disconnect(); } catch { /* ignore */ } }, 400);
    },
    press() { A.tone(110, 0.18, { type: 'square', gain: 0.18, slide: -50 }); A.noise(0.08, { gain: 0.15, freq: 700 }); },
    whoosh() { A.noise(0.7, { gain: 0.3, freq: 400, q: 0.7, sweep: 2600 }); A.tone(70, 0.5, { type: 'sawtooth', gain: 0.12, slide: 120 }); },
    tick(v) { // plus la vitesse baisse, plus le tick est grave et long
      const k = clamp(1 - v / 15, 0, 1);
      A.tone(lerp(1700, 640, k), lerp(0.03, 0.09, k), { type: 'square', gain: lerp(0.05, 0.12, k) });
      A.noise(0.03, { gain: lerp(0.05, 0.1, k), freq: lerp(3500, 1200, k), q: 2 });
    },
    lastTick() { A.tone(360, 0.4, { type: 'square', gain: 0.18 }); A.tone(180, 0.5, { type: 'sine', gain: 0.22 }); A.noise(0.12, { gain: 0.15, freq: 1500 }); },
    beat() { A.tone(62, 0.16, { gain: 0.34, slide: -22 }); A.tone(58, 0.16, { gain: 0.26, slide: -20, delay: 0.17 }); },
    lock() { A.tone(1000, 0.09, { type: 'square', gain: 0.12 }); A.tone(1500, 0.09, { type: 'square', gain: 0.1, delay: 0.1 }); },
    thud() { A.tone(60, 0.5, { gain: 0.55, slide: -30 }); A.noise(0.18, { gain: 0.3, freq: 300, type: 'lowpass' }); },
    fanfare() {
      [[523, 0], [659, 0.09], [784, 0.18], [1047, 0.3]].forEach(([f, d]) => { A.tone(f, 0.9, { type: 'sawtooth', gain: 0.1, delay: d }); A.tone(f * 1.5, 0.7, { type: 'triangle', gain: 0.07, delay: d }); });
      for (let i = 0; i < 12; i++) A.tone(2200 + Math.random() * 1800, 0.12, { gain: 0.05, delay: 0.3 + i * 0.08 + Math.random() * 0.05 });
    },
    whirrStart() {
      if (!A.ok() || whirrNode) return;
      const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 600; f.Q.value = 1.2;
      const g = ctx.createGain(); g.gain.value = 0;
      s.connect(f); f.connect(g); g.connect(master); s.start();
      whirrNode = { s, f, g };
    },
    whirrSet(gain, freq) { if (whirrNode) { const t = ctx.currentTime; whirrNode.g.gain.setTargetAtTime(gain, t, 0.05); whirrNode.f.frequency.setTargetAtTime(freq, t, 0.05); } },
    whirrStop() { if (whirrNode) { try { whirrNode.g.gain.setTargetAtTime(0, ctx.currentTime, 0.05); whirrNode.s.stop(ctx.currentTime + 0.3); } catch { /* ignore */ } whirrNode = null; } },

    /* ── Musique d'ambiance épique, composée pour l'app (aucun extrait de la série) ── */
    musicBus: null, musicLP: null, musicTimer: null, musicNext: 0, musicStep: 0,
    musicStart() {
      if (!ctx || !settings.sound || !settings.music || A.musicTimer) return;
      if (!A.musicBus) {
        A.musicLP = ctx.createBiquadFilter(); A.musicLP.type = 'lowpass'; A.musicLP.frequency.value = 18000;
        A.musicBus = ctx.createGain(); A.musicBus.gain.value = 0.0001;
        A.musicLP.connect(A.musicBus); A.musicBus.connect(master);
      }
      A.musicBus.gain.setTargetAtTime(0.42, ctx.currentTime, 0.4);
      A.musicNext = ctx.currentTime + 0.12; A.musicStep = 0;
      A.musicTimer = setInterval(A.musicTick, 25);
    },
    musicStop() {
      clearInterval(A.musicTimer); A.musicTimer = null;
      if (ctx && A.musicBus) A.musicBus.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.15);
    },
    musicDuck(on) { // la musique s'efface pendant le spectacle et revient doucement après la révélation
      if (!ctx || !A.musicBus || !A.musicTimer) return;
      const t = ctx.currentTime;
      A.musicBus.gain.setTargetAtTime(on ? 0.12 : 0.42, t, on ? 0.25 : 0.8);
      A.musicLP.frequency.setTargetAtTime(on ? 700 : 18000, t, on ? 0.25 : 0.8);
    },
    musicTick() {
      const spb = 60 / 140 / 2; // une croche à 140 battements par minute
      while (A.musicNext < ctx.currentTime + 0.15) { A.musicNote(A.musicStep, A.musicNext, spb); A.musicNext += spb; A.musicStep = (A.musicStep + 1) % 32; }
    },
    musicNote(step, t, spb) {
      const bar = step >> 3, slot = step & 7, out = A.musicLP;
      const ROOTS = [45, 41, 48, 43]; // la mineur : La, Fa, Do, Sol
      const CHORDS = [[57, 60, 64], [53, 57, 60], [60, 64, 67], [55, 59, 62]];
      const LEAD = [[69, 0, 72, 69, 76, 0, 74, 72], [72, 0, 69, 72, 77, 0, 76, 74], [76, 0, 79, 76, 84, 0, 83, 79], [74, 0, 79, 74, 83, 0, 81, 79]];
      const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
      const osc = (f, dur, type, gain, att, lpf, det) => {
        const o = ctx.createOscillator(), g = ctx.createGain(), l = ctx.createBiquadFilter();
        o.type = type; o.frequency.value = f; o.detune.value = det || 0; l.type = 'lowpass'; l.frequency.value = lpf;
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + att);
        g.gain.setValueAtTime(gain, t + dur * 0.75); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(l); l.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.05);
      };
      const nz = (dur, gain, freq, type) => {
        const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
        s.buffer = noiseBuf; f.type = type; f.frequency.value = freq;
        g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        s.connect(f); f.connect(g); g.connect(out); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
      };
      const drum = (f0, f1, dur, gain) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
        g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.02);
      };
      if (slot === 0 || slot === 3 || slot === 4) drum(130, 42, 0.22, 0.75);                  // taiko
      if (slot === 2 || slot === 6) { nz(0.14, 0.32, 1900, 'bandpass'); drum(220, 110, 0.1, 0.25); } // caisse claire
      if (slot % 2 === 1) nz(0.04, 0.09, 7000, 'highpass');                                    // charleston
      if (bar === 3 && slot >= 5) drum(200 - (slot - 5) * 28, 80, 0.16, 0.5);                 // roulement de toms
      if (step === 0) nz(1.1, 0.22, 4500, 'highpass');                                         // cymbale
      osc(mtof(ROOTS[bar] + (slot % 2 ? 12 : 0)), spb * 0.9, 'sawtooth', 0.15, 0.005, 520);   // basse en croches
      if (slot === 0) CHORDS[bar].forEach((m) => { osc(mtof(m), spb * 8, 'sawtooth', 0.04, 0.25, 1500, 7); osc(mtof(m), spb * 8, 'sawtooth', 0.04, 0.25, 1500, -7); }); // cuivres
      const L = LEAD[bar][slot];
      if (L) { osc(mtof(L), spb * 1.8, 'sawtooth', 0.07, 0.01, 3400, 0); osc(mtof(L), spb * 1.8, 'square', 0.025, 0.01, 2600, 5); } // mélodie héroïque
    },
  };
  return A;
})();

/* ───────────────────────── Éléments et mise en page ───────────────────────── */
const root = document.documentElement;
const stage = $('#stage'), machine = $('#machine'), winEl = $('#window'), stripEl = $('#strip');
const lightEl = $('#light'), streaksEl = $('#streaks'), lockbox = $('#lockbox');
const goBtn = $('#go'), countEl = $('#count'), oddsEl = $('#odds'), chipsEl = $('#chips');
const ballsEl = $('#balls'), histEl = $('#history'), toastEl = $('#toast');
const vignette = $('#vignette'), flashEl = $('#flash');
const shnEl = $('#shenron'), shnCap = $('#shnCap'), shnSkip = $('#shnSkip'), shn = createShenron($('#shn'));
const overlay = $('#overlay'), heroWrap = $('#heroWrap'), banner = $('#banner'), actions = $('#actions');
const ptrs = [...document.querySelectorAll('.ptr')];

let pitch = 200, cardW = 176, cardH = 246, W = 800;
function layout() {
  const small = innerWidth < 720;
  pitch = clamp(small ? 84 : 110, small ? innerWidth / 3.7 : innerWidth / 7.5, 270);
  pitch = Math.min(pitch, (innerHeight * 0.36) / 1.4 / 0.88 / 1.2);
  cardW = pitch * 0.88; cardH = cardW * 1.4;
  root.style.setProperty('--cw', cardW + 'px'); root.style.setProperty('--ch', cardH + 'px');
  winEl.style.height = Math.round(cardH * 1.2) + 'px';
  W = winEl.clientWidth;
  clearLive();
}

const faceHTML = (c) => (c.img
  ? `<img src="${esc(c.img)}" alt="${esc(c.name)}" draggable="false">`
  : `<div class="face"><div class="t">${c.missing ? 'IMAGE À VENIR' : 'DBZ'}</div><div class="n">${c.id}</div><div class="nm">${esc(c.name)}</div></div>`);

const live = new Map();
function clearLive() { for (const el of live.values()) el.remove(); live.clear(); }
function makeCard(c, instant) {
  const el = document.createElement('div');
  el.className = 'card';
  el.style.setProperty('--oc', colorOf(c.owner)); el.style.setProperty('--h', c.hue);
  if (instant) el.style.animation = 'none';
  el.innerHTML = faceHTML(c);
  return el;
}
function render(strip, pos, speedFrac, instant) {
  const center = W / 2, base = Math.floor(pos);
  for (const [k, el] of live) if (k < base - 9 || k > base + 10) { el.remove(); live.delete(k); }
  for (let k = base - 9; k <= base + 10; k++) {
    const c = strip[k]; if (!c) continue;
    let el = live.get(k);
    if (!el) { el = makeCard(c, instant); stripEl.appendChild(el); live.set(k, el); }
    const rel = k - pos, ar = Math.abs(rel);
    const s = Math.max(0.72, 1 - 0.06 * ar);
    const sx = s * Math.cos(Math.min(ar * 0.16, 0.56)) * (1 + 0.12 * speedFrac);
    el.style.transform = `translate(${(center + rel * pitch - cardW / 2).toFixed(1)}px,0) scale(${sx.toFixed(3)},${s.toFixed(3)})`;
    el.style.opacity = Math.max(0.55, 1 - 0.09 * ar).toFixed(2);
    el.style.zIndex = 50 - Math.round(ar * 4);
  }
}

/* ───────────────────────── Décor : ampoules, Dragon Balls, étoiles ───────────────────────── */
const NB = 22;
$('#bulbsTop').innerHTML = '<i></i>'.repeat(NB); $('#bulbsBot').innerHTML = '<i></i>'.repeat(NB);
const bulbsTop = [...document.querySelectorAll('#bulbsTop i')], bulbsBot = [...document.querySelectorAll('#bulbsBot i')];
let bulbPhase = 0;
function updateBulbs(dt, turns) {
  bulbPhase = (bulbPhase + turns * dt) % 1;
  for (let i = 0; i < NB; i++) {
    const a = Math.max(0, Math.cos(2 * Math.PI * (i / NB - bulbPhase))) ** 3;
    const b = Math.max(0, Math.cos(2 * Math.PI * (i / NB + bulbPhase))) ** 3;
    bulbsTop[i].style.opacity = (0.2 + 0.8 * a).toFixed(2); bulbsBot[i].style.opacity = (0.2 + 0.8 * b).toFixed(2);
  }
}
const balls = Array.from({ length: 7 }, (_, i) => {
  const el = document.createElement('div');
  el.className = 'ball'; el.style.marginTop = (i - 3) ** 2 * 3 + 'px';
  el.innerHTML = '<span>' + '★'.repeat(i + 1) + '</span>';
  ballsEl.appendChild(el); return el;
});

/* ───────────────────────── Effets : éclairs et particules (canvas) ───────────────────────── */
const fx = $('#fx'), g = fx.getContext('2d');
function fxResize() { const d = Math.min(2, devicePixelRatio || 1); fx.width = innerWidth * d; fx.height = innerHeight * d; g.setTransform(d, 0, 0, d, 0, 0); }
const parts = []; let boltsOn = false, boltAcc = 0, boltList = [], fxDirty = false;
function burst(cx, cy, tint) {
  const k = innerWidth < 720 ? 0.6 : 1;
  for (let i = 0; i < 120 * k; i++) { const a = Math.random() * Math.PI * 2, v = 600 + Math.random() * 800; parts.push({ t: 's', x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 300, g: 1800, r: 1.5 + Math.random() * 2.5, life: 0.8 + Math.random() * 0.8, c: Math.random() < 0.7 ? '#FFD24A' : '#fff1a8' }); }
  for (let i = 0; i < 30 * k; i++) { const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4, v = 500 + Math.random() * 700; parts.push({ t: 'c', x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 1700, r: 5 + Math.random() * 3, life: 1.1 + Math.random() * 0.7, c: '#F5B301' }); }
  for (let i = 0; i < 60 * k; i++) { parts.push({ t: 'e', x: cx + (Math.random() - 0.5) * innerWidth * 0.5, y: innerHeight + 10, vx: (Math.random() - 0.5) * 60, vy: -(120 + Math.random() * 260), g: -30, r: 1.5 + Math.random() * 2, life: 1.2 + Math.random() * 1.2, c: tint || '#FF8A1F' }); }
  fxDirty = true;
}
function makeBolts() {
  const m = machine.getBoundingClientRect(), out = [];
  for (let n = 0; n < 3; n++) {
    const b = balls[randomInt(7)].getBoundingClientRect();
    const x0 = b.left + b.width / 2, y0 = b.top + b.height / 2;
    const x1 = m.left + m.width * (0.25 + 0.5 * rand01()), y1 = m.top + 6;
    const pts = [[x0, y0]];
    for (let i = 1; i < 8; i++) { const t = i / 8; pts.push([lerp(x0, x1, t) + (rand01() - 0.5) * 38, lerp(y0, y1, t) + (rand01() - 0.5) * 12]); }
    pts.push([x1, y1]); out.push(pts);
  }
  return out;
}
function drawFx(dt) {
  if (!parts.length && !boltsOn && !fxDirty) return;
  g.clearRect(0, 0, innerWidth, innerHeight);
  fxDirty = parts.length > 0 || boltsOn;
  if (boltsOn) {
    boltAcc += dt; if (boltAcc > 0.033) { boltAcc = 0; boltList = makeBolts(); }
    g.strokeStyle = '#d8f0ff'; g.lineWidth = 2; g.shadowColor = '#7cc4ff'; g.shadowBlur = 14;
    for (const pts of boltList) { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); }
    g.shadowBlur = 0;
  }
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]; p.life -= dt;
    if (p.life <= 0) { parts.splice(i, 1); continue; }
    p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt;
    g.globalAlpha = Math.min(1, p.life * 1.6); g.fillStyle = p.c;
    g.beginPath(); g.arc(p.x, p.y, p.r, 0, 6.2832); g.fill();
    if (p.t === 'c') { g.strokeStyle = '#fff3b0'; g.lineWidth = 1; g.stroke(); }
  }
  g.globalAlpha = 1;
}

/* ───────────────────────── État, joueurs, pool, ruban au repos ───────────────────────── */
let state = 'idle'; // idle | run | reveal
let player = null, pool = CARDS;
let idle = [], idlePos = 300, run = null;
function makeIdle(poolCards, visible = []) {
  const arr = buildStrip(poolCards, { id: -1 }, -100, 600, []);
  visible.forEach((c, j) => { if (c) arr[296 + j] = c; });
  return arr;
}
const preload = (list) => list.forEach((c) => { if (c.img) { const im = new Image(); im.src = c.img; } });

let toastT = 0;
function toast(msg) { toastEl.textContent = msg; toastEl.classList.add('in'); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('in'), 3200); }
function animateNumber(el, from, to, ms) {
  const t0 = performance.now();
  const step = (now) => { const u = clamp((now - t0) / ms, 0, 1); el.textContent = Math.round(lerp(from, to, 1 - (1 - u) ** 3)); if (u < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

PLAYERS.forEach((p) => {
  const b = document.createElement('button');
  b.className = 'chip'; b.style.setProperty('--c', p.color); b.dataset.id = p.id;
  b.innerHTML = `<span class="dot">${'★'.repeat(p.stars)}</span><span>${esc(p.name)}</span><span class="n" title="Cartes dans le deck"></span>`;
  b.addEventListener('click', () => selectPlayer(p));
  chipsEl.appendChild(b);
});
const chipBtns = [...chipsEl.children];

// Cartes tirables par un joueur : celles des autres, sauf celles « sur la table » (combat pas encore validé)
const poolFor = (pid) => { const hold = journal.pendingIds(); return buildPool(CARDS, pid).filter((c) => !hold.has(c.id)); };

function updateDeckCounts() {
  const n = {}; for (const c of CARDS) n[c.owner] = (n[c.owner] || 0) + 1;
  chipBtns.forEach((b) => {
    const el = b.querySelector('.n'), v = String(n[b.dataset.id] || 0);
    if (el && el.textContent !== v) { el.textContent = v; el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
  });
}

// Les cartes visibles qui ne sont plus tirables se figent puis se désintègrent
function purgeIdle(test) {
  let hit = 0;
  for (const [k, el] of live) if (idle[k] && test(idle[k])) { el.classList.add('dust'); hit++; }
  setTimeout(() => {
    for (let i = 0; i < idle.length; i++) if (test(idle[i])) idle[i] = pool[randomInt(pool.length)];
    for (const [k, el] of live) if (el.classList.contains('dust')) { el.remove(); live.delete(k); }
  }, settings.calm ? 0 : 520);
  return hit;
}

function refreshPool() {
  updateDeckCounts();
  if (!player) return;
  const before = pool.length;
  pool = poolFor(player.id);
  animateNumber(countEl, before, pool.length, 500);
  if (state === 'idle') {
    oddsEl.textContent = `1 chance sur ${pool.length}`;
    const inPool = new Set(pool.map((c) => c.id));
    purgeIdle((c) => !inPool.has(c.id));
  }
}

function selectPlayer(p) {
  if (state !== 'idle' || (player && player.id === p.id)) return;
  audio.unlock(); audio.pick(p.stars);
  const before = pool.length;
  player = p; pool = poolFor(p.id);
  root.style.setProperty('--accent', p.color);
  chipBtns.forEach((b) => b.classList.toggle('on', b.dataset.id === p.id));
  if (purgeIdle((c) => c.owner === p.id)) audio.filter();
  animateNumber(countEl, before, pool.length, 600);
  oddsEl.textContent = `1 chance sur ${pool.length}`;
  toast(`Les ${CARDS.filter((c) => c.owner === p.id).length} cartes de ${p.name} sont retirées du tirage`);
  goBtn.disabled = false;
  preload(pool.slice(0, 0).concat(Array.from({ length: 40 }, () => pool[randomInt(pool.length)])));
}

/* ───────────────────────── Historique de la session et combats ───────────────────────── */
const STATUS = { pending: ['⚔', 'Combat à jouer'], won: ['✔', 'Gagné'], lost: ['✘', 'Perdu'], void: ['∅', 'Annulé'] };
const histHint = $('#histHint');
function renderHistory() {
  histEl.innerHTML = '';
  history.slice(0, 30).forEach((h) => {
    const c = byId.get(h.cardId); if (!c) return;
    const b = document.createElement('button'); b.type = 'button'; b.className = 'h ' + h.status;
    b.setAttribute('aria-label', `${c.name} — ${STATUS[h.status][1]}`); b.title = `${c.name} · ${STATUS[h.status][1]}`;
    b.style.setProperty('--oc', colorOf(c.owner)); b.style.setProperty('--h', c.hue);
    b.innerHTML = `${c.img ? `<img src="${esc(c.img)}" alt="">` : `<div class="face">${c.id}</div>`}<i class="st">${STATUS[h.status][0]}</i>`;
    b.addEventListener('click', () => openDuel(h));
    histEl.appendChild(b);
  });
  const k = history.filter((h) => h.status === 'pending').length, all = journal.pendingCount();
  histHint.textContent = k ? `⚔ ${k} combat${k > 1 ? 's' : ''} à valider — touche une carte` : all ? `⚔ ${all} combat${all > 1 ? 's' : ''} en attente dans le journal 📜` : history.length ? 'Touche une carte pour modifier son résultat' : '';
  const badge = $('#logBadge'); badge.hidden = !all; badge.textContent = all;
}

const duel = $('#duel'), duelCard = $('#duelCard'), duelWin = $('#duelWin'), duelLose = $('#duelLose'), duelReset = $('#duelReset');
let duelEntry = null, duelOpener = null;
function openDuel(h) {
  if (state !== 'idle') return;
  const c = byId.get(h.cardId); if (!c) return;
  audio.unlock(); audio.click();
  duelEntry = h; duelOpener = document.activeElement;
  const drawer = playerOf(h.playerId), from = playerOf(h.from);
  duel.style.setProperty('--oc', colorOf(c.owner));
  duelCard.innerHTML = `<div class="hero" style="--oc:${colorOf(c.owner)};--h:${c.hue}">${faceHTML(c)}</div>`;
  $('#duelTitle').textContent = c.name;
  $('#duelInfo').innerHTML = `Tirée par <b style="color:${drawer.color}">${esc(drawer.name)}</b> · carte de <b style="color:${from.color}">${esc(from.name)}</b>`;
  $('#duelState').textContent = h.status === 'pending' ? '⚔ Combat à jouer' : h.status === 'won' ? `✔ Gagné — dans le deck de ${drawer.name}` : `✘ Perdu — restituée à ${from.name}`;
  $('#duelState').dataset.s = h.status;
  duelWin.innerHTML = `🏆 GAGNÉ<small>va chez ${esc(drawer.name)}</small>`; duelLose.innerHTML = `↩ PERDU<small>retourne chez ${esc(from.name)}</small>`;
  duelWin.setAttribute('aria-pressed', String(h.status === 'won')); duelLose.setAttribute('aria-pressed', String(h.status === 'lost'));
  duelReset.hidden = h.status === 'pending';
  duel.hidden = false; duelWin.focus({ preventScroll: true });
}
function closeDuel() {
  if (duel.hidden) return;
  duel.hidden = true; duelEntry = null;
  if (duelOpener && duelOpener.isConnected) duelOpener.focus({ preventScroll: true });
}
function answerDuel(status) {
  const h = duelEntry; if (!h) return;
  const c = byId.get(h.cardId), drawer = playerOf(h.playerId), from = playerOf(h.from);
  journal.setStatus(h.id, status); // le journal prévient l'application (decks, tirage, barre) et sauvegarde
  if (status === 'won') { audio.pick(drawer.stars); toast(`${c.name} rejoint le deck de ${drawer.name} (${CARDS.filter((x) => x.owner === drawer.id).length} cartes)`); }
  else if (status === 'lost') { audio.click(); toast(`${c.name} retourne chez ${from.name}`); }
  else { audio.click(); toast(`${c.name} : combat remis à jouer`); }
  duelCard.firstChild.animate(status === 'won' ? [{ filter: 'brightness(1)' }, { filter: 'brightness(2.2)', offset: 0.3 }, { filter: 'brightness(1)' }]
    : [{ translate: '0 0' }, { translate: '-10px 0', offset: 0.2 }, { translate: '10px 0', offset: 0.5 }, { translate: '0 0' }], { duration: settings.calm ? 150 : 420 });
  setTimeout(closeDuel, settings.calm ? 120 : 430);
}
duelWin.addEventListener('click', () => answerDuel('won'));
duelLose.addEventListener('click', () => answerDuel('lost'));
duelReset.addEventListener('click', () => answerDuel('pending'));
$('#duelClose').addEventListener('click', closeDuel);
duel.addEventListener('click', (e) => { if (e.target === duel) closeDuel(); });

/* ───────────────────────── Journal des combats (long terme) ───────────────────────── */
const jEl = $('#journal'), jList = $('#jList'), jDecks = $('#jDecks'), jMode = $('#jMode'), jIO = $('#jIO'), jText = $('#jText');
const J = { filter: 'all', q: '', shown: 60 };
const fmtDay = (ts) => new Date(ts).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtHour = (ts) => new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
function renderJournal() {
  if (jEl.hidden) return;
  const n0 = {}, n1 = {}; for (const c of CARDS) { n0[originOf(c.id)] = (n0[originOf(c.id)] || 0) + 1; n1[c.owner] = (n1[c.owner] || 0) + 1; }
  jDecks.innerHTML = PLAYERS.map((p) => { const d = (n1[p.id] || 0) - (n0[p.id] || 0); return `<div class="jd" style="--c:${p.color}"><b>${esc(p.name)}</b><span class="jn">${n1[p.id] || 0}</span><small>${d ? (d > 0 ? '+' : '') + d + ' vs départ' : 'inchangé'}</small></div>`; }).join('');
  const all = journal.entries(-1), q = J.q.trim().toLowerCase();
  const rows = all.filter((e) => (J.filter === 'all' ? e.status !== 'void' : e.status === J.filter) && (!q || (byId.get(e.cardId)?.name || '').toLowerCase().includes(q)));
  $('#jFilter').querySelectorAll('button').forEach((b) => { b.setAttribute('aria-pressed', String(b.dataset.f === J.filter)); const k = b.dataset.f === 'all' ? all.filter((e) => e.status !== 'void').length : all.filter((e) => e.status === b.dataset.f).length; b.querySelector('i').textContent = k; });
  let html = '', lastSess = null, shown = 0;
  const sessCount = new Map(); for (const e of rows) sessCount.set(e.session, (sessCount.get(e.session) || 0) + 1);
  for (const e of rows) {
    if (shown >= J.shown) break; shown++;
    const c = byId.get(e.cardId); if (!c) continue;
    if (e.session !== lastSess) { lastSess = e.session; html += `<div class="jsess">${esc(fmtDay(e.session))} · ${fmtHour(e.session)} <small>${sessCount.get(e.session)} tirage${sessCount.get(e.session) > 1 ? 's' : ''}</small></div>`; }
    const dr = playerOf(e.playerId), fr = playerOf(e.from);
    const img = c.img ? `<img src="${esc(c.img)}" alt="" loading="lazy">` : `<div class="face">${c.id}</div>`;
    const st = (s, lab) => `<button type="button" data-s="${s}" aria-pressed="${e.status === s}" aria-label="${lab}" title="${lab}">${STATUS[s][0]}</button>`;
    html += `<div class="jr s-${e.status}" data-id="${esc(e.id)}"><div class="jt" style="--oc:${colorOf(c.owner)};--h:${c.hue}">${img}</div>
      <div class="jm"><b>${esc(c.name)}</b><span><i style="color:${dr.color}">${esc(dr.name)}</i> ← <i style="color:${fr.color}">${esc(fr.name)}</i> · ${fmtHour(e.ts)}${e.note ? ` · <em>${esc(e.note)}</em>` : ''}</span></div>
      <div class="jst">${e.status === 'void' ? `<button type="button" data-s="pending" class="jrest">Rétablir</button>` : `${st('pending', 'Combat à jouer')}${st('won', 'Gagné : la carte va chez ' + dr.name)}${st('lost', 'Perdu : la carte reste à ' + fr.name)}<button type="button" data-s="void" class="jx" aria-label="Annuler ce tirage" title="Annuler ce tirage (rétablissable)">🗑</button>`}</div></div>`;
  }
  if (!rows.length) html = `<p class="jempty">${all.length ? 'Aucun tirage ne correspond.' : 'Aucun tirage pour le moment. Les invocations apparaîtront ici et resteront gardées.'}</p>`;
  else if (rows.length > J.shown) html += `<button type="button" id="jMore" class="pill">Voir plus (${rows.length - J.shown})</button>`;
  jList.innerHTML = html;
  const info = journal.info();
  jMode.textContent = info.mode === 'cloud' ? '☁ Sauvegardé en ligne et dans ce navigateur' : info.mode === 'cloud-read' ? '☁ En ligne en lecture seule · sauvegardé dans ce navigateur' : info.storage ? '💾 Sauvegardé dans ce navigateur seulement' : '⚠ Ce navigateur ne garde rien : copie la sauvegarde';
  jMode.dataset.m = info.mode === 'local' && !info.storage ? 'warn' : info.mode;
}
function openJournal() {
  if (state === 'run' || state === 'intro') return;
  closeDuel(); audio.unlock(); audio.click();
  jEl.hidden = false; document.body.classList.add('jopen'); renderJournal(); $('#jClose').focus({ preventScroll: true });
}
function closeJournal() { if (jEl.hidden) return; jEl.hidden = true; jIO.hidden = true; document.body.classList.remove('jopen'); $('#btn-log').focus({ preventScroll: true }); }
$('#btn-log').addEventListener('click', openJournal);
$('#jClose').addEventListener('click', closeJournal);
jEl.addEventListener('click', (e) => { if (e.target === jEl) closeJournal(); });
jList.addEventListener('click', (e) => {
  if (e.target.id === 'jMore') { J.shown += 60; renderJournal(); return; }
  const b = e.target.closest('button[data-s]'), row = e.target.closest('.jr'); if (!b || !row) return;
  const entry = journal.entries().find((x) => x.id === row.dataset.id); if (!entry) return;
  audio.click(); journal.setStatus(entry.id, b.dataset.s);
  const c = byId.get(entry.cardId);
  toast(b.dataset.s === 'void' ? `Tirage de ${c.name} annulé (rétablissable)` : b.dataset.s === 'won' ? `${c.name} → deck de ${playerOf(entry.playerId).name}` : b.dataset.s === 'lost' ? `${c.name} reste à ${playerOf(entry.from).name}` : `${c.name} : combat à jouer`);
});
$('#jFilter').addEventListener('click', (e) => { const b = e.target.closest('button[data-f]'); if (!b) return; J.filter = b.dataset.f; J.shown = 60; renderJournal(); });
$('#jSearch').addEventListener('input', (e) => { J.q = e.target.value; J.shown = 60; renderJournal(); });
$('#jNewSession').addEventListener('click', () => {
  const k = journal.pendingCount();
  if (k && !confirm(`${k} combat${k > 1 ? 's' : ''} pas encore validé${k > 1 ? 's' : ''} resteront en attente dans le journal. Commencer une nouvelle session ?`)) return;
  journal.newSession(); toast('Nouvelle session : la barre du bas repart à zéro, le journal garde tout');
});
// Ajout manuel (pour corriger ou reconstituer un combat)
const jCards = $('#jCards'); jCards.innerHTML = [...CARDS].sort((a, b) => a.name.localeCompare(b.name, 'fr')).map((c) => `<option value="${esc(c.name)}"></option>`).join('');
$('#jWho').innerHTML = PLAYERS.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
$('#jAddBtn').addEventListener('click', () => {
  const name = $('#jCardQ').value.trim().toLowerCase(), who = $('#jWho').value, res = $('#jRes').value, msg = $('#jAddMsg');
  const c = CARDS.find((x) => x.name.toLowerCase() === name);
  if (!c) { msg.textContent = 'Choisis une carte dans la liste proposée.'; return; }
  if (c.owner === who) { msg.textContent = `${c.name} est déjà dans le deck de ${playerOf(who).name}.`; return; }
  journal.add({ cardId: c.id, playerId: who, status: res, note: 'ajouté à la main' });
  msg.textContent = `✔ Ajouté : ${playerOf(who).name} ← ${c.name}`; $('#jCardQ').value = '';
});
// Sauvegarde manuelle
$('#jExport').addEventListener('click', async () => {
  const text = journal.exportJSON();
  try { await navigator.clipboard.writeText(text); toast('Sauvegarde copiée : colle-la dans un message ou un fichier'); }
  catch { jIO.hidden = false; jText.value = text; jText.focus(); jText.select(); $('#jApply').hidden = true; toast('Copie manuelle : le texte est sélectionné'); }
});
$('#jImport').addEventListener('click', () => { jIO.hidden = false; jText.value = ''; jText.placeholder = 'Colle ici une sauvegarde copiée plus tôt…'; $('#jApply').hidden = false; jText.focus(); });
$('#jApply').addEventListener('click', () => {
  try { const r = journal.importJSON(jText.value); toast(`Sauvegarde restaurée : ${r.added} ajouté${r.added > 1 ? 's' : ''}, ${r.updated} mis à jour${r.bad ? `, ${r.bad} ignoré${r.bad > 1 ? 's' : ''}` : ''}`); jIO.hidden = true; }
  catch (err) { toast(err.message); }
});
// Tout changement du journal (ici, ou venu d'un autre appareil) met à jour decks, tirage, barre et fenêtre
journal.onChange(() => {
  applyOwners(); history = journal.current(); renderHistory(); refreshPool(); renderJournal();
  if (state === 'idle') for (const [k, el] of live) if (idle[k]) el.style.setProperty('--oc', colorOf(idle[k].owner));
});

/* ───────────────────────── Invocation ───────────────────────── */
// Durée de l'intro Shenron selon le spectacle choisi (0 = pas d'intro : le mode Éclair reste éclair)
const INTRO_SECONDS = { eclair: 0, rapide: 3.2, spectacle: 5, epique: 5 };
let intro = null;

function invoke() {
  if (state !== 'idle' || !player) return;
  audio.unlock();
  const P = PROFILES[settings.profile];
  const winner = pool[randomInt(pool.length)]; // le résultat est tiré AVANT toute animation
  store.set('iz.pending', { cardId: winner.id, playerId: player.id, ts: Date.now() });
  const f = (randomInt(2) ? 1 : -1) * (0.2 + 0.14 * rand01());
  const b = Math.floor(idlePos), frac = idlePos - b;
  const T = 4 + P.travel;
  const strip = buildStrip(pool, winner, T, T + 21, idle.slice(b - 4, b + 5)); // continuité visuelle
  preload(strip); // les images se chargent pendant l'intro
  const p0 = 4 + frac, base = p0 - 0.4, target = T + f;
  run = { P, strip, winner, T, f, p0, base, target, vmax: vmaxFor(target - base, P), t0: 0,
    lit: 0, lastIdx: Math.floor(p0 + 0.5), sx: f, sv: 0, launched: false, lockOn: false, done: false, nextBeat: 0, theta: 0, omega: 0, lastVib: 0 };
  goBtn.classList.add('busy'); goBtn.disabled = true; chipBtns.forEach((c) => (c.disabled = true));
  panel.hidden = true; audio.musicDuck(true);
  const D = settings.intro ? INTRO_SECONDS[settings.profile] || 0 : 0;
  if (D > 0) startIntro(D); else launchRun();
}

function launchRun() {
  run.t0 = performance.now();
  state = 'run';
  clearLive();
  audio.press(); audio.riser(run.P.Tcharge); vibrate(15);
  oddsEl.textContent = 'Charge…';
}

/* ───────────────────────── Intro : Shenron surgit de l'orage ───────────────────────── */
function startIntro(D) {
  state = 'intro';
  intro = { t: 0, D, k: D / SHN.D, cap: -1, roared: false };
  shn.begin({ k: intro.k, calm: settings.calm });
  shnEl.hidden = false; shnEl.classList.remove('out'); void shnEl.offsetWidth; shnEl.classList.add('on');
  shnCap.classList.remove('in'); shnSkip.classList.remove('in');
  audio.shenron(intro.k, settings.calm); vibrate([30, 50, 30]);
  oddsEl.textContent = 'Shenron s’éveille…';
  updateIntro(0);
}
function updateIntro(dt) {
  const I = intro; if (!I) return;
  I.t += dt;
  const r = shn.frame(I.t);
  const ci = SHN.caps.findIndex(([a, b]) => r.tt >= a && r.tt < b);
  if (ci !== I.cap) { I.cap = ci; if (ci >= 0) shnCap.textContent = SHN.caps[ci][2]; shnCap.classList.toggle('in', ci >= 0); }
  shnSkip.classList.toggle('in', I.t > 1);
  if (!I.roared && r.roar > 0.5) { I.roared = true; vibrate([60, 40, 90, 40, 140]); }
  if (I.t >= I.D) endIntro(false);
}
function endIntro(skipped) {
  if (!intro) return;
  intro = null;
  if (skipped) { audio.shenronStop(false); if (!settings.calm) flashEl.animate([{ opacity: 0 }, { opacity: 0.4, offset: 0.25 }, { opacity: 0 }], { duration: 260 }); }
  shnEl.classList.add('out'); shnEl.classList.remove('on'); shnCap.classList.remove('in'); shnSkip.classList.remove('in');
  setTimeout(() => { if (!intro) shnEl.hidden = true; }, 520);
  launchRun();
}
const skipIntro = () => { if (intro && intro.t > 1) endIntro(true); };
shnEl.addEventListener('click', skipIntro);

function updateRun(now, dt) {
  const r = run, P = r.P;
  const Tspin = P.Ta + P.Tc + P.Td;
  const t = (now - r.t0) / 1000;
  let pos = r.p0, vel = 0, vFrac = 0, vig = 0, dolly = 0, light = 0.15, turns = 0.15;
  if (t < P.Tcharge) {
    const cp = t / P.Tcharge;
    while (r.lit < 7 && t >= (r.lit * P.Tcharge) / 7) { balls[r.lit].classList.add('lit'); audio.chime(r.lit); r.lit++; }
    const aT = Math.min(0.15, P.Tcharge), u = clamp((t - (P.Tcharge - aT)) / aT, 0, 1);
    pos = r.p0 - 0.4 * (1 - (1 - u) ** 3);
    vig = 0.2 * cp; dolly = 0.02 * cp; turns = 0.15 + 1.8 * cp; light = 0.15 + 0.15 * cp;
    boltsOn = !settings.calm && cp > 0.55;
  } else if (t < P.Tcharge + Tspin) {
    boltsOn = false;
    if (!r.launched) {
      r.launched = true; audio.whoosh(); audio.whirrStart(); vibrate(20);
      if (!settings.calm) flashEl.animate([{ opacity: 0 }, { opacity: 0.35, offset: 0.3 }, { opacity: 0 }], { duration: 160 });
    }
    const ts = t - P.Tcharge;
    pos = r.base + position(ts, P, r.vmax);
    vel = velocity(ts, P, r.vmax); vFrac = vel / r.vmax;
    const sus = clamp(vFrac / 0.25, 0, 1);
    if (ts < P.Ta) { vig = 0.2 + 0.1 * vFrac; dolly = 0.02; }
    else if (ts < P.Ta + P.Tc) { vig = 0.3; dolly = 0.02; }
    else { vig = vFrac > 0.25 ? 0.3 : lerp(0.6, 0.3, sus); dolly = 0.02 + 0.02 * (1 - sus); light = lerp(0.6, 0.15, sus); }
    turns = 0.15 + 2.35 * vFrac;
    if (vel < 1.5 && ts > P.Ta + P.Tc && now >= r.nextBeat) { audio.beat(); r.nextBeat = now + 60000 / lerp(60, 90, clamp((ts - (P.Ta + P.Tc)) / P.Td, 0, 1)); }
  } else {
    boltsOn = false; audio.whirrStop();
    const tl = t - P.Tcharge - Tspin, hold = P.Tlock * 0.5;
    if (!r.lockOn) { r.lockOn = true; lockbox.classList.add('on'); audio.lock(); }
    if (tl < hold) pos = r.target;
    else {
      let rem = dt;
      while (rem > 0) { const h = Math.min(rem, 0.008); const a = -220 * r.sx - 24 * r.sv; r.sv += a * h; r.sx += r.sv * h; rem -= h; }
      pos = r.T + r.sx;
    }
    vig = 0.6; dolly = 0.04; light = 0.6;
    if (tl >= P.Tlock && !r.done) { pos = r.T; r.done = true; render(r.strip, pos, 0, true); reveal(); return; }
  }
  render(r.strip, pos, settings.calm ? 0 : vFrac, true);

  // ticks : un à chaque bord de carte franchi sous le pointeur
  const idx = Math.floor(pos + 0.5);
  if (idx > r.lastIdx) {
    const last = r.done || (t >= P.Tcharge + Tspin - 1.6 && vel < 1);
    if (vel < 15) { if (last) audio.lastTick(); else audio.tick(vel); }
    if (vel < 6 && now - r.lastVib > 60) { vibrate(last ? 30 : 8); r.lastVib = now; }
    r.omega -= clamp(vel / 6, 0.15, 1) * (last ? 1.6 : 1) * 380;
    r.lastIdx = idx;
    if (strip(r)[idx]) oddsEl.textContent = strip(r)[idx].name;
  }
  // pointeur à bascule (ressort amorti)
  if (vel > 15) { r.theta = -35 + Math.sin(now / 40) * 3; r.omega = 0; }
  else { const a = -600 * r.theta - 18 * r.omega; r.omega += a * dt; r.theta = clamp(r.theta + r.omega * dt, -35, 35); }
  ptrs.forEach((p) => (p.style.transform = `rotate(${(p === ptrs[0] ? r.theta : -r.theta).toFixed(1)}deg)`));

  // son continu, lumières, caméra
  audio.whirrSet(settings.calm ? 0 : clamp((vel - 6) / 9, 0, 1) * 0.12, 400 + vFrac * 1800);
  updateBulbs(dt, turns);
  lightEl.style.setProperty('--la', light.toFixed(2));
  vignette.style.opacity = vig.toFixed(2);
  machine.style.transform = settings.calm ? '' : `scale(${(1 + dolly).toFixed(4)})`;
  const sigma = vFrac > 0.25 && !settings.calm ? 0.0025 * vel * pitch * clamp((vFrac - 0.25) / 0.35, 0, 1) : 0;
  stripEl.style.filter = sigma > 0.6 ? 'url(#mb)' : 'none';
  if (sigma > 0.6) $('#mbBlur').setAttribute('stdDeviation', `${sigma.toFixed(1)} 0`);
  streaksEl.style.opacity = settings.calm ? 0 : (clamp((vFrac - 0.25) / 0.5, 0, 1) * 0.85).toFixed(2);
}
const strip = (r) => r.strip;

function reveal() {
  state = 'reveal';
  const r = run, w = r.winner, el = live.get(r.T);
  audio.thud(); vibrate([40, 30, 80]);
  const rect = el ? el.getBoundingClientRect() : { left: innerWidth / 2 - cardW / 2, top: innerHeight / 2 - cardH / 2, width: cardW, height: cardH };
  const col = colorOf(w.owner), who = playerOf(w.owner);
  journal.add({ cardId: w.id, playerId: player.id }); // en attente jusqu'au résultat du combat ; le journal met à jour le tirage
  store.set('iz.pending', null);
  const go = () => {
    vignette.style.opacity = 0; streaksEl.style.opacity = 0; stripEl.style.filter = 'none'; machine.style.transform = '';
    overlay.hidden = false; overlay.style.setProperty('--accent', col); root.style.setProperty('--accent', col);
    const heroH = Math.min(innerHeight * 0.56, 470, innerWidth * 0.8 * 1.4), heroW = heroH / 1.4;
    const cx = innerWidth / 2, cy = innerHeight * 0.4;
    heroWrap.style.cssText = `left:${cx - heroW / 2}px;top:${cy - heroH / 2}px;width:${heroW}px;height:${heroH}px;--cw:${heroW}px`;
    heroWrap.innerHTML = `<div class="hero" style="--oc:${col};--h:${w.hue}">${faceHTML(w)}<div class="shine"></div></div>`;
    const dx = rect.left + rect.width / 2 - cx, dy = rect.top + rect.height / 2 - cy;
    heroWrap.firstChild.animate([{ transform: `translate(${dx}px,${dy}px) scale(${rect.width / heroW})` }, { transform: 'translate(0,0) scale(1)' }],
      { duration: settings.calm ? 300 : 700, easing: 'cubic-bezier(.34,1.56,.64,1)' });
    $('#bnName').textContent = w.name; $('#bnOwner').textContent = 'CARTE DE ' + who.name.toUpperCase();
    banner.style.top = cy + heroH / 2 + 12 + 'px'; banner.style.setProperty('--oc', col);
    setTimeout(() => banner.classList.add('in'), settings.calm ? 100 : 400);
    if (el) el.classList.add('gone');
    for (const [k, e] of live) if (k !== r.T) e.classList.add('dim');
    if (!settings.calm) {
      flashEl.animate([{ opacity: 0 }, { opacity: 0.55, offset: 0.13 }, { opacity: 0 }], { duration: 440 });
      const ring = document.createElement('div');
      ring.style.cssText = `position:fixed;left:${cx}px;top:${cy}px;width:24px;height:24px;margin:-12px;border:6px solid ${col};border-radius:50%;z-index:85;pointer-events:none;box-shadow:0 0 30px ${col}`;
      document.body.appendChild(ring);
      ring.animate([{ transform: 'scale(1)', opacity: 0.95 }, { transform: 'scale(110)', opacity: 0 }], { duration: 750, easing: 'cubic-bezier(.16,1,.3,1)' }).onfinish = () => ring.remove();
      stage.animate([0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ translate: `${(Math.random() - 0.5) * 16 * (1 - i / 8)}px ${(Math.random() - 0.5) * 16 * (1 - i / 8)}px` })), { duration: 400 });
      burst(cx, cy, col);
    }
    audio.fanfare(); setTimeout(() => audio.musicDuck(false), settings.calm ? 600 : 1500);
    setTimeout(() => actions.classList.add('in'), settings.calm ? 300 : 1200);
  };
  if (settings.calm) go(); else setTimeout(go, 120);
}

function backToIdle() {
  const inPool = new Set(pool.map((c) => c.id));
  const r = run, visible = r ? r.strip.slice(r.T - 4, r.T + 5).map((c) => (c && inPool.has(c.id) ? c : null)) : [];
  idle = makeIdle(pool, visible); idlePos = 300; clearLive();
  balls.forEach((b) => b.classList.remove('lit')); lockbox.classList.remove('on');
  ptrs.forEach((p) => (p.style.transform = '')); banner.classList.remove('in'); actions.classList.remove('in');
  overlay.hidden = true; heroWrap.innerHTML = ''; run = null; state = 'idle'; audio.musicDuck(false);
  goBtn.classList.remove('busy'); goBtn.disabled = false; chipBtns.forEach((c) => (c.disabled = false));
  oddsEl.textContent = `1 chance sur ${pool.length}`;
  root.style.setProperty('--accent', player ? player.color : '#FFD24A');
}
$('#again').addEventListener('click', () => { audio.click(); backToIdle(); });
$('#undo').addEventListener('click', () => {
  audio.click(); if (history[0]) journal.setStatus(history[0].id, 'void'); backToIdle(); toast('Dernier tirage annulé (rétablissable dans le journal)');
});
goBtn.addEventListener('click', invoke);

/* ───────────────────────── Réglages ───────────────────────── */
const panel = $('#panel');
$('#btn-gear').addEventListener('click', () => { panel.hidden = !panel.hidden; });
Object.entries(PROFILES).forEach(([key, P]) => {
  const b = document.createElement('button'); b.className = 'pill'; b.textContent = P.name; b.dataset.k = key;
  b.addEventListener('click', () => { settings.profile = key; saveSettings(); syncSettings(); });
  $('#profiles').appendChild(b);
});
$('#btn-snd').addEventListener('click', () => { settings.sound = !settings.sound; saveSettings(); audio.unlock(); if (!settings.sound) { audio.whirrStop(); audio.musicStop(); } else audio.musicStart(); syncSettings(); });
$('#btn-mus').addEventListener('click', () => { settings.music = !settings.music; saveSettings(); audio.unlock(); if (settings.music) audio.musicStart(); else audio.musicStop(); syncSettings(); });
$('#btn-intro').addEventListener('click', () => { settings.intro = !settings.intro; saveSettings(); syncSettings(); });
$('#btn-calm').addEventListener('click', () => { settings.calm = !settings.calm; saveSettings(); syncSettings(); });
$('#btn-log2').addEventListener('click', () => { panel.hidden = true; openJournal(); });
let decksT = 0;
$('#btn-decks').addEventListener('click', (e) => {
  const b = e.currentTarget;
  if (!b.classList.contains('warn')) { b.classList.add('warn'); b.textContent = 'Confirmer ?'; decksT = setTimeout(() => { b.classList.remove('warn'); b.textContent = 'Réinitialiser'; }, 3500); return; }
  clearTimeout(decksT); b.classList.remove('warn'); b.textContent = 'Réinitialiser';
  const k = journal.voidAll(); toast(k ? `Decks remis comme dans le document : ${k} tirage${k > 1 ? 's' : ''} annulé${k > 1 ? 's' : ''} (rétablissables dans le journal)` : 'Les decks sont déjà ceux du document');
});
function syncSettings() {
  document.body.classList.toggle('calm', settings.calm);
  $('#btn-snd').setAttribute('aria-pressed', String(settings.sound)); $('#btn-mus').setAttribute('aria-pressed', String(settings.music));
  $('#btn-intro').setAttribute('aria-pressed', String(settings.intro)); $('#btn-intro').textContent = settings.intro ? 'Activée' : 'Désactivée';
  $('#btn-calm').setAttribute('aria-pressed', String(settings.calm)); $('#btn-calm').textContent = settings.calm ? 'Activé' : 'Désactivé';
  document.querySelectorAll('#profiles .pill').forEach((b) => b.classList.toggle('on', b.dataset.k === settings.profile));
}
addEventListener('keydown', (e) => {
  if (!jEl.hidden) { if (e.key === 'Escape') closeJournal(); return; }
  if (!duel.hidden) { if (e.key === 'Escape') closeDuel(); return; }
  if (state === 'intro') { if ([' ', 'Enter', 'Escape'].includes(e.key)) skipIntro(); e.preventDefault(); return; }
  if (e.target.closest && e.target.closest('button') && e.key === 'Enter') return;
  if (e.key === ' ' || e.key === 'Enter') { if (!overlay.hidden) { $('#again').click(); } else invoke(); e.preventDefault(); }
  else if (e.key === 'm') $('#btn-snd').click();
  else if (['1', '2', '3'].includes(e.key) && PLAYERS[+e.key - 1]) selectPlayer(PLAYERS[+e.key - 1]);
  else if (e.key === 'Escape') panel.hidden = true;
});

/* ───────────────────────── Démarrage et boucle principale ───────────────────────── */
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (state === 'idle') {
    idlePos += (settings.calm ? 0.2 : 0.4) * dt;
    if (idlePos > 560) { const b = Math.floor(idlePos); idle = makeIdle(pool, idle.slice(b - 4, b + 5)); idlePos = 300 + (idlePos - b); clearLive(); }
    render(idle, idlePos, 0, false); updateBulbs(dt, 0.15);
  } else if (state === 'run') updateRun(now, dt);
  else if (state === 'intro') { updateIntro(dt); updateBulbs(dt, 0.4); }
  else updateBulbs(dt, 0.4);
  drawFx(dt);
  requestAnimationFrame(frame);
}
function boot() {
  syncSettings(); layout(); fxResize(); renderHistory(); updateDeckCounts();
  idle = makeIdle(CARDS);
  countEl.textContent = CARDS.length; $('.count small').textContent = `/ ${CARDS.length} cartes en jeu`;
  if (demo) $('#demo').hidden = false;
  const pend = store.get('iz.pending', null);
  if (pend && byId.has(pend.cardId)) { // tirage interrompu : le résultat était déjà enregistré, on ne retire pas
    journal.add({ cardId: pend.cardId, playerId: pend.playerId, ts: pend.ts }); store.set('iz.pending', null);
    toast('Résultat retrouvé après rechargement : ' + byId.get(pend.cardId).name);
  }
  preload(CARDS.slice(0, 0));
  if (!pend && journal.pendingCount()) toast(`⚔ ${journal.pendingCount()} combat${journal.pendingCount() > 1 ? 's' : ''} en attente : ouvre le journal 📜`);
  requestAnimationFrame(frame);
}
addEventListener('resize', () => { layout(); fxResize(); if (intro) shn.resize(); });
document.addEventListener('visibilitychange', () => audio.pause(document.hidden));
boot();
window.__iz = { state: () => state, invoke, selectPlayer, PLAYERS, settings, audio, history: () => history, journal, cardName: (id) => byId.get(id).name, owners: () => Object.fromEntries(CARDS.map((c) => [c.id, c.owner])), poolSize: () => pool.length,
  debugShenron: (t, k = 1, calm = false) => { shn.begin({ k, calm }); shnEl.hidden = false; shnEl.classList.add('on'); return shn.frame(t); } };
