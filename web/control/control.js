'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let S = null;
let champs = { version: null, list: [], source: '' };
let champSearch = '';
let styleSel = 'scoreboard';
let customInfo = { dir: '', files: [] };

const OVERLAYS = [
  { id: 'scoreboard', name: 'Scoreboard', desc: 'Barre du haut : équipes, kills, or, tours, dragons, chrono, score de série' },
  { id: 'players', name: 'Joueurs', desc: 'Colonnes latérales : champion, sorts, rune, KDA, KP, CS, or, objets' },
  { id: 'objectives', name: 'Objectifs & écart d\'or', desc: 'Timers dragon / baron, inhibiteurs, graphique d\'avance en or' },
  { id: 'champselect', name: 'Champ select', desc: 'Picks, bans, fearless, timer et phase du draft' },
  { id: 'series', name: 'Carte de série', desc: 'Score de la série entre deux manches (BO1 / BO3 / BO5)' },
  { id: 'killfeed', name: 'Kill feed', desc: 'Liste des kills en direct avec icônes des champions' },
  { id: 'announcer', name: 'Annonceur', desc: 'Bannières : premier sang, multikills, ace, dragon, baron, tourelles…' },
  { id: 'postgame', name: 'Post-game', desc: 'Statistiques de fin de partie, totaux et graphique d\'or' },
  { id: 'lframe', name: 'Cadre L', desc: 'Panneau gauche + barre du bas : sponsor, commentateurs, bandeau défilant' },
  { id: 'bracket', name: 'Bracket / programme', desc: 'Tableau des matchs par phase avec scores' },
];
const FONTS = ['Rajdhani', 'Oswald', 'Inter', 'Orbitron'];
const ROLES = ['Top', 'Jungle', 'Mid', 'ADC', 'Support'];
const KIND_LABELS = { firstblood: 'Premier sang', multikill: 'Multikills', ace: 'Ace', dragon: 'Dragons', baron: 'Baron', herald: 'Héraut', grub: 'Larves du Vide', turret: 'Tourelles', inhib: 'Inhibiteurs' };

// ------------------------------------------------------------------ API
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  .then((r) => r.json()).then((j) => { if (j.error) toast(j.error); return j; }).catch(() => toast('Serveur injoignable'));
const api = {
  set: (section, data) => post('/api/set', { section, data }),
  act: (name, args = {}) => post('/api/action', { name, args }),
};
function nest(path, value) {
  const parts = path.split('.');
  const obj = {};
  let cur = obj;
  parts.slice(1).forEach((p, i, a) => { cur[p] = i === a.length - 1 ? value : (cur[p] = {}); cur = cur[p]; });
  return [parts[0], obj];
}
const setPath = (path, value) => api.set(...nest(path, value));
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 2200);
}

