// engine.js — logique pure (aucun accès au DOM). Formules : PRD sections 4 et 8.

export const PROFILES = {
  eclair:    { name: 'Éclair',    Tcharge: 0.2, Ta: 0.3, Tc: 0.4, Td: 1.4, Tlock: 0.3, Treveal: 1.0, travel: 26,  n: 3.0 },
  rapide:    { name: 'Rapide',    Tcharge: 0.6, Ta: 0.5, Tc: 0.8, Td: 2.6, Tlock: 0.4, Treveal: 1.6, travel: 46,  n: 3.0 },
  spectacle: { name: 'Spectacle', Tcharge: 1.4, Ta: 0.9, Tc: 1.6, Td: 4.8, Tlock: 0.7, Treveal: 2.4, travel: 86,  n: 3.5 },
  epique:    { name: 'Épique',    Tcharge: 2.2, Ta: 1.1, Tc: 2.4, Td: 7.5, Tlock: 1.0, Treveal: 3.2, travel: 125, n: 4.0 },
};

// Entier uniforme dans [0, n), générateur sûr, sans biais de modulo.
export function randomInt(n) {
  const limit = 2 ** 32 - (2 ** 32 % n);
  const buf = new Uint32Array(1);
  do { crypto.getRandomValues(buf); } while (buf[0] >= limit);
  return buf[0] % n;
}
export const rand01 = () => randomInt(1_000_000) / 1_000_000;

// Distance parcourue (en cartes) t secondes après le début de l'accélération.
export function position(t, p, vmax) {
  const { Ta, Tc, Td, n } = p;
  if (t <= 0) return 0;
  if (t < Ta) {
    const u = t / Ta;
    return vmax * Ta * (u ** 3 - u ** 4 / 2);
  }
  const Da = 0.5 * vmax * Ta;
  if (t < Ta + Tc) return Da + vmax * (t - Ta);
  const Dc = vmax * Tc;
  const Dd = (vmax * Td) / n;
  const w = Math.min((t - Ta - Tc) / Td, 1);
  return Da + Dc + Dd * (1 - (1 - w) ** n);
}

export function velocity(t, p, vmax) {
  const { Ta, Tc, Td, n } = p;
  if (t <= 0) return 0;
  if (t < Ta) { const u = t / Ta; return vmax * (3 * u * u - 2 * u ** 3); }
  if (t < Ta + Tc) return vmax;
  const w = Math.min((t - Ta - Tc) / Td, 1);
  return vmax * (1 - w) ** (n - 1);
}

// Vitesse maximale qui fait s'arrêter le ruban exactement à D cartes.
export const vmaxFor = (D, p) => D / (0.5 * p.Ta + p.Tc + p.Td / p.n);

// Pool du joueur : toutes les cartes sauf les siennes.
export const buildPool = (cards, playerId) => cards.filter((c) => c.owner !== playerId);

// Ruban : N cartes tirées du pool, gagnante à l'index T, jamais de doublon proche.
export function buildStrip(pool, winner, T, N, head = []) {
  const strip = new Array(N);
  const recent = [];
  const gap = Math.min(12, Math.max(0, pool.length - 2));
  const pick = (noWinner) => {
    for (let tries = 0; tries < 60; tries++) {
      const c = pool[randomInt(pool.length)];
      if (recent.includes(c.id)) continue;
      if (noWinner && c.id === winner.id) continue;
      return c;
    }
    return pool[randomInt(pool.length)];
  };
  for (let i = 0; i < N; i++) {
    const c = i === T ? winner : i < head.length ? head[i] : pick(Math.abs(i - T) <= 12);
    strip[i] = c;
    recent.push(c.id);
    if (recent.length > gap) recent.shift();
  }
  return strip;
}
