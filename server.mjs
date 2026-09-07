import http from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { createHash, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';
import { totals, difference, identifier } from './core.mjs';

const env = process.env;
const fileSecret = (key) => env[key + '_FILE'] ? readFileSync(env[key + '_FILE'], 'utf8').trim() : env[key];
const password = fileSecret('N8N_METER_PASSWORD');
const snapshotFile = env.N8N_METER_SNAPSHOT_FILE;
if (!password && env.N8N_METER_LOCAL_ONLY !== 'true') throw new Error('N8N_METER_PASSWORD_FILE required outside loopback-only Compose mode');
const directory = env.N8N_METER_DATA_DIR || '/data';
mkdirSync(directory, { recursive: true });
const db = new DatabaseSync(directory + '/n8nmeter.sqlite');
db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS samples (id INTEGER PRIMARY KEY, at TEXT NOT NULL, payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
const sourceId = env.N8N_METER_SOURCE_ID;
if (!sourceId) throw new Error('N8N_METER_SOURCE_ID required');
const sourceIdentity = JSON.stringify([sourceId, env.PGHOST, env.PGPORT || '5432', env.PGDATABASE, env.PGSCHEMA || 'public', env.N8N_TABLE_PREFIX || '']);
const savedIdentity = db.prepare("SELECT value FROM state WHERE key='source'").get()?.value;
if (savedIdentity && sourceIdentity !== savedIdentity) throw new Error('SOURCE_CHANGED: use a separate data volume');
db.prepare("INSERT OR IGNORE INTO state VALUES ('source', ?)").run(sourceIdentity);
const interval = Math.max(10, Number(env.N8N_METER_INTERVAL_SECONDS || 60));
if (!Number.isFinite(interval)) throw new Error('Invalid collection interval');
const schema = identifier(env.PGSCHEMA || 'public');
const table = name => schema + '.' + identifier((env.N8N_TABLE_PREFIX || '') + name);
const statsTable = table('workflow_statistics');
const pool = new pg.Pool({
  host: env.PGHOST, port: Number(env.PGPORT || 5432), database: env.PGDATABASE,
  user: env.PGUSER, password: fileSecret('PGPASSWORD'), max: 1,
  connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000,
  options: '-c default_transaction_read_only=on -c statement_timeout=5000',
  ssl: env.PGSSLROOTCERT ? { ca: readFileSync(env.PGSSLROOTCERT, 'utf8'), rejectUnauthorized: true } : undefined,
});
pool.on('error', () => { lastError = 'DB_CONNECTION_FAILED'; });
let lastError = null, collecting = false;
const safeError = error => ({ '42501': 'DB_PERMISSION_DENIED', '42P01': 'UNSUPPORTED_SCHEMA', '42703': 'UNSUPPORTED_SCHEMA', '28P01': 'DB_AUTH_FAILED', '57014': 'QUERY_TIMEOUT', ECONNREFUSED: 'DB_CONNECTION_FAILED' }[error.code] || (['READ_ONLY_ROLE_REQUIRED', 'INVALID_COUNTER'].includes(error.message) ? error.message : 'COLLECTION_FAILED'));
async function collect() {
  if (collecting) return;
  collecting = true;
  let connection;
  try {
    let rows, currentTotals, at, insights;
    if (snapshotFile) {
      const snapshot = JSON.parse(readFileSync(snapshotFile, 'utf8'));
      rows = snapshot.rows; at = snapshot.at; insights = snapshot.insights;
      if (!Array.isArray(rows) || !Number.isFinite(Date.parse(at))) throw new Error('INVALID_SNAPSHOT');
      currentTotals = totals(rows);
      const lastAt = db.prepare('SELECT at FROM samples ORDER BY id DESC LIMIT 1').get()?.at;
      if (lastAt && Date.parse(at) <= Date.parse(lastAt)) return;
    } else {
    connection = await pool.connect();
    await connection.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const privilege = (await connection.query(`SELECT
      (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superuser,
      has_table_privilege(current_user, $1, 'INSERT,UPDATE,DELETE,TRUNCATE') AS writable`, [statsTable])).rows[0];
    if (privilege.superuser || privilege.writable) throw new Error('READ_ONLY_ROLE_REQUIRED');
    rows = (await connection.query(`SELECT id::text, name, "workflowId", COALESCE("workflowName", 'Deleted workflow') AS "workflowName", count::text, "rootCount"::text FROM ${statsTable} WHERE name IN ('production_success', 'production_error') ORDER BY id`)).rows;
    currentTotals = totals(rows);
    at = (await connection.query('SELECT clock_timestamp() AS now')).rows[0].now.toISOString();
    await connection.query('SAVEPOINT insights_read');
    try {
      const result = await connection.query(`SELECT COALESCE(SUM(value),0)::text AS total, MIN(at) AS earliest FROM (
        SELECT value, "timestamp" AS at FROM ${table('insights_raw')} WHERE type IN (2,3)
        UNION ALL SELECT value, "periodStart" AS at FROM ${table('insights_by_period')} WHERE type IN (2,3)
      ) events`);
      insights = { available: true, total: result.rows[0].total, earliest: result.rows[0].earliest?.toISOString() || null };
    } catch {
      await connection.query('ROLLBACK TO SAVEPOINT insights_read');
      insights = { available: false, total: null, earliest: null };
    }
    await connection.query('COMMIT');
    }
    const previous = db.prepare("SELECT value FROM state WHERE key='rows'").get()?.value;
    const delta = difference(previous ? JSON.parse(previous) : null, rows);
    const payload = { at, totals: currentTotals, delta, insights, workflowCount: new Set(rows.map(r => r.workflowId || 'deleted:' + r.id)).size };
    db.exec('BEGIN');
    try {
      db.prepare('INSERT INTO samples(at,payload) VALUES (?,?)').run(at, JSON.stringify(payload));
      db.prepare("INSERT OR REPLACE INTO state VALUES ('rows', ?)").run(JSON.stringify(rows));
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    lastError = null;
    console.log(JSON.stringify({ event: 'collected', at, root: currentTotals.root, state: delta.state }));
  } catch (error) {
    if (connection) await connection.query('ROLLBACK').catch(() => {});
    lastError = safeError(error);
    console.error(JSON.stringify({ event: 'collection_failed', code: lastError }));
  } finally { connection?.release(); collecting = false; }
}
function summary() {
  const samples = db.prepare('SELECT payload FROM samples ORDER BY id DESC LIMIT 120').all().map(r => JSON.parse(r.payload)).reverse();
  const last = samples.at(-1) || null;
  const first = db.prepare('SELECT at FROM samples ORDER BY id LIMIT 1').get()?.at || null;
  const stale = !last || Date.now() - Date.parse(last.at) > interval * 2500;
  const rows = JSON.parse(db.prepare("SELECT value FROM state WHERE key='rows'").get()?.value || '[]');
  const workflows = new Map();
  for (const row of rows) {
    const key = row.workflowId || 'deleted:' + row.id;
    const item = workflows.get(key) || { id: key, name: row.workflowName, root: '0', production: '0', failed: '0' };
    item.root = String(BigInt(item.root) + BigInt(row.rootCount));
    item.production = String(BigInt(item.production) + BigInt(row.count));
    if (row.name === 'production_error') item.failed = String(BigInt(item.failed) + BigInt(row.rootCount));
    workflows.set(key, item);
  }
  const ordered = [...workflows.values()].sort((a,b) => BigInt(a.root) === BigInt(b.root) ? 0 : BigInt(a.root) > BigInt(b.root) ? -1 : 1);
  return { product: 'n8n Meter', version: '0.1.0', mode: snapshotFile ? 'snapshot' : 'database', source: env.N8N_METER_SOURCE_LABEL || sourceId,
    n8nVersion: env.N8N_VERSION || 'unknown', verifiedAdapter: env.N8N_VERSION === '2.26.9',
    interval, first, last, samples, workflows: ordered.slice(0, 100), workflowRowsTruncated: ordered.length > 100,
    error: lastError, stale, scope: 'license-reporting-source-not-invoice' };
}
const authHash = value => createHash('sha256').update(value).digest();
const expectedAuth = password ? authHash('Basic ' + Buffer.from('n8nmeter:' + password).toString('base64')) : null;
const server = http.createServer((req,res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'");
  if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/favicon.ico') { res.writeHead(204); return res.end(); }
  if (path === '/healthz') { res.writeHead(200); return res.end('ok'); }
  if (path === '/readyz') { const s = summary(); res.writeHead(s.last && !s.error && !s.stale ? 200 : 503); return res.end(s.last && !s.error && !s.stale ? 'ready' : 'not ready'); }
  if (expectedAuth && !timingSafeEqual(authHash(req.headers.authorization || ''), expectedAuth)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="n8n Meter", charset="UTF-8"' }); return res.end('Authentication required');
  }
  if (path === '/api/summary') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(summary())); }
  if (path === '/') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ product: 'n8n Meter', role: 'collector', ui: 'n8n operator gateway' })); }
  res.writeHead(404); res.end('Not found');
});
server.listen(Number(env.PORT || 7810), '0.0.0.0', () => console.log('n8n Meter listening on port ' + (env.PORT || 7810)));
await collect();
const timer = setInterval(collect, interval * 1000);
async function shutdown() { clearInterval(timer); server.close(); await pool.end(); db.close(); }
process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
