'use strict';
// Lecture (en lecture seule) du champ select via le client LoL (LCU).
// Meilleur effort : fonctionne quand le client expose une session de champ select (ex. partie perso).
const fs = require('fs');
const https = require('https');

const CANDIDATES = [
  'C:\\Riot Games\\League of Legends\\lockfile',
  'D:\\Riot Games\\League of Legends\\lockfile',
  '/Applications/League of Legends.app/Contents/LoL/lockfile',
];

function readLockfile(custom) {
  const paths = [custom, ...CANDIDATES].filter(Boolean);
  for (const p of paths) {
    try {
      const [, , port, password, protocol] = fs.readFileSync(p, 'utf8').trim().split(':');
      return { port, password, protocol };
    } catch (_) { /* suivant */ }
  }
  return null;
}

function request(lock, path) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { host: '127.0.0.1', port: lock.port, path, method: 'GET', auth: 'riot:' + lock.password, rejectUnauthorized: false, timeout: 1500 },
      (res) => {
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => {
          if (res.statusCode === 404) return resolve(null);
          if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
          try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end();
  });
}

const pad5 = (arr) => { const o = arr.slice(0, 5); while (o.length < 5) o.push(null); return o; };

/** Convertit une session LCU en { blue:{bans,picks}, red:{bans,picks}, timerEnd } (ids Data Dragon). */
function mapSession(session, keyToId) {
  const idOf = (k) => (k > 0 ? keyToId.get(String(k)) || null : null);
  const mySide = (session.myTeam?.[0]?.team ?? 1) === 1 ? 'blue' : 'red';
  const other = mySide === 'blue' ? 'red' : 'blue';
  const out = { blue: { bans: [], picks: [] }, red: { bans: [], picks: [] } };
  out[mySide].bans = (session.bans?.myTeamBans || []).map(idOf).filter(Boolean);
  out[other].bans = (session.bans?.theirTeamBans || []).map(idOf).filter(Boolean);
  out[mySide].picks = (session.myTeam || []).map((p) => idOf(p.championId)).filter(Boolean);
  out[other].picks = (session.theirTeam || []).map((p) => idOf(p.championId)).filter(Boolean);
  for (const s of ['blue', 'red']) { out[s].bans = pad5(out[s].bans); out[s].picks = pad5(out[s].picks); }
  const left = session.timer?.adjustedTimeLeftInPhase;
  out.timerEnd = left > 0 ? Date.now() + left : 0;
  return out;
}

class LcuProvider {
  constructor({ getLockfile, getKeyMap, onDraft, onStatus }) {
    Object.assign(this, { getLockfile, getKeyMap, onDraft, onStatus });
    this.timer = null;
  }

  start() {
    this.stop();
    const poll = async () => {
      const lock = readLockfile(this.getLockfile());
      if (!lock) return this.onStatus('Client LoL introuvable (lockfile)');
      try {
        const session = await request(lock, '/lol-champ-select/v1/session');
        if (!session) return this.onStatus('Client connecté — pas de champ select en cours');
        this.onStatus('Champ select détecté');
        this.onDraft(mapSession(session, this.getKeyMap()));
      } catch (e) {
        this.onStatus('Erreur client LoL : ' + e.message);
      }
    };
    poll();
    this.timer = setInterval(poll, 1000);
  }

  stop() { clearInterval(this.timer); this.timer = null; }
}

module.exports = { LcuProvider, mapSession };
