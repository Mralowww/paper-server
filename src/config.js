const fs = require('node:fs');
const path = require('node:path');

const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const list = (value, fallback) =>
  (value ?? fallback).split(',').map((s) => s.trim()).filter(Boolean);

const baseUrl = (process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, '');

const config = {
  port: Number(process.env.PORT) || 3000,
  baseUrl,
  siteName: process.env.SITE_NAME || 'Mc.Tierlist.Asia',
  dataDir: process.env.DATA_DIR || path.join(__dirname, '..', 'data'),
  sessionSecret: process.env.SESSION_SECRET || '',
  cookieSecure: baseUrl.startsWith('https://'),
  discord: {
    clientId: process.env.DISCORD_CLIENT_ID || '',
    clientSecret: process.env.DISCORD_CLIENT_SECRET || '',
    redirectUri: `${baseUrl}/auth/discord/callback`,
  },
  // Super admins listed here are seeded on start and can never be removed or demoted from the panel.
  superAdminIds: list(process.env.SUPER_ADMIN_IDS, '995145509897523221'),
  // Regular admins seeded on first start; afterwards they are managed from the panel.
  seedAdminIds: list(process.env.ADMIN_IDS, '1041596704434167868'),
  apiRateLimitPerMin: Number(process.env.API_RATE_LIMIT_PER_MIN) || 60,
  siteRateLimitPerMin: Number(process.env.SITE_RATE_LIMIT_PER_MIN) || 240,
  allowDevLogin: process.env.ALLOW_DEV_LOGIN === 'true' && process.env.NODE_ENV !== 'production',
};

if (!config.sessionSecret) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET must be set in production');
  }
  config.sessionSecret = 'dev-only-insecure-secret';
  console.warn('[config] SESSION_SECRET is not set; using an insecure development secret.');
}

module.exports = config;
