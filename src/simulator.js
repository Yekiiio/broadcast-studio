'use strict';
// Simule une partie en produisant des données au format de la Live Client API (/allgamedata).
// Permet de créer et tester ses overlays sans lancer le jeu.

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ROSTER = {
  ORDER: [['Atlas', 'Aatrox', 'TOP'], ['Nomad', 'Viego', 'JUNGLE'], ['Vexa', 'Ahri', 'MIDDLE'], ['Rook', 'Jinx', 'BOTTOM'], ['Lumen', 'Thresh', 'UTILITY']],
  CHAOS: [['Kairo', 'Gnar', 'TOP'], ['Ember', 'LeeSin', 'JUNGLE'], ['Zephyr', 'Syndra', 'MIDDLE'], ['Onyx', 'Kaisa', 'BOTTOM'], ['Mira', 'Nautilus', 'UTILITY']],
};
const DRAGONS = ['Fire', 'Earth', 'Water', 'Air', 'Hextech', 'Chemtech'];
const SPELLS = { TOP: 'SummonerTeleport', JUNGLE: 'SummonerSmite', MIDDLE: 'SummonerDot', BOTTOM: 'SummonerHeal', UTILITY: 'SummonerExhaust' };
const RUNES = [[8112, 'Électrocution'], [8010, 'Conquérant'], [8005, 'Toucher Fatal'], [8437, 'Poigne de l\'Immortel'], [8229, 'Comète arcanique']];
const ITEMS = [[3006, 1100], [1055, 450], [3078, 3333], [3031, 3400], [3089, 3600], [3157, 3000], [6672, 3200], [3153, 3200], [3004, 2900], [3111, 1100], [3047, 1100], [3020, 1100]];

class Simulator {
  constructor() { this.reset(); }

  reset() {
    this.rng = mulberry32((Date.now() % 1e9) | 0);
    this.t = 0;
    this.bias = 0;
    this.eid = 0;
    this.events = [{ EventID: this.eid++, EventName: 'GameStart', EventTime: 0 }];
    this.nextDragon = 300;
    this.nextBaron = 1200;
    this.nextTower = 540;
    this.towers = { ORDER: 0, CHAOS: 0 };
    this.inhibs = { ORDER: 0, CHAOS: 0 };
    this.firstBlood = false;
    this.lastKill = null;
    this.players = [];
    for (const team of ['ORDER', 'CHAOS']) {
      ROSTER[team].forEach(([name, champ, position], i) => {
        const build = [];
        for (let k = 0; k < 6; k++) build.push(ITEMS[Math.floor(this.rng() * ITEMS.length)]);
        this.players.push({ name, champ, position, team, kills: 0, deaths: 0, assists: 0, cs: 0, gold: 500, build, rune: RUNES[i % RUNES.length] });
      });
    }
  }

  pick(arr) { return arr[Math.floor(this.rng() * arr.length)]; }

  tick(speed = 1) { for (let i = 0; i < Math.max(1, speed); i++) this.step(); }

  ev(e) { this.events.push({ EventID: this.eid++, ...e }); }

