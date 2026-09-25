const path = require('node:path');
const express = require('express');
const cookieSession = require('cookie-session');
const config = require('./src/config');
const auth = require('./src/auth');
const { v1, site } = require('./src/api-public');
const adminApi = require('./src/api-admin');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('X-Frame-Options', 'DENY');
  next();
});

app.use(cookieSession({
  name: 'mctl_session',
  secret: config.sessionSecret,
  httpOnly: true,
  sameSite: 'lax',
  secure: config.cookieSecure,
  maxAge: 7 * 24 * 60 * 60 * 1000,
}));
app.use(express.json({ limit: '32kb' }));

app.use('/api/v1', v1);
app.use('/api/site', site);
app.use('/api/admin', adminApi);
app.use(auth.router);

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], maxAge: '1h' }));
app.get('/player/:name', (req, res) => res.sendFile(path.join(__dirname, 'public', 'player.html')));
app.use((req, res) => res.status(404).sendFile(path.join(__dirname, 'public', '404.html')));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: 'server_error' });
});

app.listen(config.port, () => {
  console.log(`${config.siteName} running on ${config.baseUrl} (port ${config.port})`);
});