// ------------------------------------------------------------------ helpers
const teamName = (id) => S.teams.find((t) => t.id === id)?.name || '—';
const teamColor = (id, fb) => S.teams.find((t) => t.id === id)?.color || fb;
const square = (id) => (id && id !== '__none' && S.ddragon.version ? `https://ddragon.leagueoflegends.com/cdn/${S.ddragon.version}/img/champion/${id}.png` : '');
const cname = (id) => (id === '__none' ? 'Aucun ban' : (champs.list.find((c) => c.id === id)?.name || id || ''));
const fmtT = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const schedule = () => S.schedule.map((e) => (e.id === S.match.id ? { ...e, ...S.match } : e));
const teamOpts = (sel) => S.teams.map((t) => `<option value="${esc(t.id)}" ${t.id === sel ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
const switchEl = (path, on) => `<label class="sw"><input type="checkbox" data-bind="${path}" ${on ? 'checked' : ''}><span></span></label>`;

// ------------------------------------------------------------------ rendu
const fp = {};
let renderQueued = false;
function focusIn(sel) {
  const a = document.activeElement;
  return a && a.matches?.('input,select,textarea') && a.closest(sel) && a.id !== 'champsearch';
}
function maybe(key, sel, val, fn) {
  const s = JSON.stringify(val);
  if (fp[key] === s) return;
  if (focusIn(sel)) return; // on ne détruit pas un champ en cours d'édition
  fp[key] = s;
  fn();
}
function render() {
  if (!S) return;
  renderQueued = false;
  const on = $('#conn'); on.textContent = 'Connecté'; on.className = 'pill';
  maybe('dash', '#dash-main', [S.match, S.schedule, S.visibility, S.settings.dataSource, S.settings.simSpeed, S.teams.map((t) => [t.id, t.name])], renderDash);
  updateStatus();
  maybe('teams', '#tab-teams', S.teams, renderTeams);
  maybe('draft', '#draft-main', [S.draft, S.settings.draftSource, S.settings.draftTimer, S.visibility.champselect, S.status.lcu, S.teams.map((t) => t.name), S.ddragon.version], renderDraft);
  maybe('grid', '#draft-grid-card', [usedIds(), champSearch, champs.list.length, S.ddragon.version, S.settings.draftSource], renderGrid);
  maybe('style', '#style-main', [styleSel, S.settings.styles[styleSel] || {}, S.settings.theme], renderStyle);
  maybe('theme', '#theme-main', S.settings.theme, renderTheme);
  maybe('settings', '#tab-settings', [S.settings.objectives, S.settings.lcuLockfile, S.settings.announcer, S.settings.lframe, customInfo], renderSettings);
}
function queueRender() { if (!renderQueued) { renderQueued = true; requestAnimationFrame(render); } }

// --- tableau de bord
function renderDash() {
  const m = S.match, st = S.settings;
  const bo = (cur) => [1, 3, 5].map((n) => `<option value="${n}" ${cur === n ? 'selected' : ''}>BO${n}</option>`).join('');
  $('#dash-main').innerHTML = `
    <h2>Tableau de bord</h2><p class="sub">Pilote ton broadcast : match, source de données et overlays.</p>
    <div class="grid2">
      <div class="card"><h3>Match en cours</h3>
        <div class="row"><label>Équipe bleue</label><select data-bind="match.blueTeamId">${teamOpts(m.blueTeamId)}</select></div>
        <div class="row"><label>Équipe rouge</label><select data-bind="match.redTeamId">${teamOpts(m.redTeamId)}</select></div>
        <div class="row"><label>Format</label><select data-bind="match.bestOf" data-type="number">${bo(m.bestOf)}</select></div>
        <div class="row"><label>Tournoi</label><input data-bind="match.tournament" value="${esc(m.tournament)}"></div>
        <div class="row"><label>Phase / round</label><input data-bind="match.round" value="${esc(m.round || '')}" placeholder="Quart de finale, Poule A…"></div>
        <div class="row"><label>Manche n°</label><input type="number" min="1" max="9" data-bind="match.game" data-type="number" value="${m.game}" style="max-width:90px;flex:none"></div>
        <div class="score">
          <div><div class="t" style="color:${teamColor(m.blueTeamId, '#3b82f6')}">${esc(teamName(m.blueTeamId))}</div><div class="n">${m.blueWins}</div>
            <div class="ctl"><button class="btn sm" data-act="matchAdjust" data-args='{"side":"blue","delta":-1}'>−</button><button class="btn sm" data-act="matchAdjust" data-args='{"side":"blue","delta":1}'>+</button></div></div>
          <div class="n" style="color:var(--muted)">–</div>
          <div><div class="t" style="color:${teamColor(m.redTeamId, '#ef4444')}">${esc(teamName(m.redTeamId))}</div><div class="n">${m.redWins}</div>
            <div class="ctl"><button class="btn sm" data-act="matchAdjust" data-args='{"side":"red","delta":-1}'>−</button><button class="btn sm" data-act="matchAdjust" data-args='{"side":"red","delta":1}'>+</button></div></div>
        </div>
        <div class="btns">
          <button class="btn blue" data-act="matchWin" data-args='{"side":"blue"}'>Manche gagnée : Bleu</button>
          <button class="btn red" data-act="matchWin" data-args='{"side":"red"}'>Manche gagnée : Rouge</button>
          <button class="btn" data-act="matchSwap">⇄ Inverser les côtés</button>
          <button class="btn danger" data-act="matchReset">Remettre la série à zéro</button>
        </div>
      </div>
      <div class="card"><h3>Données de jeu</h3>
        <div class="seg" style="margin-bottom:12px">
          ${[['live', 'Partie réelle'], ['sim', 'Démo'], ['none', 'Aucune']].map(([v, l]) => `<button class="${st.dataSource === v ? 'on' : ''}" data-act="set" data-args='{"section":"settings","data":{"dataSource":"${v}"}}'>${l}</button>`).join('')}
        </div>
        <div style="margin-bottom:12px"><span id="dstatus" class="pill"></span></div>
        ${st.dataSource === 'sim' ? `<div class="row"><label>Vitesse démo</label><select data-bind="settings.simSpeed" data-type="number">${[1, 5, 20, 60].map((n) => `<option value="${n}" ${st.simSpeed === n ? 'selected' : ''}>×${n}</option>`).join('')}</select></div>` : ''}
        <div class="btns" style="margin-bottom:10px"><button class="btn sm" data-act="captureGame">Capturer la partie pour le post-game</button></div>
        <p class="note">« Partie réelle » lit la Live Client API de Riot (disponible automatiquement pendant une partie, y compris en spectateur). L'or affiché est une <b>estimation</b> basée sur la valeur des objets. « Démo » simule une partie pour régler tes overlays sans lancer le jeu.</p>
      </div>
    </div>
    <div class="card" style="margin-top:16px"><h3>Programme des matchs <span class="note">— passe d'un match à l'autre ; alimente l'overlay Bracket</span></h3>
      ${schedule().map((e) => `<div class="sched ${e.id === m.id ? 'on' : ''}">
        <input data-sched="${esc(e.id)}" data-field="round" value="${esc(e.round || '')}" placeholder="Phase">
        <select data-sched="${esc(e.id)}" data-field="blueTeamId">${teamOpts(e.blueTeamId)}</select><b>${e.blueWins} – ${e.redWins}</b>
        <select data-sched="${esc(e.id)}" data-field="redTeamId">${teamOpts(e.redTeamId)}</select>
        <select data-sched="${esc(e.id)}" data-field="bestOf" data-type="number">${bo(e.bestOf)}</select>
        ${e.id === m.id ? '<span class="pill">En cours</span>' : `<button class="btn sm" data-act="scheduleSelect" data-args='{"id":"${esc(e.id)}"}'>Charger</button>`}
        <button class="btn sm danger" ${S.schedule.length <= 1 ? 'disabled' : ''} data-act="scheduleDelete" data-args='{"id":"${esc(e.id)}"}'>✕</button></div>`).join('')}
      <div class="btns"><button class="btn pri" data-act="scheduleAdd" data-args="{}">+ Ajouter un match</button></div>
    </div>
    <div class="card" style="margin-top:16px"><h3>Overlays <span class="note">— à ajouter dans OBS via « Source navigateur », taille 1920×1080</span></h3>
      ${OVERLAYS.map((o, i) => `<div class="ov">
        ${switchEl('visibility.' + o.id, S.visibility[o.id])}
        <div><b>${o.name}</b> <span class="note">Ctrl+Alt+${(i + 1) % 10}</span><small>${o.desc}</small></div>
        <code>/overlays/${o.id}.html</code>
        <button class="btn sm" data-act="copy" data-args='{"id":"${o.id}"}'>Copier l'URL</button></div>`).join('')}
      <div class="btns"><button class="btn sm" data-act="allVisibility" data-args='{"value":true}'>Tout afficher</button><button class="btn sm" data-act="allVisibility" data-args='{"value":false}'>Tout masquer</button></div>
    </div>`;
}
function updateStatus() {
  const el = $('#dstatus'); if (!el) return;
  const st = S.status, g = S.game;
  let cls = 'pill', txt = '';
  if (S.settings.dataSource === 'live') {
    if (st.live === 'connected' && g) txt = `Connecté à la partie — ${fmtT(g.time)}`;
    else { cls += ' wait'; txt = 'En attente d\'une partie… (la Live Client API démarre avec la partie)'; }
  } else if (S.settings.dataSource === 'sim') txt = `Démo en cours — ${g ? fmtT(g.time) : '0:00'}`;
  else { cls += ' off'; txt = 'Aucune donnée de jeu'; }
  el.className = cls; el.textContent = txt;
}

// --- aperçus
function buildPreviews(container, ids) {
  container.innerHTML = '<div class="prev">' + ids.map((id) => `<div class="box"><iframe src="/overlays/${id}.html?preview=1" loading="lazy" title="${id}"></iframe><span class="cap">${esc(OVERLAYS.find((o) => o.id === id).name)}</span></div>`).join('') + '</div>';
  fitPreviews();
}
function fitPreviews() {
  $$('.prev .box, .editbox').forEach((b) => { const w = b.clientWidth; const f = $('iframe', b); if (w && f) f.style.transform = `scale(${w / 1920})`; });
}
window.addEventListener('resize', fitPreviews);

// --- équipes
function renderTeams() {
  $('#teams-main').innerHTML = S.teams.map((t, i) => `
    <div class="card team-card">
      <div><div class="logo">${t.logo ? `<img src="${esc(t.logo)}" alt="">` : `<span style="font-size:30px;font-weight:700;color:${esc(t.color)}">${esc((t.tag || '?').slice(0, 3))}</span>`}</div>
        <div class="actions"><button class="btn sm" data-act="uploadImage" data-args='{"team":${i},"field":"logo"}'>Choisir un logo</button>
        ${t.logo ? `<button class="btn sm" data-act="clearTeamImage" data-args='{"i":${i},"field":"logo"}'>Retirer</button>` : ''}</div></div>
      <div class="fields">
        <label>Nom<input data-team="${i}" data-field="name" value="${esc(t.name)}"></label>
        <label>Tag (3-4 lettres)<input data-team="${i}" data-field="tag" maxlength="4" value="${esc(t.tag)}"></label>
        <label>Couleur<input type="color" data-team="${i}" data-field="color" value="${esc(t.color)}"></label>
      </div>
      <div></div>
      <div class="fields" style="grid-template-columns:repeat(5,1fr)">
        ${ROLES.map((r, k) => `<label>${r}<input data-team="${i}" data-field="player" data-pi="${k}" value="${esc(t.players[k] || '')}" placeholder="Pseudo"></label>`).join('')}
      </div>
      <div></div>
      <div class="bannerrow">
        <div class="bprev" ${t.banner ? `style="background-image:url('${esc(t.banner)}')"` : ''}>${t.banner ? '' : 'Aucune bannière'}</div>
        <div class="actions" style="flex-direction:row;margin:0"><button class="btn sm" data-act="uploadImage" data-args='{"team":${i},"field":"banner"}'>Bannière d'équipe…</button>
        ${t.banner ? `<button class="btn sm" data-act="clearTeamImage" data-args='{"i":${i},"field":"banner"}'>Retirer</button>` : ''}
        ${S.teams.length > 1 ? `<button class="btn sm danger" data-act="delTeam" data-args='{"i":${i}}'>Supprimer l'équipe</button>` : ''}</div>
        <span class="note">Image de fond des blocs de cette équipe (scoreboard, champ select, joueurs, bracket). Conseil : 600×120 px.</span>
      </div>
    </div>`).join('');
}

// --- champ select
function usedIds() { return [...S.draft.blue.bans, ...S.draft.blue.picks, ...S.draft.red.bans, ...S.draft.red.picks].filter(Boolean); }
function slotStyle(id) { const u = square(id); return u ? `style="background-image:url('${u}')"` : ''; }
function renderDraft() {
  const d = S.draft, lcu = S.settings.draftSource === 'lcu';
  const cur = d.step < d.order.length ? d.order[d.step] : null;
  const col = (side) => {
    const nm = S.teams.find((t) => t.id === (side === 'blue' ? S.match.blueTeamId : S.match.redTeamId));
    const firstBan = d[side].bans.indexOf(null), firstPick = d[side].picks.indexOf(null);
    return `<div class="slotcol" style="--c:${nm?.color || (side === 'blue' ? '#3b82f6' : '#ef4444')}"><h4>${esc(nm?.name || side)}</h4>
      <div class="bansrow">${d[side].bans.map((id, i) => `<div class="slot ban ${cur && cur.side === side && cur.type === 'ban' && firstBan === i ? 'on' : ''}" ${slotStyle(id)} ${id ? `title="${esc(cname(id))} — cliquer pour retirer" data-act="draftClear" data-args='{"side":"${side}","type":"ban","index":${i}}'` : ''}>${id === '__none' ? '∅' : (!id ? '' : (square(id) ? '' : esc(id.slice(0, 3))))}</div>`).join('')}</div>
      ${d[side].picks.map((id, i) => `<div class="pickrow ${cur && cur.side === side && cur.type === 'pick' && firstPick === i ? 'on' : ''}">
        <div class="slot" ${slotStyle(id)}>${id && !square(id) ? esc(id.slice(0, 3)) : ''}</div>
        <div class="nm"><b>${id ? esc(cname(id)) : '—'}</b><small>${esc(nm?.players?.[i] || ROLES[i])}</small></div>
        <div><button class="btn sm" ${i === 0 || lcu ? 'disabled' : ''} data-act="draftSwap" data-args='{"side":"${side}","i":${i},"j":${i - 1}}'>↑</button>
        <button class="btn sm" ${i === 4 || lcu ? 'disabled' : ''} data-act="draftSwap" data-args='{"side":"${side}","i":${i},"j":${i + 1}}'>↓</button>
        <button class="btn sm" ${!id || lcu ? 'disabled' : ''} data-act="draftClear" data-args='{"side":"${side}","type":"pick","index":${i}}'>✕</button></div></div>`).join('')}
      ${d.fearless[side].length ? `<div class="note" style="margin-top:6px">Fearless : ${d.fearless[side].map((x) => esc(cname(x))).join(', ')}</div>` : ''}</div>`;
  };
  const stepTxt = cur ? `Étape ${d.step + 1}/20 — ${esc(teamName(cur.side === 'blue' ? S.match.blueTeamId : S.match.redTeamId))} ${cur.type === 'ban' ? 'bannit' : 'choisit'}` : 'Draft terminé';
  $('#draft-main').innerHTML = `
    <h2>Champ select</h2><p class="sub">Clique sur un champion pour remplir l'étape en cours. Clique sur un ban/pick pour le retirer.</p>
    <div class="card"><div class="draft-top">
      <div class="seg">${[['manual', 'Manuel'], ['lcu', 'Auto (client LoL)']].map(([v, l]) => `<button class="${S.settings.draftSource === v ? 'on' : ''}" data-act="set" data-args='{"section":"settings","data":{"draftSource":"${v}"}}'>${l}</button>`).join('')}</div>
      ${lcu ? `<span class="pill ${/détecté/.test(S.status.lcu) ? '' : 'wait'}">${esc(S.status.lcu)}</span>` : `<b>${stepTxt}</b>`}
      <span style="flex:1"></span>
      <label class="note">Timer (s) <input type="number" min="5" max="120" style="width:70px" data-bind="settings.draftTimer" data-type="number" value="${S.settings.draftTimer}"></label>
      <button class="btn sm" data-act="draftTimer" data-args='{"run":true}'>▶ Timer</button><button class="btn sm" data-act="draftTimer" data-args='{"run":false}'>■</button>
      <button class="btn sm" ${lcu ? 'disabled' : ''} data-act="draftUndo">↶ Annuler</button><button class="btn sm danger" data-act="draftReset">Réinitialiser</button>
      <label class="note" style="display:flex;align-items:center;gap:8px">Afficher l'overlay ${switchEl('visibility.champselect', S.visibility.champselect)}</label>
    </div>
    <div class="btns" style="margin-top:12px"><button class="btn" data-act="draftNextGame" title="Archive les picks de la manche dans la liste Fearless puis démarre un nouveau draft">Manche suivante (Fearless) ➜</button>
      <button class="btn sm" data-act="draftClearFearless">Vider la liste Fearless</button></div></div>
    <div class="card"><div class="slots">${col('blue')}${col('red')}</div></div>`;
}
function renderGrid() {
  const lcu = S.settings.draftSource === 'lcu';
  const used = new Set(usedIds());
  const q = champSearch.trim().toLowerCase();
  const list = champs.list.filter((c) => !q || c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q));
  const grid = $('#champgrid');
  grid.innerHTML = list.map((c) => `<button class="champ ${used.has(c.id) || lcu ? 'used' : ''}" title="${esc(c.name)}" data-act="draftPick" data-args='{"id":"${esc(c.id)}"}' ${S.ddragon.version ? `style="background-image:url('https://ddragon.leagueoflegends.com/cdn/${S.ddragon.version}/img/champion/${esc(c.id)}.png')"` : ''}><span>${esc(c.name)}</span></button>`).join('') || '<span class="note">Aucun champion trouvé.</span>';
  $('#champnote').textContent = S.ddragon.version ? '' : 'Mode hors ligne : les images ne sont pas disponibles (liste de secours). Les overlays afficheront les noms uniquement.';
}

// --- éditeur de style
function renderStyle() {
  const id = styleSel, def = S.overlayDefs[id], st = S.settings.styles[id] || {}, th = S.settings.theme, col = st.colors || {};
  const base = `settings.styles.${id}`;
  const hidden = new Set(st.hide || []);
  $('#style-main').innerHTML = `
    <div class="card"><h3>Calques <span class="note">— glisse un bloc dans l'aperçu, molette pour le redimensionner</span></h3>
      ${Object.entries(def.blocks).map(([b, label]) => {
        const v = st.blocks?.[b] || {};
        return `<div class="blkrow"><label class="sw"><input type="checkbox" data-bind="${base}.blocks.${b}.visible" ${v.visible === false ? '' : 'checked'}><span></span></label><b>${esc(label)}</b>
          <label>X <input type="number" step="1" data-bind="${base}.blocks.${b}.x" data-type="number" value="${v.x || 0}"></label>
          <label>Y <input type="number" step="1" data-bind="${base}.blocks.${b}.y" data-type="number" value="${v.y || 0}"></label>
          <label>Échelle <input type="range" min="0.3" max="2" step="0.01" data-live data-bind="${base}.blocks.${b}.scale" data-type="number" value="${v.scale || 1}"><code>${Math.round((v.scale || 1) * 100)}%</code></label>
          <button class="btn sm" data-act="resetBlock" data-args='{"b":"${b}"}'>↺</button></div>`;
      }).join('')}
    </div>
    <div class="card"><h3>Composants affichés</h3><div class="comps">
      ${Object.entries(def.comps).map(([c, label]) => `<label class="chk"><input type="checkbox" data-comp-toggle="${c}" ${hidden.has(c) ? '' : 'checked'}> ${esc(label)}</label>`).join('')}
    </div></div>
    <div class="card"><h3>Bannière de l'overlay</h3>
      <div class="bannerrow"><div class="bprev" ${st.banner?.image ? `style="background-image:url('${esc(st.banner.image)}')"` : ''}>${st.banner?.image ? '' : 'Aucune image'}</div>
        <div class="actions" style="flex-direction:row;margin:0"><button class="btn sm" data-act="uploadImage" data-args='{"path":"${base}.banner.image"}'>Choisir une image…</button>
        ${st.banner?.image ? `<button class="btn sm" data-act="clearPath" data-args='{"path":"${base}.banner.image"}'>Retirer</button>` : ''}</div>
        <span class="note">Fond appliqué aux bannières et panneaux de cet overlay. Une bannière propre à une équipe (onglet Équipes) la remplace pour cette équipe.</span></div>
    </div>
    <div class="card"><h3>Couleurs & police <span class="note">— remplacent le thème pour cet overlay uniquement</span></h3>
      <div class="colgrid">
        ${[['panel', 'Panneaux'], ['bg', 'Fond secondaire'], ['text', 'Texte'], ['muted', 'Texte atténué'], ['accent', 'Accent']].map(([k, l]) => `<label>${l}<input type="color" data-bind="${base}.colors.${k}" data-live value="${esc(col[k] || th[k])}"></label>`).join('')}
        <label>Police<select data-bind="${base}.colors.font"><option value="">Thème (${esc(th.font)})</option>${FONTS.map((f) => `<option ${col.font === f ? 'selected' : ''}>${f}</option>`).join('')}</select></label>
        <label>Arrondi (px)<input type="number" min="0" max="40" data-bind="${base}.colors.radius" data-type="number" value="${col.radius ?? ''}" placeholder="${th.radius}"></label>
        <label>Opacité (0-1)<input type="number" min="0.3" max="1" step="0.05" data-bind="${base}.colors.opacity" data-type="number" value="${col.opacity ?? ''}" placeholder="${th.opacity}"></label>
      </div>
      <div class="btns"><button class="btn sm" data-act="clearColors">Revenir au thème</button></div>
    </div>
    <div class="card"><h3>CSS personnalisé</h3>
      <textarea class="css" spellcheck="false" data-bind="${base}.css" placeholder="/* Ex. : .team { border-radius: 0 !important; } .t-name { font-size: 30px; } */">${esc(st.css || '')}</textarea>
      <p class="note">Appliqué uniquement à cet overlay. Variables utiles : <code>--accent</code> <code>--text</code> <code>--radius</code> <code>--font</code>. Valide en cliquant hors du champ.</p>
    </div>
    <div class="btns"><button class="btn danger" data-act="styleReset" data-args='{"overlay":"${id}"}'>Réinitialiser le style de cet overlay</button></div>`;
}

// --- thèmes
function renderTheme() {
  const t = S.settings.theme;
  $('#theme-main').innerHTML = `
    <h2>Thèmes</h2><p class="sub">Réglage global, appliqué à tous les overlays. Pour personnaliser un overlay en particulier, va dans « Style ».</p>
    <div class="card"><h3>Préréglages</h3><div class="presets">
      ${Object.entries(S.presets).map(([k, p]) => `<button class="preset ${t.preset === k ? 'on' : ''}" data-act="themePreset" data-args='{"name":"${k}"}'>
        <div class="sw2"><i style="background:${p.bg}"></i><i style="background:${p.panel}"></i><i style="background:${p.accent}"></i><i style="background:${p.text}"></i></div><b style="font-family:${p.font}">${esc(p.label)}</b></button>`).join('')}
    </div></div>
    <div class="card"><h3>Personnalisation</h3>
      ${[['bg', 'Fond secondaire'], ['panel', 'Panneaux'], ['text', 'Texte'], ['muted', 'Texte atténué'], ['accent', 'Accent']].map(([k, l]) => `<div class="row"><label>${l}</label><input type="color" data-bind="settings.theme.${k}" data-live value="${esc(t[k])}"><code>${esc(t[k])}</code></div>`).join('')}
      <div class="row"><label>Police</label><select data-bind="settings.theme.font">${FONTS.map((f) => `<option ${t.font === f ? 'selected' : ''} style="font-family:${f}">${f}</option>`).join('')}</select></div>
      <div class="row"><label>Arrondi</label><input type="range" min="0" max="24" step="1" data-bind="settings.theme.radius" data-type="number" data-live value="${t.radius}"><code>${t.radius}px</code></div>
      <div class="row"><label>Opacité panneaux</label><input type="range" min="0.5" max="1" step="0.01" data-bind="settings.theme.opacity" data-type="number" data-live value="${t.opacity}"><code>${Math.round(t.opacity * 100)}%</code></div>
      <p class="note">Les polices sont chargées depuis Google Fonts : si la machine OBS est hors ligne, une police système de remplacement est utilisée.</p>
    </div>`;
}

// --- réglages
function renderSettings() {
  const o = S.settings.objectives, an = S.settings.announcer, L = S.settings.lframe;
  const num = (k, l) => `<div class="row"><label>${l}</label><input type="number" min="0" data-bind="settings.objectives.${k}" data-type="number" value="${o[k]}" style="max-width:110px;flex:none"> <span class="note">secondes</span></div>`;
  const txt = (k, l, ph = '') => `<div class="row"><label>${l}</label><input data-bind="settings.lframe.${k}" value="${esc(L[k])}" placeholder="${esc(ph)}"></div>`;
  const imgRow = (k, l) => `<div class="row"><label>${l}</label><div class="bprev sm" ${L[k] ? `style="background-image:url('${esc(L[k])}')"` : ''}></div>
    <button class="btn sm" data-act="uploadImage" data-args='{"path":"settings.lframe.${k}"}'>Choisir…</button>${L[k] ? `<button class="btn sm" data-act="clearPath" data-args='{"path":"settings.lframe.${k}"}'>Retirer</button>` : ''}</div>`;
  $('#tab-settings').innerHTML = `
    <h2>Réglages</h2><p class="sub">Annonceur, cadre L, timers, overlays personnalisés, sauvegarde.</p>
    <div class="grid2">
      <div class="card"><h3>Annonceur</h3>
        <div class="row"><label>Durée (s)</label><input type="number" min="1" max="15" data-bind="settings.announcer.duration" data-type="number" value="${an.duration}" style="max-width:90px;flex:none"></div>
        <div class="comps">${Object.entries(KIND_LABELS).map(([k, l]) => `<label class="chk"><input type="checkbox" data-bind="settings.announcer.kinds.${k}" ${an.kinds[k] ? 'checked' : ''}> ${l}</label>`).join('')}</div>
        <p class="note">Choisis les événements annoncés par la bannière centrale.</p></div>
      <div class="card"><h3>Cadre L & commentateurs</h3>
        ${txt('caster1', 'Commentateur 1', 'Pseudo')}${txt('caster2', 'Commentateur 2', 'Pseudo')}${txt('ticker', 'Bandeau défilant', 'Message…')}
        <div class="row"><label>Largeur gauche</label><input type="number" min="200" max="700" data-bind="settings.lframe.leftWidth" data-type="number" value="${L.leftWidth}" style="max-width:100px;flex:none"> <label style="width:auto">Hauteur bas</label><input type="number" min="80" max="400" data-bind="settings.lframe.bottomHeight" data-type="number" value="${L.bottomHeight}" style="max-width:100px;flex:none"></div>
        ${imgRow('sponsor', 'Sponsor / logo')}${imgRow('background', 'Fond du cadre')}
        <p class="note">Dans OBS, réduis la capture du jeu pour qu'elle remplisse la zone transparente (haut-droite).</p></div>
    </div>
    <div class="grid2" style="margin-top:16px">
      <div class="card"><h3>Timers d'objectifs</h3>
        <p class="note">Ces valeurs dépendent de la saison : ajuste-les si Riot les modifie.</p>
        ${num('dragonFirst', '1er dragon')}${num('dragonRespawn', 'Respawn dragon')}${num('baronFirst', '1er baron')}${num('baronRespawn', 'Respawn baron')}${num('inhibRespawn', 'Respawn inhibiteur')}
      </div>
      <div class="card"><h3>Client LoL (champ select auto)</h3>
        <p class="note">Utilisé uniquement avec « Auto (client LoL) » dans l'onglet Champ select. Laisse vide pour la détection automatique du fichier <code>lockfile</code>.</p>
        <div class="row"><label>Chemin lockfile</label><input data-bind="settings.lcuLockfile" value="${esc(S.settings.lcuLockfile)}" placeholder="C:\\Riot Games\\League of Legends\\lockfile"></div>
      </div>
    </div>
    <div class="grid2" style="margin-top:16px">
      <div class="card"><h3>Overlays personnalisés</h3>
        <p class="note">Dépose tes propres pages HTML dans ce dossier : elles accèdent à toutes les données en direct (voir <code>exemple.html</code>).</p>
        <p><code style="word-break:break-all">${esc(customInfo.dir || '…')}</code></p>
        ${(customInfo.files || []).map((f) => `<div class="ov" style="grid-template-columns:1fr auto"><code>/custom/${esc(f)}</code><button class="btn sm" data-act="copyCustom" data-args='{"f":"${esc(f)}"}'>Copier l'URL</button></div>`).join('') || '<p class="note">Aucun fichier.</p>'}
        <div class="btns"><button class="btn sm" data-act="refreshCustom">Actualiser la liste</button></div></div>
      <div class="card"><h3>Sauvegarde</h3>
        <p class="note">Exporte équipes, logos, bannières, styles, thèmes et programme dans un seul fichier, pour les sauvegarder ou les copier sur un autre PC.</p>
        <div class="btns"><button class="btn" data-act="exportConfig">Exporter la configuration</button><button class="btn" data-act="importConfig">Importer…</button></div>
        <input type="file" id="importfile" hidden accept="application/json,.json"></div>
    </div>
    <div class="card" style="margin-top:16px"><h3>Raccourcis clavier <span class="note">(application Windows, actifs même pendant le jeu)</span></h3>
      <div class="keys"><span><kbd>Ctrl+Alt+1…9, 0</kbd> afficher / masquer les overlays dans l'ordre de la liste</span><span><kbd>Ctrl+Alt+←</kbd> +1 victoire bleue</span><span><kbd>Ctrl+Alt+→</kbd> +1 victoire rouge</span>
      <span><kbd>Ctrl+Alt+H</kbd> tout masquer</span><span><kbd>Ctrl+Alt+S</kbd> tout afficher</span><span><kbd>Ctrl+Alt+T</kbd> lancer le timer du draft</span><span><kbd>Ctrl+Alt+Z</kbd> annuler le dernier pick/ban</span></div></div>
    <div class="card" style="margin-top:16px"><h3>Utiliser dans OBS</h3>
      <ol class="note" style="line-height:1.9;margin:0;padding-left:20px">
        <li>Sources → <b>+</b> → <b>Navigateur</b>.</li>
        <li>Colle l'URL de l'overlay (bouton « Copier l'URL » du tableau de bord, adresse <code>${esc(location.origin)}/overlays/…</code>).</li>
        <li>Largeur <b>1920</b>, hauteur <b>1080</b>. Décoche « Arrêter la source quand elle n'est pas visible ».</li>
        <li>Affiche/masque chaque overlay depuis le tableau de bord, avec animation.</li>
      </ol>
      <p class="legal">Broadcast Studio est un projet indépendant et gratuit. Il n'est pas approuvé par Riot Games et ne reflète pas les opinions de Riot Games ni de personnes officiellement impliquées dans la production ou la gestion de League of Legends. League of Legends et Riot Games sont des marques ou marques déposées de Riot Games, Inc. Les images de champions proviennent de Data Dragon (Riot Games).</p>
    </div>`;
}

// ------------------------------------------------------------------ images
function pickImage(target) {
  const f = $('#imgfile');
  f.dataset.target = JSON.stringify(target);
  f.value = '';
  f.click();
}
async function handleImage(file, target) {
  const dataUrl = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); });
  const r = await post('/api/upload', { dataUrl });
  if (!r?.url) return;
  if (target.path) await setPath(target.path, r.url);
  else { const t = structuredClone(S.teams); t[target.team][target.field] = r.url; await api.set('teams', t); }
  toast('Image enregistrée');
}

// ------------------------------------------------------------------ événements
async function refreshCustom() { customInfo = await fetch('/api/custom').then((r) => r.json()).catch(() => customInfo); fp.settings = null; queueRender(); }

document.addEventListener('click', (e) => {
  const nav = e.target.closest('#nav button');
  if (nav) return switchTab(nav.dataset.tab);
  const sel = e.target.closest('#style-sel button');
  if (sel) return selectStyle(sel.dataset.id);
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const a = JSON.parse(el.dataset.args || '{}');
  switch (el.dataset.act) {
    case 'set': return api.set(a.section, a.data);
    case 'copy': case 'copyCustom': {
      const url = `${location.origin}${el.dataset.act === 'copy' ? `/overlays/${a.id}.html` : `/custom/${a.f}`}`;
      return (navigator.clipboard?.writeText(url) || Promise.reject()).then(() => toast('URL copiée'), () => { prompt('Copie cette URL :', url); });
    }
    case 'addTeam': {
      const n = S.teams.length + 1;
      return api.set('teams', [...S.teams, { id: 't' + Date.now().toString(36), name: 'Équipe ' + n, tag: 'T' + n, color: '#a855f7', logo: '', banner: '', players: [...ROLES] }]);
    }
    case 'delTeam': return confirm('Supprimer cette équipe ?') && api.set('teams', S.teams.filter((_, i) => i !== a.i));
    case 'clearTeamImage': { const t = structuredClone(S.teams); t[a.i][a.field] = ''; return api.set('teams', t); }
    case 'uploadImage': return pickImage(a);
    case 'clearPath': return setPath(a.path, '');
    case 'resetBlock': return api.set('settings', { styles: { [styleSel]: { blocks: { [a.b]: { x: 0, y: 0, scale: 1, visible: true } } } } });
    case 'clearColors': return api.set('settings', { styles: { [styleSel]: { colors: { panel: '', bg: '', text: '', muted: '', accent: '', font: '', radius: '', opacity: '' } } } });
    case 'draftPickManual': { const v = $('#manualid').value.trim(); if (v) { $('#manualid').value = ''; api.act('draftPick', { id: v }); } return; }
    case 'refreshCustom': return refreshCustom();
    case 'exportConfig': return void (location.href = '/api/export');
    case 'importConfig': return $('#importfile').click();
    default: return api.act(el.dataset.act, a);
  }
});

function bindValue(el) {
  if (el.type === 'checkbox') return el.checked;
  if (el.dataset.type === 'number') return el.value === '' ? '' : Number(el.value);
  return el.value;
}
let liveTimer;
document.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.dataset.bind) return setPath(el.dataset.bind, bindValue(el));
  if (el.dataset.compToggle) {
    const cur = new Set(S.settings.styles[styleSel]?.hide || []);
    if (el.checked) cur.delete(el.dataset.compToggle); else cur.add(el.dataset.compToggle);
    return setPath(`settings.styles.${styleSel}.hide`, [...cur]);
  }
  if (el.dataset.sched) {
    const v = el.dataset.type === 'number' ? Number(el.value) : el.value;
    return api.act('scheduleUpdate', { id: el.dataset.sched, patch: { [el.dataset.field]: v } });
  }
  if (el.dataset.team !== undefined) {
    const t = structuredClone(S.teams); const i = +el.dataset.team;
    if (el.dataset.field === 'player') t[i].players[+el.dataset.pi] = el.value; else t[i][el.dataset.field] = el.value;
    return api.set('teams', t);
  }
  if (el.id === 'imgfile' && el.files[0]) return handleImage(el.files[0], JSON.parse(el.dataset.target));
  if (el.id === 'importfile' && el.files[0]) {
    try {
      const bundle = JSON.parse(await el.files[0].text());
      const r = await post('/api/import', { bundle });
      if (r?.ok) toast('Configuration importée');
    } catch (_) { toast('Fichier illisible'); }
    el.value = '';
  }
});
document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.id === 'champsearch') { champSearch = el.value; fp.grid = null; return render(); }
  if (el.dataset.live !== undefined && el.dataset.bind) {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => setPath(el.dataset.bind, bindValue(el)), 80);
  }
});
document.addEventListener('focusout', () => setTimeout(queueRender, 150));

// Déplacement / redimensionnement des blocs dans l'aperçu interactif de l'éditeur de style
window.addEventListener('message', (e) => {
  if (e.origin !== location.origin) return;
  const m = e.data;
  if (!m || m.type !== 'blockMove' || !OVERLAYS.some((o) => o.id === m.overlay)) return;
  if (![m.x, m.y, m.scale].every(Number.isFinite)) return;
  api.set('settings', { styles: { [m.overlay]: { blocks: { [m.block]: { x: m.x, y: m.y, scale: m.scale } } } } });
});

function selectStyle(id) {
  styleSel = id;
  $$('#style-sel button').forEach((b) => b.classList.toggle('on', b.dataset.id === id));
  const f = $('#style-prev iframe');
  f.src = `/overlays/${id}.html?preview=1&edit=1`;
  fp.style = null; render();
}
function switchTab(t) {
  $$('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  $$('.tab').forEach((s) => s.classList.toggle('on', s.id === 'tab-' + t));
  fitPreviews();
  if (t === 'settings') refreshCustom();
}

// ------------------------------------------------------------------ init
function init() {
  $('#tab-dash').innerHTML = '<div id="dash-main"></div><div class="card" style="margin-top:16px"><h3>Aperçu en direct</h3><div id="dash-prev"></div></div>';
  $('#tab-teams').innerHTML = '<h2>Équipes</h2><p class="sub">Nom, tag, couleur, logo, bannière et joueurs. Les overlays se mettent à jour instantanément.</p><div id="teams-main"></div><div class="btns"><button class="btn pri" data-act="addTeam">+ Ajouter une équipe</button></div><input type="file" id="imgfile" hidden accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml">';
  $('#tab-draft').innerHTML = `<div id="draft-main"></div>
    <div class="card" id="draft-grid-card"><div class="row"><input id="champsearch" placeholder="Rechercher un champion…" autocomplete="off">
      <button class="btn" data-act="draftPick" data-args='{"id":"__none"}'>Pas de ban</button></div>
      <div class="row"><input id="manualid" placeholder="ID Data Dragon manuel (ex. Ahri, LeeSin)" style="max-width:320px"><button class="btn" data-act="draftPickManual">Valider</button></div>
      <div id="champgrid" class="champs"></div><p class="note" id="champnote"></p></div>`;
  $('#tab-style').innerHTML = `<h2>Éditeur de style</h2><p class="sub">Personnalise chaque overlay : position, taille, composants, bannières, couleurs et CSS. Les changements sont instantanés.</p>
    <div class="seg wrap" id="style-sel">${OVERLAYS.map((o) => `<button data-id="${o.id}" class="${o.id === styleSel ? 'on' : ''}">${o.name}</button>`).join('')}</div>
    <div class="style-grid"><div><div class="card sticky"><div class="editbox" id="style-prev"><iframe src="/overlays/${styleSel}.html?preview=1&edit=1" title="aperçu"></iframe></div>
      <p class="note" style="margin:10px 0 0">Glisse un bloc pour le déplacer · molette pour l'agrandir ou le réduire.</p></div></div><div id="style-main"></div></div>`;
  $('#tab-theme').innerHTML = '<div id="theme-main"></div><div class="card"><h3>Aperçu</h3><div id="theme-prev"></div></div>';
  buildPreviews($('#dash-prev'), OVERLAYS.map((o) => o.id));
  buildPreviews($('#theme-prev'), ['scoreboard', 'champselect', 'series', 'players']);
  new ResizeObserver(fitPreviews).observe(document.body);

  fetch('/api/champions').then((r) => r.json()).then((c) => { champs = c; fp.grid = null; render(); });
  refreshCustom();
  const connect = () => {
    const ws = new WebSocket(`ws://${location.host}/ws`);
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.type === 'state') { S = m.state; queueRender(); } };
    ws.onclose = () => { const c = $('#conn'); c.textContent = 'Reconnexion…'; c.className = 'pill off'; setTimeout(connect, 1000); };
  };
  connect();
}
init();
