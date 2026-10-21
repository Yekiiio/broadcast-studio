(() => {
  const params = new URLSearchParams(location.search);
  const NAME = document.documentElement.dataset.overlay;
  const FORCE = params.has('preview');
  const EDIT = params.has('edit');
  let state = null;
  const subs = [];

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hexRgb = (h) => { const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(h || ''); return m ? `${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}` : '17, 27, 46'; };

  const DRAGON_COLORS = { Fire: '#f0662b', Earth: '#b08a3c', Water: '#38bdf8', Air: '#cbd5e1', Hextech: '#22d3ee', Chemtech: '#84cc16', Elder: '#c084fc' };
  const DRAGON_FR = { Fire: 'Infernal', Earth: 'Montagne', Water: 'Océan', Air: 'Nuage', Hextech: 'Hextech', Chemtech: 'Chimtech', Elder: 'Ancien' };

  const Overlay = {
    esc,
    name: NAME,
    state: () => state,
    onState(fn) { subs.push(fn); if (state) fn(state); },
    DRAGON_COLORS,
    DRAGON_FR,
    fmtTime(s) { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; },
    fmtGold(g) { return (g / 1000).toFixed(1) + 'k'; },
    team(side) {
      const m = state.match;
      const id = side === 'blue' ? m.blueTeamId : m.redTeamId;
      return state.teams.find((t) => t.id === id) ||
        { name: side === 'blue' ? 'Bleu' : 'Rouge', tag: side === 'blue' ? 'BLU' : 'RED', color: side === 'blue' ? '#3b82f6' : '#ef4444', logo: '', banner: '', players: [] };
    },
    teamById(id) { return state.teams.find((t) => t.id === id) || { name: '—', tag: '?', color: '#64748b', logo: '', banner: '', players: [] }; },
    /** Match actif fusionné dans le programme (le programme n'est mis à jour qu'au changement de match). */
    schedule() { return state.schedule.map((e) => (e.id === state.match.id ? { ...e, ...state.match } : e)); },
    logoHTML(team) {
      return team.logo ? `<img class="logo" src="${esc(team.logo)}" alt="">`
        : `<span class="logo-ph" style="background:${esc(team.color)}">${esc((team.tag || team.name || '?').slice(0, 3))}</span>`;
    },
    ver: () => state?.ddragon?.version,
    square(id) { return id && id !== '__none' && Overlay.ver() ? `https://ddragon.leagueoflegends.com/cdn/${Overlay.ver()}/img/champion/${id}.png` : ''; },
    item: (id) => (id && Overlay.ver() ? `https://ddragon.leagueoflegends.com/cdn/${Overlay.ver()}/img/item/${id}.png` : ''),
    spell: (id) => (id && Overlay.ver() ? `https://ddragon.leagueoflegends.com/cdn/${Overlay.ver()}/img/spell/${id}.png` : ''),
    rune(id) { const p = state?.ddragon?.runes?.[id]; return p ? `https://ddragon.leagueoflegends.com/cdn/img/${p}` : ''; },
    splash: (id) => (id && id !== '__none' ? `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${id}_0.jpg` : ''),
    loading: (id) => (id && id !== '__none' ? `https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${id}_0.jpg` : ''),
    champName(id) {
      const c = (window.__champs || []).find((x) => x.id === id);
      return c ? c.name : (id || '');
    },
    /** Met à jour le texte seulement s'il change (évite tout clignotement). */
    text(el, v) { v = String(v); if (el && el._t !== v) { el._t = v; el.textContent = v; } },
    html(el, v) { if (el && el._h !== v) { el._h = v; el.innerHTML = v; } },
    bg(el, url) { const v = url ? `url("${url}")` : 'none'; if (el && el._b !== v) { el._b = v; el.style.backgroundImage = v; } },
    /** Bannière personnalisée d'équipe : remplace la bannière globale de l'overlay si elle existe. */
    teamBanner(el, team) {
      const v = team && team.banner ? `url("${team.banner}")` : '';
      if (el && el._bn !== v) { el._bn = v; if (v) el.style.setProperty('--banner-img', v); else el.style.removeProperty('--banner-img'); }
    },
  };
  window.Overlay = Overlay;

  // ---------------------------------------------------------------- thème + style de l'overlay
  const styleTag = document.createElement('style');
  styleTag.id = 'bs-style';
  document.head.appendChild(styleTag);

  function applyTheme(t, st) {
    const r = document.documentElement.style;
    const o = st.colors || {};
    r.setProperty('--bg', o.bg || t.bg);
    r.setProperty('--panel-rgb', hexRgb(o.panel || t.panel));
    r.setProperty('--opacity', o.opacity !== undefined && o.opacity !== '' ? o.opacity : t.opacity);
    r.setProperty('--text', o.text || t.text);
    r.setProperty('--muted', o.muted || t.muted);
    r.setProperty('--accent', o.accent || t.accent);
    r.setProperty('--font', `'${o.font || t.font}'`);
    const rad = o.radius !== undefined && o.radius !== '' ? o.radius : t.radius;
    r.setProperty('--radius', rad + 'px');
    const img = st.banner?.image;
    if (img) r.setProperty('--banner-img', `url("${img}")`); else r.removeProperty('--banner-img');
  }

  function applyBlocks(st) {
    document.querySelectorAll('[data-block]').forEach((el) => {
      const b = st.blocks?.[el.dataset.block] || {};
      if (el._drag) return;
      if (el.dataset.origin) el.style.transformOrigin = el.dataset.origin;
      el.style.transform = `translate(${b.x || 0}px, ${b.y || 0}px) scale(${b.scale || 1})`;
      const hidden = b.visible === false;
      el.style.display = hidden && !EDIT ? 'none' : '';
      el.style.opacity = hidden && EDIT ? '.3' : '';
    });
  }

  function applyCss(st) {
    const hide = (st.hide || []).filter((c) => /^[\w-]+$/.test(c)).map((c) => `[data-comp="${c}"]{display:none!important}`).join('');
    const css = hide + (st.css || '');
    if (styleTag._c !== css) { styleTag._c = css; styleTag.textContent = css; }
  }

  function apply() {
    const st = state.settings.styles?.[NAME] || {};
    applyTheme(state.settings.theme, st);
    applyBlocks(st);
    applyCss(st);
    const known = NAME in state.visibility;
    document.body.classList.toggle('show', FORCE || EDIT || !known || !!state.visibility[NAME]);
    subs.forEach((f) => f(state));
  }

  // ---------------------------------------------------------------- mode édition (aperçu de l'éditeur de style)
  if (EDIT) {
    const css = document.createElement('style');
    css.textContent = `body.edit .blk > * { pointer-events: auto; cursor: grab; outline: 2px dashed var(--accent); outline-offset: 3px; }
      body.edit .blk:hover > * { outline-color: #fff; } body.edit.dragging .blk > * { cursor: grabbing; }`;
    document.head.appendChild(css);
    document.addEventListener('DOMContentLoaded', () => document.body.classList.add('edit'));
    if (document.body) document.body.classList.add('edit');
    let drag = null;
    const read = (el) => {
      const b = state.settings.styles?.[NAME]?.blocks?.[el.dataset.block] || {};
      return { x: b.x || 0, y: b.y || 0, scale: b.scale || 1 };
    };
    const send = (el, v) => parent.postMessage({ type: 'blockMove', overlay: NAME, block: el.dataset.block, x: Math.round(v.x), y: Math.round(v.y), scale: Math.round(v.scale * 100) / 100 }, location.origin);
    document.addEventListener('pointerdown', (e) => {
      const el = e.target.closest('[data-block]');
      if (!el || !state) return;
      e.preventDefault();
      const v = read(el);
      drag = { el, sx: e.clientX, sy: e.clientY, v, cur: { ...v } };
      el._drag = true;
      document.body.classList.add('dragging');
      document.body.setPointerCapture?.(e.pointerId);
    });
    document.addEventListener('pointermove', (e) => {
      if (!drag) return;
      drag.cur = { x: drag.v.x + e.clientX - drag.sx, y: drag.v.y + e.clientY - drag.sy, scale: drag.cur.scale };
      drag.el.style.transform = `translate(${drag.cur.x}px, ${drag.cur.y}px) scale(${drag.cur.scale})`;
    });
    const end = () => {
      if (!drag) return;
      const d = drag; drag = null; d.el._drag = false;
      document.body.classList.remove('dragging');
      send(d.el, d.cur);
    };
    document.addEventListener('pointerup', end);
    document.addEventListener('pointercancel', end);
    document.addEventListener('wheel', (e) => {
      const el = e.target.closest('[data-block]');
      if (!el || !state) return;
      e.preventDefault();
      const v = read(el);
      v.scale = Math.max(0.3, Math.min(3, Math.round((v.scale + (e.deltaY < 0 ? 0.03 : -0.03)) * 100) / 100));
      el.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.scale})`;
      clearTimeout(el._wt);
      el._wt = setTimeout(() => send(el, v), 120);
    }, { passive: false });
  }

  fetch('/api/champions').then((r) => r.json()).then((c) => { window.__champs = c.list; if (state) apply(); }).catch(() => {});

  function connect() {
    const ws = new WebSocket(`ws://${location.host}/ws`);
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.type === 'state') { state = m.state; apply(); } };
    ws.onclose = () => setTimeout(connect, 1000);
  }
  connect();
})();
