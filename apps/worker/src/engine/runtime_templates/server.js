import express from 'express';
import { PrismaClient } from '@prisma/client';
import { load } from 'cheerio';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvironment } from './environment.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
loadEnvironment(root);
const host = process.env.HOST || '127.0.0.1';
const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const adminPassword = process.env.ADMIN_PASSWORD || '';
const defaultCredentials = adminEmail === 'admin@gmail.com' && adminPassword === 'admin123';
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail) || !adminPassword) {
  throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD in backend/.env before starting.');
}
if (defaultCredentials && (process.env.NODE_ENV === 'production' || !['127.0.0.1', 'localhost', '::1'].includes(host))) {
  throw new Error('Default admin credentials are local-only. Set a unique password of at least 12 characters in backend/.env.');
}
if (!defaultCredentials && adminPassword.length < 12) {
  throw new Error('ADMIN_PASSWORD must contain at least 12 characters.');
}
process.env.DATABASE_URL ||= 'file:./site.db';
const db = new PrismaClient();
const seed = JSON.parse(readFileSync(resolve(root, 'seed-data.json'), 'utf8'));
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '20mb' }));
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const hash = value => createHash('sha256').update(value).digest('hex');
function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  return salt + ':' + scryptSync(password, salt, 64).toString('hex');
}
function passwordMatches(password, stored) {
  const actual = Buffer.from(passwordHash(password, stored.split(':')[0]));
  const expected = Buffer.from(stored);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
const authorize = wrap(async (req, res, next) => {
  const token = req.headers.authorization?.replace(/^Bearer /, '');
  const session = token && await db.siteSession.findUnique({ where: { tokenHash: hash(token) } });
  if (!session || session.expiresAt < new Date()) return res.status(401).json({ error: 'Sign in required' });
  next();
});
const attempts = new Map();
app.post('/api/admin/login', wrap(async (req, res) => {
  const entry = attempts.get(req.ip) || { count: 0, since: Date.now() };
  if (Date.now() - entry.since > 900000) { entry.count = 0; entry.since = Date.now(); }
  if (++entry.count > 20) return res.status(429).json({ error: 'Too many sign-in attempts' });
  attempts.set(req.ip, entry);
  const { email, password } = req.body || {};
  const user = typeof email === 'string' && await db.siteAdmin.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user || typeof password !== 'string' || !passwordMatches(password, user.passwordHash))
    return res.status(401).json({ error: 'Invalid email or password' });
  attempts.delete(req.ip);
  const token = randomBytes(32).toString('hex');
  await db.siteSession.create({ data: { tokenHash: hash(token), expiresAt: new Date(Date.now() + 28800000) } });
  res.json({ token });
}));
app.post('/api/admin/logout', authorize, wrap(async (req, res) => {
  await db.siteSession.deleteMany({ where: { tokenHash: hash(req.headers.authorization.replace(/^Bearer /, '')) } });
  res.json({ ok: true });
}));
app.get('/health', wrap(async (req, res) => { await db.$queryRaw`SELECT 1`; res.json({ status: 'ok' }); }));
app.get('/api/admin/config', (req, res) => res.json({
  siteTitle: seed.pages.find(page => page.route === seed.homeRoute)?.title || 'Your website',
  coverImage: seed.media.find(item => String(item.type).startsWith('image/'))?.url || '',
}));
app.get('/api/admin/account', authorize, (req, res) => res.json({ defaultCredentials }));
app.get('/api/admin/schema', authorize, (req, res) => res.json(seed.schema));
app.get('/api/admin/pages', authorize, wrap(async (req, res) => {
  res.json(await db.sitePage.findMany({ select: { id: true, title: true, route: true, published: true, updatedAt: true }, orderBy: { route: 'asc' } }));
}));
app.get('/api/admin/pages/:id', authorize, wrap(async (req, res) => {
  const page = await db.sitePage.findUnique({ where: { id: req.params.id } });
  if (!page) return res.status(404).json({ error: 'Page not found' });
  res.json({ ...page, fields: JSON.parse(page.fields) });
}));
function validRoute(route) {
  return typeof route === 'string' && route.startsWith('/') && !route.startsWith('//') &&
    !/^\/(api|assets|admin|__site)(\/|$)/.test(route) && !route.includes('#');
}
app.put('/api/admin/pages/:id', authorize, wrap(async (req, res) => {
  const page = await db.sitePage.findUnique({ where: { id: req.params.id } });
  if (!page) return res.status(404).json({ error: 'Page not found' });
  const fields = JSON.parse(page.fields);
  const edits = req.body.fields;
  if (!Array.isArray(edits) || edits.length !== fields.length) return res.status(400).json({ error: 'Invalid page fields' });
  for (let i = 0; i < fields.length; i++) {
    if (edits[i].id !== fields[i].id || typeof edits[i].value !== 'string')
      return res.status(400).json({ error: 'Invalid field value' });
    if (fields[i].kind === 'url' && edits[i].value !== fields[i].value && edits[i].value !== '' &&
        !/^(https?:\/\/|\/|#|mailto:|tel:)/i.test(edits[i].value))
      return res.status(400).json({ error: 'Links must use http, https, mailto, tel or a local path' });
    fields[i].value = edits[i].value;
  }
  const route = req.body.route ?? page.route;
  if (!validRoute(route)) return res.status(400).json({ error: 'Invalid page route' });
  const title = typeof req.body.title === 'string' ? req.body.title : page.title;
  await db.sitePage.update({ where: { id: page.id }, data: { title, route, fields: JSON.stringify(fields),
    published: typeof req.body.published === 'boolean' ? req.body.published : page.published } });
  res.json({ ok: true });
}));
app.post('/api/admin/pages', authorize, wrap(async (req, res) => {
  const source = await db.sitePage.findUnique({ where: { id: String(req.body.sourceId || '') } });
  if (!source || !validRoute(req.body.route)) return res.status(400).json({ error: 'Select a source page and valid route' });
  const copy = await db.sitePage.create({ data: { id: randomBytes(16).toString('hex'), route: req.body.route,
    title: String(req.body.title || source.title), html: source.html, fields: source.fields, published: false } });
  res.status(201).json(copy);
}));
app.delete('/api/admin/pages/:id', authorize, wrap(async (req, res) => {
  await db.sitePage.delete({ where: { id: req.params.id } }); res.json({ ok: true });
}));
const mediaTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg' };
app.get('/api/admin/media', authorize, (req, res) => {
  const directory = resolve(root, 'uploads');
  const uploads = existsSync(directory) ? readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && /^[a-f0-9]{32}\.(png|jpg|webp|gif|mp4|mp3)$/.test(entry.name))
    .map(entry => ({ url: '/assets/uploads/' + entry.name, type: mediaTypes[entry.name.slice(entry.name.lastIndexOf('.'))] })) : [];
  res.json([...seed.media, ...uploads]);
});
app.post('/api/admin/media', authorize, express.raw({ type: ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'audio/mpeg'], limit: '50mb' }), (req, res) => {
  if (!Buffer.isBuffer(req.body)) return res.status(400).json({ error: 'Unsupported media format' });
  const extensions = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'video/mp4': '.mp4', 'audio/mpeg': '.mp3' };
  const type = req.headers['content-type']?.split(';')[0].trim().toLowerCase();
  if (!extensions[type]) return res.status(400).json({ error: 'Unsupported media format' });
  const name = randomBytes(16).toString('hex') + extensions[type];
  const dir = resolve(root, 'uploads'); mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, name), req.body);
  res.status(201).json({ url: '/assets/uploads/' + name });
});
app.get('/api/admin/records/:entity', authorize, wrap(async (req, res) => {
  const rows = await db.siteRecord.findMany({ where: { entity: req.params.entity } });
  res.json(rows.map(row => ({ ...row, data: JSON.parse(row.data) })));
}));
function validRecord(entity, data) {
  const definition = seed.schema.entities.find(item => item.name === entity);
  if (!definition || !data || typeof data !== 'object' || Array.isArray(data)) return false;
  const fields = new Map(definition.fields.map(field => [field.name, field]));
  return Object.entries(data).every(([key, value]) => {
    const field = fields.get(key);
    if (!field) return false;
    if (value === null) return true;
    const type = String(field.type).toLowerCase();
    if (['int', 'integer'].includes(type)) return Number.isInteger(value);
    if (['float', 'number', 'decimal'].includes(type)) return typeof value === 'number' && Number.isFinite(value);
    if (['bool', 'boolean'].includes(type)) return typeof value === 'boolean';
    return typeof value === 'string';
  });
}
app.post('/api/admin/records/:entity', authorize, wrap(async (req, res) => {
  if (!validRecord(req.params.entity, req.body)) return res.status(400).json({ error: 'Values do not match the approved schema' });
  const row = await db.siteRecord.create({ data: { entity: req.params.entity, data: JSON.stringify(req.body) } });
  res.status(201).json(row);
}));
app.put('/api/admin/records/:entity/:id', authorize, wrap(async (req, res) => {
  if (!validRecord(req.params.entity, req.body)) return res.status(400).json({ error: 'Values do not match the approved schema' });
  const result = await db.siteRecord.updateMany({ where: { id: req.params.id, entity: req.params.entity }, data: { data: JSON.stringify(req.body) } });
  if (!result.count) return res.status(404).json({ error: 'Record not found' });
  res.json({ ok: true });
}));
app.delete('/api/admin/records/:entity/:id', authorize, wrap(async (req, res) => {
  await db.siteRecord.deleteMany({ where: { id: req.params.id, entity: req.params.entity } }); res.json({ ok: true });
}));
app.use('/assets/uploads', express.static(resolve(root, 'uploads')));
app.use('/assets', express.static(resolve(root, '../frontend/public/assets')));
app.get('/__runtime/navigation.js', (req, res) => res.type('application/javascript').send(`
document.addEventListener('click', event => {
  if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
  if (!link || link.hasAttribute('download') || link.target !== '_parent') return;
  const url = new URL(link.href, location.href);
  if (url.origin !== location.origin) return;
  event.preventDefault();
  window.parent.postMessage({ type: 'converted-site:navigate', path: url.pathname + url.search + url.hash }, location.origin);
}, true);
`));
app.use(express.static(resolve(root, '../frontend/public')));
app.get('/__site/*', wrap(async (req, res) => {
  let route = req.originalUrl.slice('/__site'.length) || '/';
  if (seed.sourceType === 'zip') route = route.split('?')[0];
  let page = await db.sitePage.findUnique({ where: { route } });
  if (!page && route === '/') page = await db.sitePage.findUnique({ where: { route: seed.homeRoute } });
  if (!page || !page.published) return res.status(404).type('html').send('<h1>Page not found</h1>');
  const $ = load(page.html, { xml: { xmlMode: false, decodeEntities: false } });
  for (const field of JSON.parse(page.fields)) {
    const element = $('[data-converter-id="' + field.element + '"]');
    if (field.attribute) {
      if (field.attribute === 'src' && element.is('img') && element.attr('src') !== field.value) {
        element.removeAttr('srcset data-srcset data-src');
        element.closest('picture').find('source').attr('srcset', field.value);
      }
      element.attr(field.attribute, field.value);
    }
    else {
      const child = element.contents().get(field.index);
      if (child?.type === 'text') child.data = field.value;
    }
  }
  $('title').text(page.title);
  if (process.env.PREVIEW_MODE === '1') {
    $('a[target="_top"]').attr('target', '_parent');
    $('body').append('<script src="/__runtime/navigation.js"></script>');
  }
  res.set('Cache-Control', 'no-store').type('html').send($.html());
}));
const dist = resolve(root, '../frontend/dist');
app.use(express.static(dist));
app.get('*', (req, res) => existsSync(resolve(dist, 'index.html'))
  ? res.sendFile(resolve(dist, 'index.html')) : res.status(503).send('Build the frontend first.'));
