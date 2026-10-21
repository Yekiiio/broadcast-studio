'use strict';
// Liste des champions via Riot Data Dragon (images officielles hébergées par Riot).
// Cache disque + liste de secours embarquée si l'ordinateur est hors ligne.
const fs = require('fs');
const path = require('path');

const FALLBACK_IDS = `Aatrox Ahri Akali Akshan Alistar Ambessa Amumu Anivia Annie Aphelios Ashe AurelionSol Aurora Azir Bard Belveth Blitzcrank Brand Braum Briar Caitlyn Camille Cassiopeia Chogath Corki Darius Diana Draven DrMundo Ekko Elise Evelynn Ezreal Fiddlesticks Fiora Fizz Galio Gangplank Garen Gnar Gragas Graves Gwen Hecarim Heimerdinger Hwei Illaoi Irelia Ivern Janna JarvanIV Jax Jayce Jhin Jinx Kaisa Kalista Karma Karthus Kassadin Katarina Kayle Kayn Kennen Khazix Kindred Kled KogMaw KSante Leblanc LeeSin Leona Lillia Lissandra Lucian Lulu Lux Malphite Malzahar Maokai MasterYi Mel Milio MissFortune MonkeyKing Mordekaiser Morgana Naafiri Nami Nasus Nautilus Neeko Nidalee Nilah Nocturne Nunu Olaf Orianna Ornn Pantheon Poppy Pyke Qiyana Quinn Rakan Rammus RekSai Rell RenataGlasc Renekton Rengar Riven Rumble Ryze Samira Sejuani Senna Seraphine Sett Shaco Shen Shyvana Singed Sion Sivir Skarner Smolder Sona Soraka Swain Sylas Syndra TahmKench Taliyah Talon Taric Teemo Thresh Tristana Trundle Tryndamere TwistedFate Twitch Udyr Urgot Varus Vayne Veigar Velkoz Vex Vi Viego Viktor Vladimir Volibear Warwick Xayah Xerath XinZhao Yasuo Yone Yorick Yunara Yuumi Zaahir Zac Zed Zeri Ziggs Zilean Zoe Zyra`.split(/\s+/);

const SPECIAL_NAMES = {
  AurelionSol: 'Aurelion Sol', Belveth: "Bel'Veth", Chogath: "Cho'Gath", DrMundo: 'Dr. Mundo', JarvanIV: 'Jarvan IV',
  Kaisa: "Kai'Sa", Khazix: "Kha'Zix", KogMaw: "Kog'Maw", KSante: "K'Sante", Leblanc: 'LeBlanc', LeeSin: 'Lee Sin',
  MasterYi: 'Maître Yi', MissFortune: 'Miss Fortune', MonkeyKing: 'Wukong', RekSai: "Rek'Sai", RenataGlasc: 'Renata Glasc',
  TahmKench: 'Tahm Kench', TwistedFate: 'Twisted Fate', Velkoz: "Vel'Koz", XinZhao: 'Xin Zhao', Fiddlesticks: 'Fiddlesticks',
};

function fallbackList() {
  return FALLBACK_IDS.map((id) => ({ id, key: null, name: SPECIAL_NAMES[id] || id }));
}

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(7000) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

/** Retourne { version, list:[{id,key,name}], source } */
async function loadChampions(dataDir) {
  const cacheFile = path.join(dataDir, 'champions.json');
  try {
    const versions = await getJson('https://ddragon.leagueoflegends.com/api/versions.json');
    const version = versions[0];
    const data = await getJson(`https://ddragon.leagueoflegends.com/cdn/${version}/data/fr_FR/champion.json`);
    const list = Object.values(data.data)
      .map((c) => ({ id: c.id, key: c.key, name: c.name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    let runes = {};
    try {
      const trees = await getJson(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/runesReforged.json`);
      for (const tree of trees) for (const slot of tree.slots) for (const r of slot.runes) runes[r.id] = r.icon;
    } catch (_) { runes = {}; }
    const out = { version, list, runes, source: 'online' };
    try { fs.writeFileSync(cacheFile, JSON.stringify(out)); } catch (_) { /* ignore */ }
    return out;
  } catch (_) {
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      return { ...cached, source: 'cache' };
    } catch (_) {
      return { version: null, list: fallbackList(), runes: {}, source: 'fallback' };
    }
  }
}

module.exports = { loadChampions };
