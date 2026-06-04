'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const querystring = require('querystring');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const WATCHLIST_PATH = path.join(DATA_DIR, 'watchlist.json');
const DOMAIN_TARGET = process.env.PUBLIC_HOST || 'localhost';
const BASE_URL = process.env.BASE_URL || `http://${DOMAIN_TARGET}:${PORT}`;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const AUTH_COOKIE_SECRET = process.env.AUTH_COOKIE_SECRET || '';
const ALLOWED_EMAIL = (process.env.ALLOWED_GOOGLE_EMAIL || '').toLowerCase();
const AUTH_CONFIGURED = Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && AUTH_COOKIE_SECRET && ALLOWED_EMAIL);
const QUOTE_CACHE_MS = 15 * 1000;
const DEFAULT_CATEGORY = 'General';
const QUOTE_SCANNERS = ['crypto', 'america', 'hongkong', 'sweden', 'forex', 'cfd', 'futures'];
const quoteCache = { key: '', expiresAt: 0, data: {} };

const DEFAULT_SYMBOLS = [
  { symbol: 'NASDAQ:AAPL', category: 'General', tags: ['tech', 'mega-cap'] },
  { symbol: 'NASDAQ:MSFT', category: 'General', tags: ['tech', 'ai'] },
  { symbol: 'NASDAQ:NVDA', category: 'General', tags: ['semis', 'ai'] },
  { symbol: 'NASDAQ:TSLA', category: 'General', tags: ['ev', 'active'] },
  { symbol: 'AMEX:SPY', category: 'General', tags: ['etf', 'market'] },
  { symbol: 'NASDAQ:QQQ', category: 'General', tags: ['etf', 'growth'] },
  { symbol: 'BINANCE:BTCUSDT', category: 'General', tags: ['crypto'] },
  { symbol: 'BINANCE:ETHUSDT', category: 'General', tags: ['crypto'] },
  { symbol: 'FX:EURUSD', category: 'General', tags: ['forex'] },
  { symbol: 'TVC:GOLD', category: 'General', tags: ['macro', 'commodities'] }
];

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

function send(req, res, statusCode, body, headers = {}) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  res.writeHead(statusCode, {
    'Content-Length': payload.length,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' https://s3.tradingview.com https://*.tradingview.com 'unsafe-inline'; frame-src https://*.tradingview.com; connect-src 'self' https://*.tradingview.com; img-src 'self' data: https://*.tradingview.com; style-src 'self' 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
    'Cache-Control': statusCode === 200 ? 'public, max-age=300' : 'no-store',
    ...headers
  });
  res.end(req.method === 'HEAD' ? undefined : payload);
}

function sendJson(req, res, statusCode, value) {
  return send(req, res, statusCode, JSON.stringify(value), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
}

function htmlPage(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>${escapeHtml(title)}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#080b12;color:#e8edf7;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}.card{width:min(620px,calc(100vw - 32px));padding:28px;border:1px solid #263244;border-radius:22px;background:#111827;box-shadow:0 24px 80px #0008}.eyebrow{color:#8aa1c7;font-size:12px;text-transform:uppercase;letter-spacing:.14em}h1{margin:8px 0 12px;font-size:28px}p{line-height:1.55;color:#b8c4d9}.btn{display:inline-block;margin-top:14px;padding:12px 16px;border-radius:12px;background:#4f8cff;color:white;text-decoration:none;font-weight:700}.muted{font-size:13px;color:#8fa0ba}code{background:#0b1020;padding:2px 6px;border-radius:6px}</style></head><body><main class="card"><p class="eyebrow">${DOMAIN_TARGET}</p>${body}</main></body></html>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf('=');
    if (index === -1) return [part, ''];
    return [decodeURIComponent(part.slice(0, index)), decodeURIComponent(part.slice(index + 1))];
  }));
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(value) {
  return crypto.createHmac('sha256', AUTH_COOKIE_SECRET).update(value).digest('base64url');
}