app.use((error, req, res, next) => {
  console.error(error.message);
  res.status(error.code === 'P2002' ? 409 : 500).json({ error: error.code === 'P2002' ? 'This route already exists' : 'Request failed' });
});
await db.$transaction(async tx => {
  if (await tx.siteSetting.findUnique({ where: { key: 'sourceInitialized' } })) return;
  for (const page of seed.pages) {
    await tx.sitePage.upsert({ where: { id: page.id }, create: { ...page, fields: JSON.stringify(page.fields) }, update: {} });
  }
  await tx.siteSetting.create({ data: { key: 'sourceInitialized', value: 'true' } });
});
await db.$transaction(async tx => {
  const managed = await tx.siteSetting.findUnique({ where: { key: 'environmentAdminId' } });
  let user = managed ? await tx.siteAdmin.findUnique({ where: { id: managed.value } })
    : await tx.siteAdmin.findUnique({ where: { email: adminEmail } });
  // Adopt the sole account from older generated runtimes when upgrading.
  if (!managed && !user) {
    const existing = await tx.siteAdmin.findMany({ take: 2 });
    if (existing.length === 1) user = existing[0];
  }
  const changed = user && (user.email !== adminEmail || !passwordMatches(adminPassword, user.passwordHash));
  if (!user) {
    user = await tx.siteAdmin.create({ data: { email: adminEmail, passwordHash: passwordHash(adminPassword) } });
  } else if (changed) {
    user = await tx.siteAdmin.update({ where: { id: user.id },
      data: { email: adminEmail, passwordHash: passwordHash(adminPassword) } });
    await tx.siteSession.deleteMany();
  }
  await tx.siteSetting.upsert({ where: { key: 'environmentAdminId' },
    create: { key: 'environmentAdminId', value: user.id }, update: { value: user.id } });
});
if (defaultCredentials) console.warn('Local setup credentials active. Replace them before deployment.');
const server = app.listen(Number(process.env.PORT || 5000), host, () =>
  console.log(JSON.stringify({ event: 'listening', port: server.address().port })));
async function shutdown() { server.close(); await db.$disconnect(); }
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
