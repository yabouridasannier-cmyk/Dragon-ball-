// data.js — charge cards.json s'il existe, sinon 239 cartes PROVISOIRES.

const DEFAULT_PLAYERS = [
  { id: 'J1', name: 'Joueur 1', color: '#FF8A1F', stars: 1 },
  { id: 'J2', name: 'Joueur 2', color: '#2EA8FF', stars: 2 },
  { id: 'J3', name: 'Joueur 3', color: '#B45CFF', stars: 3 },
];

function placeholderCards(players) {
  return Array.from({ length: 239 }, (_, i) => {
    const id = i + 1;
    return {
      id,
      name: 'CARTE N° ' + String(id).padStart(3, '0'),
      owner: players[i % 3].id, // 80 / 80 / 79
      hue: (id * 37) % 360,
      img: null,
    };
  });
}

export async function loadData() {
  const inline = typeof window !== 'undefined' && window.__IZ_DATA__; // données intégrées à la page (version privée)
  if (inline && Array.isArray(inline.cards) && inline.cards.length) {
    const cards = inline.cards.map((c) => ({ hue: (c.id * 37) % 360, img: null, ...c }));
    return { players: inline.players || DEFAULT_PLAYERS, cards, demo: false, asOf: inline.asOf || 0 };
  }
  try {
    const res = await fetch('cards.json', { cache: 'no-cache' });
    if (res.ok) {
      const d = await res.json();
      if (d && Array.isArray(d.cards) && d.cards.length > 0) {
        const players = d.players && d.players.length ? d.players : DEFAULT_PLAYERS;
        const cards = d.cards.map((c) => ({ hue: (c.id * 37) % 360, img: null, ...c }));
        return { players, cards, demo: false, asOf: d.asOf || 0 };
      }
    }
  } catch (e) { /* pas de fichier : mode provisoire */ }
  return { players: DEFAULT_PLAYERS, cards: placeholderCards(DEFAULT_PLAYERS), demo: true, asOf: 0 };
}