function signedCookie(name, value, maxAgeSeconds) {
  const encoded = base64url(value);
  return `${name}=${encodeURIComponent(`${encoded}.${sign(encoded)}`)}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`;
}

function clearCookie(name) {
  return `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

function readSignedCookie(req, name) {
  if (!AUTH_CONFIGURED) return null;
  const raw = parseCookies(req)[name];
  if (!raw || !raw.includes('.')) return null;
  const [encoded, signature] = raw.split('.', 2);
  const expected = sign(encoded);
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    return Buffer.from(encoded, 'base64url').toString('utf8');
  } catch (_error) {
    return null;
  }
}

function getSession(req) {
  const raw = readSignedCookie(req, 'tw_session');
  if (!raw) return null;
  try {
    const session = JSON.parse(raw);
    if (!session.email || session.email.toLowerCase() !== ALLOWED_EMAIL) return null;
    if (!session.exp || Date.now() > session.exp) return null;
    return session;
  } catch (_error) {
    return null;
  }
}

function requireAuth(req, res) {
  if (!AUTH_CONFIGURED) return { email: 'local-demo' };
  const session = getSession(req);
  if (session) return session;
  if (req.url.startsWith('/api/')) {
    sendJson(req, res, 401, { ok: false, error: 'not_authenticated', loginUrl: '/auth/login' });
  } else {
    res.writeHead(302, { Location: '/auth/login' });
    res.end();
  }
  return null;
}

function normalizeSymbol(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

function canonicalSymbolAlias(value) {
  const normalized = normalizeSymbol(value);
  if (normalized === 'HK50' || normalized.endsWith(':HK50')) return 'HSI:HSI';
  const aliases = {
    'HKEX:HSI': 'HSI:HSI',
    'INDEX:HSI': 'HSI:HSI',
    'HKEX:HSTECH': 'HSI:HSTECH',
    'HKEX:HSCEI': 'HSI:HSCEI'
  };
  return aliases[normalized] || normalized;
}

function normalizeTags(value) {
  if (Array.isArray(value)) return value.map(String).map((tag) => tag.trim()).filter(Boolean).slice(0, 20);
  return String(value || '').split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 20);
}

function normalizeCategory(value) {
  const category = String(value || '').trim().replace(/\s+/g, ' ');
  return category || 'General';
}

function normalizeCategories(values = []) {
  const seen = new Set();
  const out = [];
  (Array.isArray(values) ? values : []).forEach((value) => {
    const category = normalizeCategory(value);
    if (!seen.has(category)) {
      seen.add(category);
      out.push(category);
    }
  });
  if (!out.length) out.push(DEFAULT_CATEGORY);
  return out.slice(0, 200);
}

function categoryRegistry(symbols, categories = []) {
  return normalizeCategories([...(Array.isArray(categories) ? categories : []), ...(Array.isArray(symbols) ? symbols : []).map((item) => item && item.category)]);
}

function dedupe(items) {
  const seen = new Set();
  return (Array.isArray(items) ? items : []).reduce((acc, item) => {
    const symbol = canonicalSymbolAlias(item && item.symbol);
    if (!symbol || seen.has(symbol)) return acc;
    seen.add(symbol);
    acc.push({ symbol, name: String(item.name || '').trim().slice(0, 48), category: normalizeCategory(item.category), tags: normalizeTags(item.tags) });
    return acc;
  }, []).slice(0, 2000);
}

function ensureWatchlist() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(WATCHLIST_PATH)) {
    fs.writeFileSync(WATCHLIST_PATH, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), symbols: DEFAULT_SYMBOLS }, null, 2));
  }
}

function readWatchlist() {
  ensureWatchlist();
  try {
    const parsed = JSON.parse(fs.readFileSync(WATCHLIST_PATH, 'utf8'));
    const symbols = dedupe(parsed.symbols);
    return { version: 1, updatedAt: parsed.updatedAt || null, categories: categoryRegistry(symbols, parsed.categories), symbols };
  } catch (_error) {
    return { version: 1, updatedAt: null, categories: categoryRegistry(DEFAULT_SYMBOLS), symbols: DEFAULT_SYMBOLS };
  }
}

function writeWatchlist(symbols, categories = []) {
  ensureWatchlist();
  const normalizedSymbols = dedupe(symbols);
  const payload = { version: 1, updatedAt: new Date().toISOString(), categories: categoryRegistry(normalizedSymbols, categories), symbols: normalizedSymbols };
  const tmpPath = `${WATCHLIST_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2));
  fs.renameSync(tmpPath, WATCHLIST_PATH);
  return payload;
}

