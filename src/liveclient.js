'use strict';
const https = require('https');

const LIVE_URL = 'https://127.0.0.1:2999/liveclientdata/allgamedata';

/** GET JSON (le certificat de la Live Client API est auto-signé par Riot). */
function fetchLive(url = LIVE_URL, timeout = 1500) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { rejectUnauthorized: false, timeout }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
  });
}

const POS_ORDER = { TOP: 0, JUNGLE: 1, MIDDLE: 2, BOTTOM: 3, UTILITY: 4 };
const LANES = { L: 'TOP', C: 'MID', R: 'BOT' };

const emptyTeam = () => ({ kills: 0, gold: 0, towers: 0, inhibs: 0, dragons: [], barons: 0, heralds: 0, grubs: 0 });
const sideOfTeamNum = (n) => (String(n) === '1' ? 'blue' : 'red');
const spellId = (s) => /SummonerSpell_(\w+?)_DisplayName/.exec(s?.rawDisplayName || '')?.[1] || null;

/**
 * Transforme la réponse /allgamedata de la Live Client API en un objet "game" simple.
 * - L'or est ESTIMÉ (valeur des objets possédés) : l'API ne donne pas l'or total des autres joueurs.
 * - `mem` conserve l'historique d'écart d'or entre deux appels.
 */
