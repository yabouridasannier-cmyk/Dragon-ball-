// journal.js — journal des combats : TOUTES les invocations, gardées pour toujours.
// Les decks ne sont pas stockés : ils se déduisent du journal (propriétaire d'origine + dernier combat gagné de chaque carte).
// Rien n'est jamais supprimé : « annuler » marque l'entrée « void », on peut la rétablir.
// Sauvegarde : navigateur (localStorage) + base en ligne de l'artefact quand elle est disponible (window.claude.use('db')).

const GAP = 4 * 3600 * 1000; // plus de 4 h sans tirage : nouvelle session
const uid = () => Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7); // segment de chemin valide
export const STATUSES = ['pending', 'won', 'lost', 'void'];
const valid = (e) => e && typeof e.id === 'string' && /^[A-Za-z0-9_.~:@+-]{1,120}$/.test(e.id) && Number.isFinite(e.ts) && Number.isInteger(e.cardId)
  && typeof e.playerId === 'string' && STATUSES.includes(e.status);
const clean = (e) => ({ id: e.id, ts: e.ts, session: e.session ?? e.ts, playerId: e.playerId, cardId: e.cardId, from: e.from ?? null, status: e.status, upd: e.upd ?? e.ts, ...(e.note ? { note: String(e.note).slice(0, 200) } : {}) });

