'use strict';
const { fetchLive, buildGame } = require('./liveclient');
const { Simulator } = require('./simulator');
const { LcuProvider } = require('./lcu');
const { loadChampions } = require('./ddragon');
const { DRAFT_ORDER, OVERLAY_IDS, emptySide } = require('./state');

const NONE = '__none';
const MATCH_FIELDS = ['round', 'blueTeamId', 'redTeamId', 'bestOf', 'blueWins', 'redWins', 'game'];

class Engine {
  constructor(store, dataDir) {
    this.store = store;
    this.dataDir = dataDir;
    this.champions = { version: null, list: [], runes: {}, source: 'none' };
    this.keyToId = new Map();
    this.mem = {};
    this.failures = 0;
    this.providerKey = '';
    this.lcu = new LcuProvider({
      getLockfile: () => this.store.state.settings.lcuLockfile,
      getKeyMap: () => this.keyToId,
      onDraft: (d) => this.applyLcuDraft(d),
      onStatus: (msg) => this.setStatus({ lcu: msg }),
    });
  }

  async init() {
    this.champions = await loadChampions(this.dataDir);
    this.keyToId = new Map(this.champions.list.filter((c) => c.key).map((c) => [String(c.key), c.id]));
    this.store.mutate((s) => { s.ddragon.version = this.champions.version; s.ddragon.runes = this.champions.runes || {}; }, { persist: false });
    this.applyProviders();
    this.store.on('change', () => {
      const k = this.keyFor();
      if (k !== this.providerKey) this.applyProviders();
    });
  }

  keyFor() {
    const s = this.store.state.settings;
    return `${s.dataSource}|${s.draftSource}|${s.lcuLockfile}`;
  }

  setStatus(patch) {
    const cur = this.store.state.status;
    if (Object.keys(patch).every((k) => cur[k] === patch[k])) return;
    this.store.mutate((s) => Object.assign(s.status, patch), { persist: false });
  }

  stop() {
    clearInterval(this.liveTimer);
    clearInterval(this.simTimer);
    this.lcu.stop();
  }

  applyProviders() {
    this.stop();
    this.providerKey = this.keyFor();
    const s = this.store.state.settings;
    this.mem = {};
    this.failures = 0;
    if (s.dataSource === 'live') {
      this.setStatus({ source: 'live', live: 'waiting' });
      this.liveTimer = setInterval(() => this.pollLive(), 1000);
      this.pollLive();
    } else if (s.dataSource === 'sim') {
      this.sim = new Simulator();
      this.setStatus({ source: 'sim', live: 'sim' });
      this.simTimer = setInterval(() => {
        this.sim.tick(this.store.state.settings.simSpeed);
        this.pushGame(this.sim.payload());
      }, 1000);
    } else {
      this.store.mutate((st) => { st.game = null; st.status.source = 'none'; st.status.live = 'idle'; }, { persist: false });
    }
    if (s.draftSource === 'lcu') this.lcu.start();
    else this.setStatus({ lcu: 'idle' });
  }

  pushGame(payload) {
    const game = buildGame(payload, this.mem, this.store.state.settings.objectives);
    this.store.mutate((s) => {
      s.game = game;
      // Mémorise la dernière partie jouée (pour l'overlay post-game).
      if (game.time >= 30) s.lastGame = game;
    }, { persist: false });
  }

  async pollLive() {
    try {
      this.pushGame(await fetchLive());
      this.failures = 0;
      this.setStatus({ live: 'connected' });
    } catch (_) {
      if (++this.failures >= 3) {
        this.mem = {};
        this.setStatus({ live: 'waiting' });
        if (this.store.state.game) this.store.mutate((s) => { s.game = null; }, { persist: false });
      }
    }
  }

  applyLcuDraft(d) {
    this.store.mutate((s) => {
      for (const side of ['blue', 'red']) {
        s.draft[side].bans = d[side].bans;
        s.draft[side].picks = d[side].picks;
      }
      s.draft.step = Math.min(DRAFT_ORDER.length, [...d.blue.bans, ...d.red.bans, ...d.blue.picks, ...d.red.picks].filter(Boolean).length);
      s.draft.timerEnd = d.timerEnd;
    });
  }

  // ---------------------------------------------------------------- actions
  action(name, a = {}) {
    const fn = this['do_' + name];
    if (!fn) throw new Error('Action inconnue : ' + name);
    fn.call(this, a);
  }

  /** Recopie le match actif dans son entrée du programme. */
  static writeBack(s) {
    const e = s.schedule.find((m) => m.id === s.match.id);
    if (e) for (const k of MATCH_FIELDS) e[k] = s.match[k];
  }

  static loadEntry(s, id) {
    const e = s.schedule.find((m) => m.id === id);
    if (!e) return;
    for (const k of MATCH_FIELDS) s.match[k] = e[k];
    s.match.id = e.id;
    s.match.lastWinner = null;
  }

  do_matchWin({ side }) {
    this.store.mutate((s) => {
      const m = s.match;
      const need = Math.ceil(m.bestOf / 2);
      const key = side === 'blue' ? 'blueWins' : 'redWins';
      if (m[key] < need) m[key]++;
      m.lastWinner = side;
      m.game = Math.min(m.bestOf, m.blueWins + m.redWins + 1);
    });
  }

  do_matchAdjust({ side, delta }) {
    this.store.mutate((s) => {
      const key = side === 'blue' ? 'blueWins' : 'redWins';
      s.match[key] = Math.max(0, Math.min(Math.ceil(s.match.bestOf / 2), s.match[key] + (delta > 0 ? 1 : -1)));
    });
  }

