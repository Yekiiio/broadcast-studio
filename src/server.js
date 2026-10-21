'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { Store, merge } = require('./state');
const { Engine } = require('./engine');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};
const SET_SECTIONS = new Set(['settings', 'teams', 'match', 'visibility']);
const IMG_TYPES = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'image/svg+xml': '.svg' };
const MAX_BODY = 60 * 1024 * 1024;
const ASSET_RE = /^[a-f0-9]{16}\.(png|jpg|webp|gif|svg)$/;
const EXAMPLE_OVERLAY = `<!doctype html>
<html lang="fr" data-overlay="exemple">
<head>
<meta charset="utf-8"><title>Overlay perso</title>
<link rel="stylesheet" href="/overlays/shared.css">
<style>
  /* Ton design ici. La page fait 1920x1080 et le fond est transparent. */
  #box { position: absolute; left: 40px; bottom: 40px; padding: 18px 28px; font-size: 40px; }
</style>
</head>
<body>
<div id="box" class="panel"></div>
<script src="/overlays/shared.js"></script>
<script>
  // 'state' contient tout : state.game (stats en direct), state.match, state.teams, state.draft, state.settings...
  Overlay.onState((state) => {
    const g = state.game;
    document.getElementById('box').textContent = g
      ? Overlay.team('blue').name + ' ' + g.blue.kills + ' - ' + g.red.kills + ' ' + Overlay.team('red').name + '  ·  ' + Overlay.fmtTime(g.time)
      : 'En attente de la partie…';
  });
</script>
</body>
</html>
`;

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('Requête trop volumineuse')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(new Error('JSON invalide')); }
    });
    req.on('error', reject);
  });
}

