'use strict';
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const PRESETS = {
  nuit:  { label: 'Nuit & Or',  bg: '#0b1220', panel: '#111b2e', text: '#f1f5f9', muted: '#8b9bb4', accent: '#e8b84b', font: 'Rajdhani', radius: 6,  opacity: 0.92 },
  neon:  { label: 'Néon',       bg: '#07040f', panel: '#140a2a', text: '#ffffff', muted: '#a78bfa', accent: '#22d3ee', font: 'Orbitron', radius: 2,  opacity: 0.9 },
  glace: { label: 'Glace',      bg: '#dfe8f5', panel: '#ffffff', text: '#0f172a', muted: '#64748b', accent: '#0ea5e9', font: 'Inter',    radius: 12, opacity: 0.95 },
  sang:  { label: 'Rouge sang', bg: '#120606', panel: '#1c0a0a', text: '#fff1f1', muted: '#c08a8a', accent: '#ef4444', font: 'Oswald',   radius: 0,  opacity: 0.93 },
};

// Description des overlays : blocs déplaçables (calques) et composants masquables.
// Sert à l'éditeur de style du panneau de contrôle.
const OVERLAY_DEFS = {
  scoreboard: { name: 'Scoreboard', blocks: { bar: 'Barre principale' },
    comps: { logo: 'Logos', name: 'Noms', pips: 'Score de série', gold: 'Or', towers: 'Tours', drakes: 'Dragons', diff: "Écart d'or", subline: 'Ligne tournoi' } },
  players: { name: 'Joueurs', blocks: { blue: 'Colonne bleue', red: 'Colonne rouge' },
    comps: { spells: 'Sorts', rune: 'Rune', kda: 'KDA', kp: 'Participation aux kills', items: 'Objets', cs: 'CS', gold: 'Or' } },
  objectives: { name: 'Objectifs', blocks: { timers: 'Timers', graph: "Graphique d'or", inhibs: 'Inhibiteurs' },
    comps: { dragon: 'Timer dragon', baron: 'Timer baron' } },
  champselect: { name: 'Champ select', blocks: { head: 'En-tête', status: "Bandeau d'état", blue: 'Côté bleu', red: 'Côté rouge' },
    comps: { bans: 'Bans', fearless: 'Fearless', playernames: 'Noms des joueurs', timer: 'Timer', phase: 'Phase' } },
  series: { name: 'Carte de série', blocks: { card: 'Carte' },
    comps: { tournament: 'Tournoi', logos: 'Logos', meta: 'Format / manche' } },
  killfeed: { name: 'Kill feed', blocks: { feed: 'Liste des kills' }, comps: { names: 'Pseudos', assists: 'Assistances' } },
  announcer: { name: 'Annonceur', blocks: { banner: 'Bannière' }, comps: { sub: 'Sous-titre' } },
  postgame: { name: 'Post-game', blocks: { card: 'Carte de stats' }, comps: { graph: "Graphique d'or", totals: 'Totaux équipes', kp: 'Participation aux kills' } },
  lframe: { name: 'Cadre L', blocks: { left: 'Panneau gauche', bottom: 'Barre du bas' }, comps: { sponsor: 'Sponsor', casters: 'Commentateurs', ticker: 'Bandeau défilant', series: 'Score de série' } },
  bracket: { name: 'Bracket / programme', blocks: { bracket: 'Tableau' }, comps: { title: 'Titre' } },
};

const OVERLAY_IDS = Object.keys(OVERLAY_DEFS);

// Ordre de draft tournoi standard (20 étapes)
const B = 'blue';
const R = 'red';
const DRAFT_ORDER = [
  [B, 'ban'], [R, 'ban'], [B, 'ban'], [R, 'ban'], [B, 'ban'], [R, 'ban'],
  [B, 'pick'], [R, 'pick'], [R, 'pick'], [B, 'pick'], [B, 'pick'], [R, 'pick'],
  [R, 'ban'], [B, 'ban'], [R, 'ban'], [B, 'ban'],
  [R, 'pick'], [B, 'pick'], [B, 'pick'], [R, 'pick'],
].map(([side, type]) => ({ side, type }));

const emptySide = () => ({ bans: Array(5).fill(null), picks: Array(5).fill(null) });