function readRequestBody(req, maxBytes = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('request_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function httpsJsonPost(hostname, pathname, body) {
  const payload = Buffer.from(body);
  return new Promise((resolve, reject) => {
    const request = https.request({ hostname, path: pathname, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': payload.length } }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try {
          const json = JSON.parse(text);
          if (response.statusCode >= 400) reject(new Error(json.error_description || json.error || text));
          else resolve(json);
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on('error', reject);
    request.write(payload);
    request.end();
  });
}

function httpsJsonGet(hostname, pathname) {
  return new Promise((resolve, reject) => {
    https.get({ hostname, path: pathname }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try {
          const json = JSON.parse(text);
          if (response.statusCode >= 400) reject(new Error(json.error_description || json.error || text));
          else resolve(json);
        } catch (error) {
          reject(error);
        }
      });
    }).on('error', reject);
  });
}


function normalizeScannerSymbol(value) {
  return normalizeSymbol(value).replace(/\.+$/g, '');
}

function scannerPost(scanner, symbols) {
  const payload = Buffer.from(JSON.stringify({
    symbols: { tickers: symbols, query: { types: [] } },
    columns: ['close', 'change', 'premarket_close', 'premarket_change', 'postmarket_close', 'postmarket_change']
  }));
  return new Promise((resolve) => {
    const request = https.request({
      hostname: 'scanner.tradingview.com',
      path: `/${scanner}/scan`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': payload.length,
        'User-Agent': 'Mozilla/5.0 trading-watchlist'
      },
      timeout: 8000
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        if (response.statusCode >= 400) return resolve({ scanner, data: [] });
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          return resolve({ scanner, data: Array.isArray(parsed.data) ? parsed.data : [] });
        } catch (_error) {
          return resolve({ scanner, data: [] });
        }
      });
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve({ scanner, data: [] }));
    request.write(payload);
    request.end();
  });
}

function cleanSearchText(value) {
  return String(value || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
}

function tradingViewSymbolSearch(query) {
  const text = String(query || '').trim().slice(0, 48);
  if (!text) return Promise.resolve([]);
  const params = new URLSearchParams({ text, hl: '1', exchange: '', lang: 'en', type: '', domain: 'production' });
  return new Promise((resolve) => {
    const request = https.request({
      hostname: 'symbol-search.tradingview.com',
      path: `/symbol_search/?${params.toString()}`,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/125 Safari/537.36',
        'Origin': 'https://www.tradingview.com',
        'Referer': 'https://www.tradingview.com/'
      },
      timeout: 8000
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        if (response.statusCode >= 400) return resolve([]);
        try {
          const parsedRows = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const rows = Array.isArray(parsedRows) ? parsedRows : [];
          rows.sort((a, b) => {
            const score = (row) => {
              const symbol = normalizeSymbol(cleanSearchText(row.symbol));
              const exchange = normalizeSymbol(cleanSearchText(row.exchange || row.source_id || (row.source2 && row.source2.id)));
              const type = String(row.type || '').toLowerCase();
              if (symbol === 'HSI' && exchange === 'HSI' && type === 'index') return 100;
              if (symbol === 'HSI' && exchange === 'TVC' && type === 'index') return 90;
              if (symbol === 'HSI' && type === 'index') return 80;
              return 0;
            };
            return score(b) - score(a);
          });
          return resolve(rows.slice(0, 12).map((row) => {
            const rawSymbol = cleanSearchText(row.symbol);
            const exchange = cleanSearchText(row.exchange || row.source_id || (row.source2 && row.source2.id));
            const canonical = canonicalSymbolAlias(exchange && rawSymbol && !rawSymbol.includes(':') ? `${exchange}:${rawSymbol}` : rawSymbol);
            return {
              symbol: canonical,
              shortSymbol: rawSymbol,
              exchange,
              description: cleanSearchText(row.description),
              type: cleanSearchText(row.type),
              country: cleanSearchText(row.country),
              currency: cleanSearchText(row.currency_code),
              primary: Boolean(row.is_primary_listing)
            };
          }).filter((row) => row.symbol));
        } catch (_error) {
          return resolve([]);
        }
      });
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve([]));
    request.end();
  });
}

function getNewYorkParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(now).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  const hour = Number(parts.hour === '24' ? 0 : parts.hour);
  const minute = Number(parts.minute);
  return { weekday: parts.weekday, minutes: hour * 60 + minute };
}

function currentUsExtendedSession(now = new Date()) {
  const { weekday, minutes } = getNewYorkParts(now);
  if (['Sat', 'Sun'].includes(weekday)) return null;
  if (minutes >= 4 * 60 && minutes < 9 * 60 + 30) return 'pre';
  if (minutes >= 16 * 60 && minutes < 20 * 60) return 'post';
  return null;
}

function currentMarketState(scanner, now = new Date()) {
  if (scanner === 'crypto') return 'continuous';
  if (scanner === 'hongkong') {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Hong_Kong',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(now).reduce((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});
    const hour = Number(parts.hour === '24' ? 0 : parts.hour);
    const minute = Number(parts.minute);
    const minutes = hour * 60 + minute;
    if (['Sat', 'Sun'].includes(parts.weekday)) return 'closed';
    return (minutes >= 9 * 60 + 30 && minutes < 12 * 60) || (minutes >= 13 * 60 && minutes < 16 * 60) ? 'open' : 'closed';
  }
  const { weekday, minutes } = getNewYorkParts(now);
  if (['Sat', 'Sun'].includes(weekday)) return 'closed';
  if (scanner === 'america') return minutes >= 9 * 60 + 30 && minutes < 16 * 60 ? 'open' : 'closed';
  return 'open';
}

function parseQuoteRow(row, scanner, session = currentUsExtendedSession()) {
  if (!row || !row.s || !Array.isArray(row.d)) return null;
  const last = Number(row.d[0]);
  const changePercent = Number(row.d[1]);
  if (!Number.isFinite(last) || !Number.isFinite(changePercent)) return null;
  const preMarketLast = Number(row.d[2]);
  const preMarketChangePercent = Number(row.d[3]);
  const postMarketLast = Number(row.d[4]);
  const postMarketChangePercent = Number(row.d[5]);
  const extended = {};
  if (scanner === 'america' && session === 'pre' && Number.isFinite(preMarketLast)) {
    extended.pre = { last: preMarketLast, changePercent: Number.isFinite(preMarketChangePercent) ? preMarketChangePercent : null };
  }
  if (scanner === 'america' && session === 'post' && Number.isFinite(postMarketLast)) {
    extended.post = { last: postMarketLast, changePercent: Number.isFinite(postMarketChangePercent) ? postMarketChangePercent : null };
  }
  return { symbol: row.s, last, changePercent, extended, extendedSession: session, scanner, marketState: currentMarketState(scanner), updatedAt: new Date().toISOString() };
}

