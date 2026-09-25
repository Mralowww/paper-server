const crypto = require('node:crypto');
const express = require('express');
const config = require('./config');
const { db, audit } = require('./db');

const router = express.Router();

const DISCORD_API = 'https://discord.com/api/v10';

router.get('/auth/discord', (req, res) => {
  if (!config.discord.clientId || !config.discord.clientSecret) {
    return res.redirect('/admin?error=not_configured');
  }
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;
  const params = new URLSearchParams({
    client_id: config.discord.clientId,
    redirect_uri: config.discord.redirectUri,
    response_type: 'code',
    scope: 'identify',
    state,
    prompt: 'none',
  });
  res.redirect(`https://discord.com/oauth2/authorize?${params}`);
});

router.get('/auth/discord/callback', async (req, res) => {
  const { code, state } = req.query;
  const expected = req.session.oauthState;
  req.session.oauthState = null;
  if (!code || !state || !expected || state !== expected) {
    return res.redirect('/admin?error=invalid_state');
  }
  try {
    const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.discord.clientId,
        client_secret: config.discord.clientSecret,
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: config.discord.redirectUri,
      }),
    });
    if (!tokenRes.ok) throw new Error(`token exchange failed: ${tokenRes.status}`);
    const token = await tokenRes.json();

    const userRes = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    if (!userRes.ok) throw new Error(`user fetch failed: ${userRes.status}`);
    const user = await userRes.json();

    return signIn(req, res, { id: user.id, username: user.global_name || user.username, avatar: user.avatar });
  } catch (err) {
    console.error('[auth] Discord login failed:', err.message);
    return res.redirect('/admin?error=discord_failed');
  }
});

if (config.allowDevLogin) {
  console.warn('[auth] ALLOW_DEV_LOGIN is enabled — /auth/dev lets anyone sign in as any admin. Never enable in production.');
  router.get('/auth/dev', (req, res) => {
    signIn(req, res, { id: String(req.query.id || ''), username: `dev-${req.query.id}`, avatar: null });
  });
}

function signIn(req, res, user) {
  const admin = db.prepare('SELECT * FROM admins WHERE discord_id = ?').get(user.id);
  if (!admin) {
    audit({ id: user.id, username: user.username }, 'login_denied', 'Not an admin');
    return res.redirect('/admin?error=not_admin');
  }
  db.prepare('UPDATE admins SET username = ?, avatar = ?, last_login_at = ? WHERE discord_id = ?')
    .run(user.username, user.avatar, Date.now(), user.id);
  req.session.userId = user.id;
  audit({ id: user.id, username: user.username }, 'login', null);
  return res.redirect('/admin');
}

router.post('/auth/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

/** Loads the signed-in admin from the DB on every request, so removals take effect immediately. */
function requireAdmin(req, res, next) {
  const id = req.session?.userId;
  const admin = id && db.prepare('SELECT * FROM admins WHERE discord_id = ?').get(id);
  if (!admin) {
    if (req.session) req.session.userId = null;
    return res.status(401).json({ error: 'unauthorized' });
  }
  req.admin = { id: admin.discord_id, username: admin.username || admin.discord_id, avatar: admin.avatar, role: admin.role };
  next();
}

function requireSuper(req, res, next) {
  if (req.admin?.role !== 'super') return res.status(403).json({ error: 'forbidden', message: '只有超級管理員可以執行此操作' });
  next();
}

/** Blocks cross-origin state-changing requests to the cookie-authenticated admin API. */
function sameOrigin(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const origin = req.get('origin');
  if (origin) {
    let host;
    try { host = new URL(origin).host; } catch { host = null; }
    if (host !== req.get('host')) return res.status(403).json({ error: 'bad_origin' });
  } else if (req.get('sec-fetch-site') && req.get('sec-fetch-site') !== 'same-origin') {
    return res.status(403).json({ error: 'bad_origin' });
  }
  next();
}

module.exports = { router, requireAdmin, requireSuper, sameOrigin };