function defaults() {
  const visibility = {};
  OVERLAY_IDS.forEach((id) => { visibility[id] = id === 'scoreboard' || id === 'objectives'; });
  return {
    settings: {
      dataSource: 'sim', // live | sim | none
      simSpeed: 5,
      draftSource: 'manual', // manual | lcu
      lcuLockfile: '',
      draftTimer: 30,
      objectives: { dragonFirst: 300, dragonRespawn: 300, baronFirst: 1200, baronRespawn: 360, inhibRespawn: 300 },
      theme: { preset: 'nuit', ...PRESETS.nuit },
      styles: {}, // { [overlayId]: { blocks:{[id]:{x,y,scale,visible}}, hide:[], css:'', banner:{image}, colors/font... } }
      announcer: {
        duration: 4,
        kinds: { firstblood: true, multikill: true, ace: true, dragon: true, baron: true, herald: true, inhib: true, turret: false, grub: false },
      },
      lframe: { leftWidth: 380, bottomHeight: 150, caster1: '', caster2: '', ticker: 'Bienvenue sur le stream !', sponsor: '', background: '' },
    },
    teams: [
      { id: 't1', name: 'Équipe Bleue', tag: 'BLU', color: '#3b82f6', logo: '', banner: '', players: ['Top', 'Jungle', 'Mid', 'ADC', 'Support'] },
      { id: 't2', name: 'Équipe Rouge', tag: 'RED', color: '#ef4444', logo: '', banner: '', players: ['Top', 'Jungle', 'Mid', 'ADC', 'Support'] },
    ],
    match: { id: 'm1', round: 'Match 1', blueTeamId: 't1', redTeamId: 't2', bestOf: 3, blueWins: 0, redWins: 0, game: 1, tournament: 'Ma Ligue — Saison 1', lastWinner: null },
    schedule: [{ id: 'm1', round: 'Match 1', blueTeamId: 't1', redTeamId: 't2', bestOf: 3, blueWins: 0, redWins: 0, game: 1 }],
    visibility,
    draft: { order: DRAFT_ORDER, step: 0, blue: emptySide(), red: emptySide(), fearless: { blue: [], red: [] }, timerEnd: 0 },
    // --- runtime (non persisté) ---
    game: null,
    lastGame: null,
    status: { source: 'sim', live: 'idle', lcu: 'idle', message: '' },
    ddragon: { version: null, runes: {} },
    presets: PRESETS,
    overlayDefs: OVERLAY_DEFS,
  };
}

const PERSIST = ['settings', 'teams', 'match', 'schedule', 'visibility', 'draft'];
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

function isPlain(x) {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

function merge(a, b) {
  if (!isPlain(b)) return b;
  const out = isPlain(a) ? { ...a } : {};
  for (const k of Object.keys(b)) {
    if (FORBIDDEN.has(k)) continue;
    out[k] = merge(out[k], b[k]);
  }
  return out;
}

class Store extends EventEmitter {
  constructor(dir) {
    super();
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'state.json');
    this.state = defaults();
    this._load();
    this._saveTimer = null;
  }

  _load() {
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const k of PERSIST) if (saved[k] !== undefined) this.state[k] = merge(this.state[k], saved[k]);
    } catch (_) { /* première exécution */ }
    this.state.draft.order = DRAFT_ORDER;
    this.state.settings.theme.preset = this.state.settings.theme.preset || 'nuit';
    // cohérence : le match actif doit exister dans le programme
    const s = this.state;
    if (!s.match.id) s.match.id = 'm1';
    if (!s.schedule.find((m) => m.id === s.match.id)) {
      s.schedule.unshift({ id: s.match.id, round: s.match.round || 'Match', blueTeamId: s.match.blueTeamId, redTeamId: s.match.redTeamId, bestOf: s.match.bestOf, blueWins: s.match.blueWins, redWins: s.match.redWins, game: s.match.game });
    }
  }

  /** Modifie l'état puis notifie. persist=false pour les données runtime (jeu, statuts). */
  mutate(fn, { persist = true } = {}) {
    fn(this.state);
    this.emit('change', this.state);
    if (persist) this._scheduleSave();
  }

  patch(section, value) {
    this.mutate((s) => { s[section] = merge(s[section], value); });
  }

  _scheduleSave() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.saveNow(), 400);
  }

  persisted() {
    const out = {};
    for (const k of PERSIST) out[k] = this.state[k];
    return out;
  }

  saveNow() {
    clearTimeout(this._saveTimer);
    try {
      fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.persisted(), null, 2));
      fs.renameSync(this.file + '.tmp', this.file);
    } catch (e) {
      console.error('Sauvegarde impossible :', e.message);
    }
  }
}

module.exports = { Store, DRAFT_ORDER, PRESETS, OVERLAY_DEFS, OVERLAY_IDS, PERSIST, emptySide, merge };