  step() {
    this.t++;
    if (this.t > 2100) return this.reset();
    this.bias = Math.max(-6, Math.min(6, this.bias + (this.rng() - 0.5) * 0.5));
    for (const p of this.players) {
      if (this.rng() < 0.38) p.cs++;
      const lead = (p.team === 'ORDER' ? 1 : -1) * this.bias;
      p.gold += 6 + this.t * 0.011 + lead * 0.25 + this.rng() * 2;
    }
    const winner = () => (this.rng() < 0.5 + this.bias / 14 ? 'ORDER' : 'CHAOS');

    if (this.t > 80 && this.rng() < 1 / 22) {
      const kt = this.lastKill && this.t - this.lastKill.t < 9 && this.rng() < 0.6 ? this.lastKill.team : winner();
      const killer = this.lastKill && this.lastKill.team === kt && this.t - this.lastKill.t < 9 ? this.lastKill.p : this.pick(this.players.filter((p) => p.team === kt));
      const victim = this.pick(this.players.filter((p) => p.team !== kt));
      killer.kills++; victim.deaths++; killer.gold += 300;
      const helpers = this.players.filter((p) => p.team === kt && p !== killer && this.rng() < 0.6);
      helpers.forEach((h) => h.assists++);
      this.ev({ EventName: 'ChampionKill', EventTime: this.t, KillerName: killer.name, VictimName: victim.name, Assisters: helpers.map((h) => h.name) });
      if (!this.firstBlood) { this.firstBlood = true; this.ev({ EventName: 'FirstBlood', EventTime: this.t, Recipient: killer.name }); }
      if (this.lastKill && this.lastKill.p === killer && this.t - this.lastKill.t < 9) {
        killer.streak = (killer.streak || 1) + 1;
        this.ev({ EventName: 'Multikill', EventTime: this.t, KillerName: killer.name, KillStreak: Math.min(5, killer.streak) });
      } else killer.streak = 1;
      this.lastKill = { t: this.t, p: killer, team: kt };
    }
    if (this.t >= this.nextDragon && this.rng() < 0.08) {
      const kt = winner();
      this.ev({ EventName: 'DragonKill', EventTime: this.t, DragonType: this.pick(DRAGONS), KillerName: this.pick(this.players.filter((p) => p.team === kt)).name });
      this.nextDragon = this.t + 300;
    }
    if (this.t >= this.nextBaron && this.rng() < 0.03) {
      const kt = winner();
      this.ev({ EventName: 'BaronKill', EventTime: this.t, KillerName: this.pick(this.players.filter((p) => p.team === kt)).name });
      this.nextBaron = this.t + 360;
    }
    if (this.t >= this.nextTower) {
      const kt = winner();
      const lostTeam = kt === 'ORDER' ? 2 : 1;
      const n = this.towers[kt]++;
      const killer = this.pick(this.players.filter((p) => p.team === kt)).name;
      if (n < 9) this.ev({ EventName: 'TurretKilled', EventTime: this.t, KillerName: killer, TurretKilled: `Turret_T${lostTeam}_${'LCR'[n % 3]}_0${(n % 9) + 1}_A` });
      if (n >= 3 && this.inhibs[kt] < 3) this.ev({ EventName: 'InhibKilled', EventTime: this.t, KillerName: killer, InhibKilled: `Barracks_T${lostTeam}_${'LCR'[this.inhibs[kt]++ % 3]}1` });
      this.nextTower = this.t + 90 + Math.floor(this.rng() * 80);
    }
  }

  itemsOf(p) {
    let left = p.gold;
    const items = [];
    p.build.forEach(([id, price], slot) => {
      if (left >= price * 1.1 && items.length < 6) { items.push({ itemID: id, price, count: 1, slot }); left -= price; }
    });
    // reste d'or : un "objet" fictif (id 0) pour que l'estimation d'or suive la progression
    items.push({ itemID: 0, price: Math.round(left), count: 1, slot: 9 });
    return items;
  }

  payload() {
    return {
      allPlayers: this.players.map((p) => ({
        championName: p.champ,
        rawChampionName: 'game_character_displayname_' + p.champ,
        isDead: false,
        level: Math.min(18, 1 + Math.floor(this.t / 110)),
        position: p.position,
        riotIdGameName: p.name,
        summonerName: p.name,
        team: p.team,
        respawnTimer: 0,
        scores: { kills: p.kills, deaths: p.deaths, assists: p.assists, creepScore: p.cs, wardScore: 0 },
        items: this.itemsOf(p),
        summonerSpells: {
          summonerSpellOne: { rawDisplayName: 'GeneratedTip_SummonerSpell_SummonerFlash_DisplayName' },
          summonerSpellTwo: { rawDisplayName: `GeneratedTip_SummonerSpell_${SPELLS[p.position]}_DisplayName` },
        },
        runes: { keystone: { id: p.rune[0], displayName: p.rune[1] } },
      })),
      events: { Events: this.events },
      gameData: { gameMode: 'CLASSIC', gameTime: this.t },
    };
  }
}

module.exports = { Simulator };