export function createJournal({ cards, store, claudeApi }) {
  const origin = new Map(cards.map((c) => [c.id, c.owner]));
  const log = new Map();
  const listeners = new Set();
  const info = { mode: 'local', storage: true, remoteCount: 0, error: '' }; // mode : local | cloud | cloud-read
  let session = store.get('iz.session', null);

  const emit = () => listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
  const saveLocal = () => { store.set('iz.log', [...log.values()]); };
  try { localStorage.setItem('iz.probe', '1'); info.storage = localStorage.getItem('iz.probe') === '1'; } catch { info.storage = false; }

  // ── Chargement et migration des versions précédentes (iz.history + iz.owners) ───────────────
  (function load() {
    const saved = store.get('iz.log', null);
    if (Array.isArray(saved)) { saved.filter(valid).forEach((e) => log.set(e.id, clean(e))); return; }
    const old = store.get('iz.history', []), owners = store.get('iz.owners', {});
    let sess = 0, prev = 0;
    [...old].filter((h) => h && Number.isFinite(h.ts) && origin.has(h.cardId)).sort((a, b) => a.ts - b.ts).forEach((h, i) => {
      if (!sess || h.ts - prev > GAP) sess = h.ts; prev = h.ts;
      const e = clean({ id: `m${h.ts.toString(36)}-${i}`, ts: h.ts, session: sess, playerId: h.playerId, cardId: h.cardId, from: h.from || origin.get(h.cardId), status: STATUSES.includes(h.status) ? h.status : 'lost', note: 'repris de l’ancienne version' });
      log.set(e.id, e);
    });
    const derived = ownerMap();
    for (const [cid, who] of Object.entries(owners || {})) { // decks déjà modifiés mais sans entrée correspondante
      const id = +cid; if (!origin.has(id) || derived.get(id) === who) continue;
      const e = clean({ id: `mo-${id}`, ts: 1, session: 1, playerId: who, cardId: id, from: origin.get(id), status: 'won', note: 'deck repris de l’ancienne version' });
      log.set(e.id, e);
    }
    if (log.size) saveLocal();
  })();

  // ── Lecture ────────────────────────────────────────────────────────────────────────────────
  function sorted(dir = -1) { return [...log.values()].sort((a, b) => dir * (a.ts - b.ts) || dir * a.id.localeCompare(b.id)); }
  function ownerMap() { // décks déduits du journal
    const m = new Map(origin);
    for (const e of sorted(1)) if (e.status === 'won' && m.has(e.cardId)) m.set(e.cardId, e.playerId);
    return m;
  }
  const pendingIds = () => new Set([...log.values()].filter((e) => e.status === 'pending').map((e) => e.cardId));
  const pendingCount = () => [...log.values()].filter((e) => e.status === 'pending').length;
  function currentSession() { // session en cours : celle du dernier tirage tant qu'il date de moins de 4 h
    if (session && Date.now() - session.ts <= GAP) return session.id;
    const last = sorted(-1)[0];
    return last && Date.now() - last.ts <= GAP ? last.session : null;
  }
  const current = () => { const s = currentSession(); return s == null ? [] : sorted(-1).filter((e) => e.session === s && e.status !== 'void'); };

  // ── Écriture ───────────────────────────────────────────────────────────────────────────────
  function touchSession(ts) {
    const cur = currentSession();
    session = cur != null ? { id: cur, ts } : { id: ts, ts };
    store.set('iz.session', session);
    return session.id;
  }
  function put(e, notify = true) {
    log.set(e.id, e); saveLocal(); pushRemote(e);
    if (notify) emit();
  }
  function add({ cardId, playerId, status = 'pending', ts = Date.now(), from, note }) {
    const e = clean({ id: uid(), ts, session: touchSession(ts), playerId, cardId, from: from ?? ownerMap().get(cardId), status, upd: Date.now(), note });
    put(e); return e;
  }
  function setStatus(id, status) {
    const e = log.get(id); if (!e || !STATUSES.includes(status) || e.status === status) return e;
    const n = { ...e, status, upd: Math.max(Date.now(), e.upd + 1) }; put(n); return n;
  }
  function newSession() { const ts = Date.now(); session = { id: ts, ts }; store.set('iz.session', session); emit(); }
  function voidAll() { const now = Date.now(); let k = 0; for (const e of log.values()) if (e.status !== 'void') { log.set(e.id, { ...e, status: 'void', upd: Math.max(now, e.upd + 1), note: e.note || 'décks réinitialisés' }); pushRemote(log.get(e.id)); k++; } saveLocal(); emit(); return k; }

  // ── Sauvegarde manuelle ────────────────────────────────────────────────────────────────────
  const exportJSON = () => JSON.stringify({ app: 'invocation-z', v: 1, exportedAt: new Date().toISOString(), entries: sorted(1) }, null, 1);
  function importJSON(text) {
    let data; try { data = JSON.parse(text); } catch { throw new Error('Ce texte n’est pas une sauvegarde valide.'); }
    const list = Array.isArray(data) ? data : data && data.entries;
    if (!Array.isArray(list)) throw new Error('Aucune entrée trouvée dans cette sauvegarde.');
    let added = 0, updated = 0, bad = 0;
    for (const raw of list) {
      if (!valid(raw) || !origin.has(raw.cardId)) { bad++; continue; }
      const e = clean(raw), cur = log.get(e.id);
      if (!cur) { log.set(e.id, e); pushRemote(e); added++; } else if (e.upd > cur.upd) { log.set(e.id, e); pushRemote(e); updated++; }
    }
    saveLocal(); emit(); return { added, updated, bad };
  }

  // ── Base en ligne (facultative) ────────────────────────────────────────────────────────────
  let coll = null, writing = Promise.resolve(), snapshotSeen = false;
  const queue = new Map(); // id → dernière version à écrire
  function pushRemote(e) {
    if (!coll || info.mode !== 'cloud') return;
    queue.set(e.id, e);
    writing = writing.then(async () => {
      for (const [id, v] of [...queue]) {
        queue.delete(id);
        try { await coll.doc(id).set(v); }
        catch (err) {
          if (err && err.code === 'unavailable') { await new Promise((r) => setTimeout(r, 1200 + Math.random() * 800)); try { await coll.doc(id).set(v); continue; } catch { /* abandon */ } }
          if (err && (err.code === 'invalid_argument' || err.code === 'revoked' || err.code === 'not_granted')) { info.mode = 'cloud-read'; queue.clear(); }
          info.error = (err && err.code) || 'erreur'; emit(); return;
        }
      }
    });
  }
  function onRemote(snap) {
    let changed = false; info.remoteCount = snap.size;
    for (const d of snap.docs) {
      const raw = d.data(); if (!valid(raw) || !origin.has(raw.cardId)) continue;
      const e = clean(raw), cur = log.get(e.id);
      if (!cur || e.upd > cur.upd) { log.set(e.id, e); changed = true; }
    }
    const first = !snapshotSeen;
    if (changed) saveLocal();
    if (!snapshotSeen) { // première réception : envoie ce que le navigateur a et que la base n'a pas encore
      snapshotSeen = true;
      const have = new Map(snap.docs.map((d) => [d.id, d.data() && d.data().upd]));
      for (const e of log.values()) if (!have.has(e.id) || have.get(e.id) < e.upd) pushRemote(e);
    }
    if (changed || first) emit();
  }
  async function connect() {
    try {
      if (!claudeApi || typeof claudeApi.use !== 'function') return;
      const db = await claudeApi.use('db'); if (!db) return;
      coll = db.collection('log'); info.mode = 'cloud';
      coll.onSnapshot(onRemote, (err) => { info.error = (err && err.code) || 'erreur'; if (err && err.code === 'revoked') info.mode = 'local'; emit(); });
      emit();
    } catch { /* base indisponible : on reste en local */ }
  }
  connect();

  return {
    add, setStatus, newSession, voidAll, exportJSON, importJSON,
    entries: sorted, current, ownerMap, pendingIds, pendingCount, currentSession,
    originOf: (id) => origin.get(id), info: () => ({ ...info, count: log.size }),
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