  do_matchSwap() {
    this.store.mutate((s) => {
      const m = s.match;
      [m.blueTeamId, m.redTeamId] = [m.redTeamId, m.blueTeamId];
      [m.blueWins, m.redWins] = [m.redWins, m.blueWins];
    });
  }

  do_matchReset() {
    this.store.mutate((s) => {
      Object.assign(s.match, { blueWins: 0, redWins: 0, game: 1, lastWinner: null });
      s.draft.fearless = { blue: [], red: [] };
    });
  }

  // ----- programme des matchs
  do_scheduleSelect({ id }) {
    this.store.mutate((s) => { Engine.writeBack(s); Engine.loadEntry(s, id); s.draft.fearless = { blue: [], red: [] }; });
  }

  do_scheduleAdd({ round }) {
    this.store.mutate((s) => {
      Engine.writeBack(s);
      const ids = s.teams.map((t) => t.id);
      const id = 'm' + Date.now().toString(36);
      s.schedule.push({
        id, round: round || `Match ${s.schedule.length + 1}`,
        blueTeamId: ids[0], redTeamId: ids[1] || ids[0], bestOf: s.match.bestOf, blueWins: 0, redWins: 0, game: 1,
      });
      Engine.loadEntry(s, id);
      s.draft.fearless = { blue: [], red: [] };
    });
  }

  do_scheduleDelete({ id }) {
    this.store.mutate((s) => {
      if (s.schedule.length <= 1) return;
      Engine.writeBack(s);
      s.schedule = s.schedule.filter((m) => m.id !== id);
      if (s.match.id === id) Engine.loadEntry(s, s.schedule[0].id);
    });
  }

  do_scheduleUpdate({ id, patch }) {
    this.store.mutate((s) => {
      const allowed = ['round', 'blueTeamId', 'redTeamId', 'bestOf', 'blueWins', 'redWins'];
      const clean = {};
      for (const k of allowed) if (patch && patch[k] !== undefined) clean[k] = patch[k];
      if (s.match.id === id) Object.assign(s.match, clean);
      const e = s.schedule.find((m) => m.id === id);
      if (e) Object.assign(e, clean);
    });
  }

  // ----- thèmes / styles
  do_themePreset({ name }) {
    this.store.mutate((s) => {
      const p = s.presets[name];
      if (p) s.settings.theme = { preset: name, ...p };
    });
  }

  do_styleReset({ overlay }) {
    if (!OVERLAY_IDS.includes(overlay)) return;
    this.store.mutate((s) => { s.settings.styles[overlay] = {}; });
  }

  do_allVisibility({ value }) {
    this.store.mutate((s) => { for (const k of Object.keys(s.visibility)) s.visibility[k] = !!value; });
  }

  do_toggleOverlay({ id }) {
    this.store.mutate((s) => { if (id in s.visibility) s.visibility[id] = !s.visibility[id]; });
  }

  do_captureGame() {
    this.store.mutate((s) => { if (s.game) s.lastGame = s.game; }, { persist: false });
  }

  // ----- champ select manuel
  do_draftPick({ id }) {
    this.store.mutate((s) => {
      const d = s.draft;
      if (d.step >= DRAFT_ORDER.length) return;
      const { side, type } = DRAFT_ORDER[d.step];
      const arr = d[side][type + 's'];
      const idx = arr.indexOf(null);
      if (idx === -1) return;
      if (id === NONE && type !== 'ban') return;
      const used = [...d.blue.bans, ...d.blue.picks, ...d.red.bans, ...d.red.picks];
      if (id !== NONE && used.includes(id)) return;
      arr[idx] = id;
      d.step++;
      if (d.timerEnd > 0) d.timerEnd = Date.now() + s.settings.draftTimer * 1000;
    });
  }

  do_draftUndo() {
    this.store.mutate((s) => {
      const d = s.draft;
      if (d.step <= 0) return;
      d.step--;
      const { side, type } = DRAFT_ORDER[d.step];
      const arr = d[side][type + 's'];
      for (let i = arr.length - 1; i >= 0; i--) if (arr[i] !== null) { arr[i] = null; break; }
    });
  }

  do_draftClear({ side, type, index }) {
    this.store.mutate((s) => {
      const arr = s.draft[side]?.[type + 's'];
      if (arr && index >= 0 && index < 5) arr[index] = null;
    });
  }

  do_draftSwap({ side, i, j }) {
    this.store.mutate((s) => {
      const arr = s.draft[side]?.picks;
      if (!arr || !(i >= 0 && i < 5 && j >= 0 && j < 5)) return;
      [arr[i], arr[j]] = [arr[j], arr[i]];
    });
  }

  do_draftReset() {
    this.store.mutate((s) => {
      s.draft.step = 0;
      s.draft.blue = emptySide();
      s.draft.red = emptySide();
      s.draft.timerEnd = 0;
    });
  }

  /** Fearless : archive les picks de la manche, puis prépare un nouveau draft. */
  do_draftNextGame() {
    this.store.mutate((s) => {
      const d = s.draft;
      for (const side of ['blue', 'red']) {
        d.fearless[side] = [...new Set([...d.fearless[side], ...d[side].picks.filter((x) => x && x !== NONE)])];
        d[side] = emptySide();
      }
      d.step = 0;
      d.timerEnd = 0;
    });
  }

  do_draftClearFearless() {
    this.store.mutate((s) => { s.draft.fearless = { blue: [], red: [] }; });
  }

  do_draftTimer({ run }) {
    this.store.mutate((s) => {
      s.draft.timerEnd = run ? Date.now() + s.settings.draftTimer * 1000 : 0;
    });
  }
}

module.exports = { Engine };
