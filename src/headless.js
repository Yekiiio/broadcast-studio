'use strict';
// Lance uniquement le serveur (sans Electron) : utile pour tester ou pour un usage sur serveur/OBS distant.
const path = require('path');
const os = require('os');
const { createServer } = require('./server');

const dataDir = process.env.BS_DATA || path.join(os.homedir(), '.broadcast-studio');
createServer({ dataDir, port: Number(process.env.PORT) || 3777 }).then((s) => {
  console.log(`Broadcast Studio : http://127.0.0.1:${s.port}/control/`);
});