function quoteCandidates(symbol) {
  const normalized = normalizeScannerSymbol(symbol);
  if (!normalized) return [];
  if (normalized === 'HK50' || normalized.endsWith(':HK50')) return ['HSI:HSI', 'TVC:HSI'];
  const explicitAliases = {
    'HKEX:HSI': ['HSI:HSI', 'TVC:HSI', 'INDEX:HSI'],
    'INDEX:HSI': ['HSI:HSI', 'TVC:HSI', 'INDEX:HSI'],
    'TVC:HSI': ['TVC:HSI', 'HSI:HSI'],
    'HKEX:HSTECH': ['HSI:HSTECH'],
    'HKEX:HSCEI': ['HSI:HSCEI']
  };
  if (explicitAliases[normalized]) return explicitAliases[normalized];
  const aliases = {
    'ETHUSDT': ['BINANCE:ETHUSDT'],
    'BTCUSDT': ['BINANCE:BTCUSDT'],
    'FARTCOINUSDT.!': ['BINANCE:FARTCOINUSDT.P'],
    'FARTCOINUSDT': ['BINANCE:FARTCOINUSDT.P'],
    'HYPEUSDT.P': ['BINANCE:HYPEUSDT.P'],
    'SOLUSDT': ['BINANCE:SOLUSDT'],
    'ZECUSDT': ['BINANCE:ZECUSDT'],
    'VIX': ['TVC:VIX', 'CBOE:VIX'],
    'ES1!': ['CME_MINI:ES1!'],
    'NQ1!': ['CME_MINI:NQ1!'],
    'NIKKEI': ['TVC:NI225'],
    'BRENT': ['ICEEUR:BRN1!', 'CAPITALCOM:BRENT'],
    'AAOI': ['NASDAQ:AAOI'],
    'BABA': ['NYSE:BABA'],
    'BB': ['NYSE:BB'],
    'DGXX': ['NASDAQ:DGXX'],
    'HLIT': ['NASDAQ:HLIT'],
    'IREN': ['NASDAQ:IREN'],
    'LAC': ['NYSE:LAC'],
    'MU': ['NASDAQ:MU'],
    'NBIS': ['NASDAQ:NBIS'],
    'NOK': ['NYSE:NOK'],
    'NOW': ['NYSE:NOW'],
    'NVDA': ['NASDAQ:NVDA'],
    'SIVE': ['OMXSTO:SIVE', 'NASDAQ:SIVE'],
    'TSLA': ['NASDAQ:TSLA']
  };
  if (normalized.includes(':')) return [normalized];
  const suffixAliases = normalized.endsWith('USDT') ? [`BINANCE:${normalized}`] : [];
  return [normalized, ...(aliases[normalized] || []), ...suffixAliases, `NASDAQ:${normalized}`, `NYSE:${normalized}`, `AMEX:${normalized}`, `TVC:${normalized}`];
}

async function fetchQuotes(symbols) {
  const requested = Array.from(new Set((Array.isArray(symbols) ? symbols : [])
    .map(normalizeScannerSymbol)
    .filter(Boolean)))
    .slice(0, 200);
  const key = requested.slice().sort().join('|');
  if (!requested.length) return {};
  if (quoteCache.key === key && Date.now() < quoteCache.expiresAt) return quoteCache.data;

  const aliasToRequested = new Map();
  const scannerSymbols = [];
  requested.forEach((symbol) => {
    quoteCandidates(symbol).forEach((candidate) => {
      if (!aliasToRequested.has(candidate)) {
        aliasToRequested.set(candidate, symbol);
        scannerSymbols.push(candidate);
      }
    });
  });

  const results = await Promise.all(QUOTE_SCANNERS.map((scanner) => scannerPost(scanner, scannerSymbols)));
  const quotes = {};
  results.forEach(({ scanner, data }) => {
    data.forEach((row) => {
      const quote = parseQuoteRow(row, scanner);
      if (!quote) return;
      const scannerSymbol = normalizeScannerSymbol(quote.symbol);
      const requestedSymbol = aliasToRequested.get(scannerSymbol) || scannerSymbol;
      if (!quotes[requestedSymbol]) quotes[requestedSymbol] = { ...quote, symbol: requestedSymbol, sourceSymbol: scannerSymbol };
    });
  });
  quoteCache.key = key;
  quoteCache.expiresAt = Date.now() + QUOTE_CACHE_MS;
  quoteCache.data = quotes;
  return quotes;
}