function buildGame(all, mem, obj) {
  const t = Math.max(0, all.gameData?.gameTime || 0);
  mem.history = mem.history || [];
  if (mem.last !== undefined && t < mem.last - 3) { mem.history = []; mem.lastSample = undefined; }
  mem.last = t;

  const infoOfName = new Map(); // pseudo -> { side, champion, name }
  const players = { blue: [], red: [] };
  for (const p of all.allPlayers || []) {
    const side = p.team === 'ORDER' ? 'blue' : 'red';
    const gold = (p.items || []).reduce((a, i) => a + (i.price || 0) * (i.count || 1), 0);
    const champion = (p.rawChampionName || '').replace('game_character_displayname_', '') || p.championName;
    const info = { side, champion };
    [p.riotIdGameName, p.summonerName, p.riotId].filter(Boolean).forEach((n) => infoOfName.set(n, info));
    players[side].push({
      name: p.riotIdGameName || p.summonerName || '?',
      champion,
      championName: p.championName,
      position: p.position || '',
      level: p.level || 1,
      kills: p.scores?.kills || 0,
      deaths: p.scores?.deaths || 0,
      assists: p.scores?.assists || 0,
      cs: p.scores?.creepScore || 0,
      gold,
      dead: !!p.isDead,
      respawn: p.respawnTimer || 0,
      items: (p.items || []).filter((i) => i.itemID > 0).sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0)).map((i) => ({ id: i.itemID, count: i.count || 1 })),
      spells: [spellId(p.summonerSpells?.summonerSpellOne), spellId(p.summonerSpells?.summonerSpellTwo)].filter(Boolean),
      rune: p.runes?.keystone ? { id: p.runes.keystone.id, name: p.runes.keystone.displayName } : null,
      kp: 0,
    });
  }
  for (const side of ['blue', 'red']) {
    if (players[side].length && players[side].every((p) => p.position in POS_ORDER)) {
      players[side].sort((a, b) => POS_ORDER[a.position] - POS_ORDER[b.position]);
    }
  }

  const T = { blue: emptyTeam(), red: emptyTeam() };
  for (const side of ['blue', 'red']) {
    T[side].kills = players[side].reduce((a, p) => a + p.kills, 0);
    T[side].gold = players[side].reduce((a, p) => a + p.gold, 0);
    players[side].forEach((p) => { p.kp = T[side].kills ? Math.min(100, Math.round(((p.kills + p.assists) / T[side].kills) * 100)) : 0; });
  }

  let lastDragon = null;
  let lastBaron = null;
  const feed = [];
  const downInhibs = [];
  const champ = (name) => infoOfName.get(name)?.champion || null;
  for (const e of all.events?.Events || []) {
    const ki = infoOfName.get(e.KillerName);
    const killerSide = ki?.side;
    const base = { id: e.EventID, t: e.EventTime };
    switch (e.EventName) {
      case 'DragonKill':
        if (killerSide) T[killerSide].dragons.push(e.DragonType || 'Fire');
        lastDragon = e.EventTime;
        feed.push({ ...base, kind: 'dragon', side: killerSide || null, dragon: e.DragonType || 'Fire' });
        break;
      case 'BaronKill':
        if (killerSide) T[killerSide].barons++;
        lastBaron = e.EventTime;
        feed.push({ ...base, kind: 'baron', side: killerSide || null });
        break;
      case 'HeraldKill':
        if (killerSide) T[killerSide].heralds++;
        feed.push({ ...base, kind: 'herald', side: killerSide || null });
        break;
      case 'HordeKill':
        if (killerSide) T[killerSide].grubs++;
        feed.push({ ...base, kind: 'grub', side: killerSide || null });
        break;
      case 'TurretKilled': {
        const m = /_T(\d)_(\w)/.exec(e.TurretKilled || '');
        if (m) {
          const lostSide = sideOfTeamNum(m[1]);
          const gainSide = lostSide === 'blue' ? 'red' : 'blue';
          T[gainSide].towers++;
          feed.push({ ...base, kind: 'turret', side: gainSide, lane: LANES[m[2]] || '' });
        }
        break;
      }
      case 'InhibKilled': {
        const m = /_T(\d)_(\w)/.exec(e.InhibKilled || '');
        if (m) {
          const lostSide = sideOfTeamNum(m[1]);
          const gainSide = lostSide === 'blue' ? 'red' : 'blue';
          T[gainSide].inhibs++;
          const lane = LANES[m[2]] || '';
          feed.push({ ...base, kind: 'inhib', side: gainSide, lane });
          const respawnIn = Math.ceil(e.EventTime + (obj.inhibRespawn || 300) - t);
          if (respawnIn > 0) downInhibs.push({ side: lostSide, lane, respawnIn });
        }
        break;
      }
      case 'ChampionKill': {
        const vi = infoOfName.get(e.VictimName);
        feed.push({
          ...base, kind: 'kill', side: killerSide || null,
          killer: e.KillerName, killerChamp: ki?.champion || null,
          victim: e.VictimName, victimChamp: vi?.champion || null, victimSide: vi?.side || null,
          assists: (e.Assisters || []).map(champ).filter(Boolean),
        });
        break;
      }
      case 'FirstBlood':
        feed.push({ ...base, kind: 'firstblood', side: infoOfName.get(e.Recipient)?.side || null, who: e.Recipient, champ: champ(e.Recipient) });
        break;
      case 'Multikill':
        feed.push({ ...base, kind: 'multikill', side: killerSide || null, who: e.KillerName, champ: champ(e.KillerName), streak: e.KillStreak || 2 });
        break;
      case 'Ace':
        feed.push({ ...base, kind: 'ace', side: e.AcingTeam === 'ORDER' ? 'blue' : e.AcingTeam === 'CHAOS' ? 'red' : (infoOfName.get(e.Acer)?.side || null) });
        break;
      case 'GameEnd':
        feed.push({ ...base, kind: 'gameend', result: e.Result || '' });
        break;
      default:
    }
  }

  const dNext = lastDragon == null ? obj.dragonFirst : lastDragon + obj.dragonRespawn;
  const bNext = lastBaron == null ? obj.baronFirst : lastBaron + obj.baronRespawn;
  const objectives = {
    dragon: { alive: t >= dNext, spawnIn: Math.max(0, Math.ceil(dNext - t)) },
    baron: { alive: t >= bNext, spawnIn: Math.max(0, Math.ceil(bNext - t)) },
  };

  if (mem.lastSample === undefined || t - mem.lastSample >= 10) {
    mem.history.push({ t: Math.round(t), d: T.blue.gold - T.red.gold });
    mem.lastSample = t;
    if (mem.history.length > 400) mem.history.shift();
  }

  return {
    time: Math.floor(t),
    mode: all.gameData?.gameMode || '',
    ended: feed.some((f) => f.kind === 'gameend'),
    blue: { ...T.blue, players: players.blue },
    red: { ...T.red, players: players.red },
    objectives,
    inhibs: downInhibs,
    goldHistory: mem.history.slice(),
    feed: feed.slice(-24),
  };
}

module.exports = { fetchLive, buildGame };