function serveFile(res, root, rel) {
  let p = path.normalize(path.join(root, decodeURIComponent(rel)));
  if (!p.startsWith(root)) { res.writeHead(403); return res.end('Interdit'); }
  try {
    if (fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
    const ext = path.extname(p).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(p).pipe(res);
  } catch (_) {
    res.writeHead(404); res.end('Introuvable');
  }
}

async function createServer({ dataDir, port = 3777, webRoot = path.join(__dirname, '..', 'web') }) {
  const store = new Store(dataDir);
  const engine = new Engine(store, dataDir);
  const assetsDir = path.join(dataDir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });
  const customDir = path.join(dataDir, 'custom');
  fs.mkdirSync(customDir, { recursive: true });
  if (!fs.readdirSync(customDir).length) fs.writeFileSync(path.join(customDir, 'exemple.html'), EXAMPLE_OVERLAY);

  const server = http.createServer(async (req, res) => {
    try {
      // Protection contre le DNS rebinding : on n'accepte que localhost.
      const host = (req.headers.host || '').replace(/:\d+$/, '');
      if (host !== '127.0.0.1' && host !== 'localhost') { res.writeHead(403); return res.end('Hôte refusé'); }
      const url = new URL(req.url, 'http://localhost');
      const p = url.pathname;

      if (req.method === 'GET') {
        if (p === '/') { res.writeHead(302, { Location: '/control/' }); return res.end(); }
        if (p === '/api/state') return json(res, 200, store.state);
        if (p === '/api/champions') return json(res, 200, engine.champions);
        if (p.startsWith('/control/')) return serveFile(res, path.join(webRoot, 'control'), p.slice('/control/'.length));
        if (p.startsWith('/overlays/')) return serveFile(res, path.join(webRoot, 'overlays'), p.slice('/overlays/'.length));
        if (p.startsWith('/assets/')) return serveFile(res, assetsDir, p.slice('/assets/'.length));
        if (p.startsWith('/custom/')) return serveFile(res, customDir, p.slice('/custom/'.length));
        if (p === '/api/custom') {
          const files = fs.readdirSync(customDir).filter((f) => f.endsWith('.html'));
          return json(res, 200, { dir: customDir, files });
        }
        if (p === '/api/export') {
          const persisted = store.persisted();
          const assets = {};
          const refs = JSON.stringify(persisted).match(/\/assets\/[a-f0-9]{16}\.(?:png|jpg|webp|gif|svg)/g) || [];
          for (const r of new Set(refs)) {
            const f = path.basename(r);
            const ext = path.extname(f).slice(1);
            const mime = ext === 'jpg' ? 'image/jpeg' : ext === 'svg' ? 'image/svg+xml' : 'image/' + ext;
            try { assets[f] = `data:${mime};base64,` + fs.readFileSync(path.join(assetsDir, f)).toString('base64'); } catch (_) { /* fichier absent */ }
          }
          res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="broadcast-studio-config.json"' });
          return res.end(JSON.stringify({ app: 'broadcast-studio', version: 2, state: persisted, assets }));
        }
        res.writeHead(404); return res.end('Introuvable');
      }

      if (req.method === 'POST' && p.startsWith('/api/')) {
        // Un JSON strict force un "preflight" CORS : un site tiers ne peut pas piloter l'app.
        if (!(req.headers['content-type'] || '').startsWith('application/json')) return json(res, 415, { error: 'JSON requis' });
        const body = await readBody(req);

        if (p === '/api/set') {
          if (!SET_SECTIONS.has(body.section)) return json(res, 400, { error: 'Section invalide' });
          store.patch(body.section, body.data);
          return json(res, 200, { ok: true });
        }
        if (p === '/api/action') {
          engine.action(String(body.name), body.args || {});
          return json(res, 200, { ok: true });
        }
        if (p === '/api/import') {
          const b = body.bundle;
          if (!b || b.app !== 'broadcast-studio' || typeof b.state !== 'object') return json(res, 400, { error: 'Fichier de configuration invalide' });
          for (const [name, dataUrl] of Object.entries(b.assets || {})) {
            const m = /^data:[\w/+.-]+;base64,(.+)$/s.exec(dataUrl);
            if (ASSET_RE.test(name) && m) fs.writeFileSync(path.join(assetsDir, name), Buffer.from(m[1], 'base64'));
          }
          store.mutate((s) => {
            for (const k of ['settings', 'teams', 'match', 'schedule', 'visibility']) {
              if (b.state[k] !== undefined) s[k] = k === 'teams' || k === 'schedule' ? b.state[k] : merge(s[k], b.state[k]);
            }
            if (b.state.draft?.fearless) s.draft.fearless = b.state.draft.fearless;
          });
          return json(res, 200, { ok: true });
        }
        if (p === '/api/upload') {
          const m = /^data:([\w/+.-]+);base64,(.+)$/s.exec(body.dataUrl || '');
          if (!m || !IMG_TYPES[m[1]]) return json(res, 400, { error: 'Image PNG, JPG, WEBP, GIF ou SVG requise' });
          const buf = Buffer.from(m[2], 'base64');
          if (buf.length > 6 * 1024 * 1024) return json(res, 413, { error: 'Image trop lourde (6 Mo max)' });
          const name = crypto.randomBytes(8).toString('hex') + IMG_TYPES[m[1]];
          fs.writeFileSync(path.join(assetsDir, name), buf);
          return json(res, 200, { url: '/assets/' + name });
        }
      }
      res.writeHead(404); res.end('Introuvable');
    } catch (e) {
      json(res, 400, { error: e.message });
    }
  });

  // --- WebSocket : diffusion de l'état à tous les overlays / panneaux
  const wss = new WebSocketServer({ server, path: '/ws' });
  const send = (ws) => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'state', state: store.state })); };
  wss.on('connection', (ws, req) => {
    const host = (req.headers.host || '').replace(/:\d+$/, '');
    if (host !== '127.0.0.1' && host !== 'localhost') return ws.close();
    send(ws);
  });
  let pending = false;
  store.on('change', () => {
    if (pending) return;
    pending = true;
    setTimeout(() => { pending = false; wss.clients.forEach(send); }, 40);
  });

  // --- écoute avec repli sur le port suivant si occupé
  const listen = (p) => new Promise((resolve, reject) => {
    const onErr = (e) => { server.off('listening', onOk); reject(e); };
    const onOk = () => { server.off('error', onErr); resolve(p); };
    server.once('error', onErr);
    server.once('listening', onOk);
    server.listen(p, '127.0.0.1');
  });
  let actual = port;
  for (let i = 0; i < 10; i++) {
    try { actual = await listen(port + i); break; } catch (e) {
      if (e.code !== 'EADDRINUSE' || i === 9) throw e;
    }
  }

  await engine.init();

  return {
    port: actual,
    store,
    engine,
    close() { engine.stop(); store.saveNow(); wss.close(); server.close(); },
  };
}

module.exports = { createServer };