async function handleAuth(req, res, url) {
  if (url.pathname === '/auth/login') {
    if (!AUTH_CONFIGURED) return requireAuth(req, res);
    const state = crypto.randomBytes(24).toString('base64url');
    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: `${BASE_URL}/auth/callback`,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      prompt: 'select_account'
    });
    res.writeHead(302, { Location: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`, 'Set-Cookie': signedCookie('tw_oauth_state', state, 600) });
    return res.end();
  }

  if (url.pathname === '/auth/logout') {
    res.writeHead(302, { Location: '/auth/login', 'Set-Cookie': clearCookie('tw_session') });
    return res.end();
  }

  if (url.pathname === '/auth/callback') {
    try {
      if (!AUTH_CONFIGURED) return requireAuth(req, res);
      const expectedState = readSignedCookie(req, 'tw_oauth_state');
      if (!expectedState || expectedState !== url.searchParams.get('state')) throw new Error('Invalid OAuth state');
      const code = url.searchParams.get('code');
      if (!code) throw new Error('Missing OAuth code');
      const token = await httpsJsonPost('oauth2.googleapis.com', '/token', querystring.stringify({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: `${BASE_URL}/auth/callback`
      }));
      const info = await httpsJsonGet('oauth2.googleapis.com', `/tokeninfo?id_token=${encodeURIComponent(token.id_token)}`);
      const email = String(info.email || '').toLowerCase();
      if (info.aud !== GOOGLE_CLIENT_ID) throw new Error('Invalid Google token audience');
      if (info.email_verified !== 'true' && info.email_verified !== true) throw new Error('Google email is not verified');
      if (email !== ALLOWED_EMAIL) {
        const denied = htmlPage('Access denied', `<h1>Access denied</h1><p>This site is restricted to <code>${escapeHtml(ALLOWED_EMAIL)}</code>.</p><p>You signed in as <code>${escapeHtml(email || 'unknown')}</code>.</p><a class="btn" href="/auth/logout">Try another account</a>`);
        return send(req, res, 403, denied, { 'Content-Type': MIME_TYPES['.html'], 'Set-Cookie': clearCookie('tw_oauth_state'), 'Cache-Control': 'no-store' });
      }
      const session = JSON.stringify({ email, name: info.name || '', exp: Date.now() + 30 * 24 * 60 * 60 * 1000 });
      res.writeHead(302, { Location: '/', 'Set-Cookie': [signedCookie('tw_session', session, 30 * 24 * 60 * 60), clearCookie('tw_oauth_state')] });
      return res.end();
    } catch (error) {
      const body = htmlPage('Login failed', `<h1>Login failed</h1><p>${escapeHtml(error.message)}</p><a class="btn" href="/auth/login">Try again</a>`);
      return send(req, res, 400, body, { 'Content-Type': MIME_TYPES['.html'], 'Set-Cookie': clearCookie('tw_oauth_state'), 'Cache-Control': 'no-store' });
    }
  }

  return send(req, res, 404, 'Not Found', { 'Content-Type': 'text/plain; charset=utf-8' });
}

async function handleApi(req, res, url, session) {
  if (url.pathname === '/api/me' && req.method === 'GET') {
    return sendJson(req, res, 200, { ok: true, email: session.email });
  }

  if (url.pathname === '/api/search-symbols' && req.method === 'GET') {
    const query = String(url.searchParams.get('q') || url.searchParams.get('query') || '').trim();
    const results = await tradingViewSymbolSearch(query);
    return sendJson(req, res, 200, { ok: true, results });
  }

  if (url.pathname === '/api/quotes' && req.method === 'GET') {
    const requested = String(url.searchParams.get('symbols') || '').split(',').map((item) => item.trim()).filter(Boolean);
    const symbols = requested.length ? requested : readWatchlist().symbols.map((item) => item.symbol);
    const quotes = await fetchQuotes(symbols);
    return sendJson(req, res, 200, { ok: true, quotes, source: 'TradingView scanner delayed', extendedSession: currentUsExtendedSession(), cacheSeconds: Math.round(QUOTE_CACHE_MS / 1000) });
  }

  if (url.pathname === '/api/watchlist' && req.method === 'GET') {
    return sendJson(req, res, 200, { ok: true, watchlist: readWatchlist() });
  }

  if (url.pathname === '/api/watchlist' && req.method === 'PUT') {
    try {
      const body = JSON.parse(await readRequestBody(req));
      const items = Array.isArray(body) ? body : body.symbols;
      if (!Array.isArray(items)) return sendJson(req, res, 400, { ok: false, error: 'symbols_array_required' });
      const categories = Array.isArray(body && body.categories) ? body.categories : [];
      const watchlist = writeWatchlist(items, categories);
      return sendJson(req, res, 200, { ok: true, watchlist });
    } catch (error) {
      return sendJson(req, res, error.message === 'request_too_large' ? 413 : 400, { ok: false, error: error.message });
    }
  }

  return sendJson(req, res, 404, { ok: false, error: 'not_found' });
}

function safeFilePath(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]);
  } catch (_error) {
    return null;
  }
  const normalized = path.normalize(decoded).replace(/^([/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, normalized || 'index.html');
  if (!filePath.startsWith(PUBLIC_DIR)) return null;
  return filePath;
}

function serveStatic(req, res, url) {
  let filePath = safeFilePath(url.pathname);
  if (!filePath) return send(req, res, 400, 'Bad Request', { 'Content-Type': 'text/plain; charset=utf-8' });
  fs.stat(filePath, (statErr, stat) => {
    if (!statErr && stat.isDirectory()) filePath = path.join(filePath, 'index.html');
    fs.readFile(filePath, (readErr, data) => {
      if (readErr) {
        if (path.extname(url.pathname)) return send(req, res, 404, 'Not Found', { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (fallbackErr, fallback) => {
          if (fallbackErr) return send(req, res, 404, 'Not Found', { 'Content-Type': 'text/plain; charset=utf-8' });
          return send(req, res, 200, fallback, { 'Content-Type': MIME_TYPES['.html'], 'Cache-Control': 'no-store' });
        });
      }
      const ext = path.extname(filePath).toLowerCase();
      return send(req, res, 200, data, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=300' });
    });
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || DOMAIN_TARGET}`);

    if (url.pathname === '/health') {
      return sendJson(req, res, 200, { ok: true, service: 'trading-watchlist', domainTarget: DOMAIN_TARGET, authConfigured: AUTH_CONFIGURED, allowedEmail: ALLOWED_EMAIL || null, authMode: AUTH_CONFIGURED ? 'google' : 'local', time: new Date().toISOString() });
    }

    if (url.pathname.startsWith('/auth/')) return handleAuth(req, res, url);

    if (url.pathname.startsWith('/api/')) {
      if (!['GET', 'PUT'].includes(req.method)) return send(req, res, 405, 'Method Not Allowed', { Allow: 'GET, PUT', 'Content-Type': 'text/plain; charset=utf-8' });
      const session = requireAuth(req, res);
      if (!session) return;
      return handleApi(req, res, url, session);
    }

    if (!['GET', 'HEAD'].includes(req.method)) return send(req, res, 405, 'Method Not Allowed', { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
    if (!requireAuth(req, res)) return;
    return serveStatic(req, res, url);
  } catch (error) {
    console.error('Request failed', error);
    return send(req, res, 500, 'Internal Server Error', { 'Content-Type': 'text/plain; charset=utf-8' });
  }
});

ensureWatchlist();
server.listen(PORT, HOST, () => {
  console.log(`Trading Watchlist listening on http://${HOST}:${PORT}`);
  console.log(`Domain target: ${DOMAIN_TARGET}`);
  console.log(`Auth mode: ${AUTH_CONFIGURED ? 'google' : 'local (disabled)'}`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
