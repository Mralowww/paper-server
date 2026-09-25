const express = require('express');
const config = require('./config');
const { db, rankedPlayers, publicPlayer, stats } = require('./db');
const { MODES, TIERS, REGIONS, REGION_IDS } = require('./tiers');
const { createRateLimiter, sha256, clampInt } = require('./util');

/** Shared read handlers used by both the key-protected developer API and the website's own API. */
const handlers = {
  stats: (req, res) => res.json(stats()),

  modes: (req, res) => res.json({ modes: MODES, tiers: TIERS, regions: REGIONS }),

  rankings: (req, res) => {
    if (!MODES.some((m) => m.id === req.params.mode)) return res.status(404).json({ error: 'unknown_mode' });
    let players = rankedPlayers();
    const region = String(req.query.region || '').toUpperCase();
    if (region) {
      if (!REGION_IDS.has(region)) return res.status(400).json({ error: 'invalid_region' });
      players = players.filter((p) => p.region === region);
    }
    const tier = String(req.query.tier || '').toUpperCase();
    // Accepts an exact tier ("HT1") or a tier group ("1" matches HT1 and LT1).
    if (tier) players = players.filter((p) => (/^[1-5]$/.test(tier) ? p.tier.endsWith(tier) : p.tier === tier));
    const search = String(req.query.search || '').toLowerCase();
    if (search) players = players.filter((p) => p.name.toLowerCase().includes(search));
    const total = players.length;
    const limit = clampInt(req.query.limit, 1, 100, 50);
    const offset = clampInt(req.query.offset, 0, 1e9, 0);
    res.json({ mode: req.params.mode, total, limit, offset, players: players.slice(offset, offset + limit).map(publicPlayer) });
  },

  player: (req, res) => {
    const name = String(req.params.name).toLowerCase();
    const p = rankedPlayers().find((x) => x.name.toLowerCase() === name || (x.uuid && x.uuid.replace(/-/g, '') === name.replace(/-/g, '')));
    if (!p) return res.status(404).json({ error: 'player_not_found' });
    res.json(publicPlayer(p));
  },
};

function mountReadRoutes(router) {
  router.get('/stats', handlers.stats);
  router.get('/modes', handlers.modes);
  router.get('/rankings/:mode', handlers.rankings);
  router.get('/players', (req, res) => { req.params.mode = 'vanilla'; handlers.rankings(req, res); });
  router.get('/players/:name', handlers.player);
  router.use((req, res) => res.status(404).json({ error: 'not_found' }));
  return router;
}

// ---- Developer API: requires an API key ----
const v1 = express.Router();
const apiLimiter = createRateLimiter(config.apiRateLimitPerMin);

v1.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'X-API-Key, Authorization');
  res.set('Access-Control-Expose-Headers', 'X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, Retry-After');
  if (req.method === 'OPTIONS') return res.sendStatus(204);

  const auth = req.get('authorization') || '';
  const key = req.get('x-api-key') || (auth.startsWith('Bearer ') ? auth.slice(7) : '');
  if (!key) return res.status(401).json({ error: 'missing_api_key', message: 'Send your key in the X-API-Key header.' });
  const row = db.prepare('SELECT id, revoked FROM api_keys WHERE key_hash = ?').get(sha256(key.trim()));
  if (!row || row.revoked) return res.status(401).json({ error: 'invalid_api_key' });
  if (!apiLimiter(`key:${row.id}`, res)) return;
  db.prepare('UPDATE api_keys SET usage_count = usage_count + 1, last_used_at = ? WHERE id = ?').run(Date.now(), row.id);
  next();
});
mountReadRoutes(v1);

// ---- Website API: same-origin only, rate limited per IP ----
const site = express.Router();
const siteLimiter = createRateLimiter(config.siteRateLimitPerMin);
site.use((req, res, next) => {
  const fetchSite = req.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin') {
    return res.status(403).json({ error: 'use_developer_api', message: 'Use /api/v1 with an API key.' });
  }
  if (!siteLimiter(`ip:${req.ip}`, res)) return;
  next();
});
mountReadRoutes(site);

module.exports = { v1, site };
