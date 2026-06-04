'use strict';

const assert = require('node:assert');
const { spawn } = require('node:child_process');

const PORT = 45123;
const BASE = `http://127.0.0.1:${PORT}`;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(child) {
  for (let i = 0; i < 50; i += 1) {
    if (child.exitCode !== null) throw new Error(`server exited with ${child.exitCode}`);
    try {
      const response = await fetch(`${BASE}/health`);
      if (response.ok) return;
    } catch (_error) {
      // not ready yet
    }
    await wait(100);
  }
  throw new Error('server did not become ready');
}

(async () => {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', AUTH_COOKIE_SECRET: '', ALLOWED_GOOGLE_EMAIL: '' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });

  try {
    await waitForServer(child);

    const health = await fetch(`${BASE}/health`).then((r) => r.json());
    assert.equal(health.ok, true);
    assert.equal(health.authMode, 'local');

    const me = await fetch(`${BASE}/api/me`).then((r) => r.json());
    assert.equal(me.ok, true);
    assert.equal(me.email, 'local-demo');

    const watchlist = await fetch(`${BASE}/api/watchlist`).then((r) => r.json());
    assert.equal(watchlist.ok, true);
    assert.ok(Array.isArray(watchlist.watchlist.symbols));
    assert.ok(watchlist.watchlist.symbols.length > 0);

    const html = await fetch(`${BASE}/`).then((r) => r.text());
    assert.match(html, /Trading Watchlist/);
  } finally {
    child.kill('SIGTERM');
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
