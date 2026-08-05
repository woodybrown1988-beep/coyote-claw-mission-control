'use strict';
// The MC half of the sole-writer command-path checklist (engine ops/life-os.md):
//   • unauthenticated POST /api/life/capture → 401 at the REAL wall, nothing relayed;
//   • authenticated + same-origin → validated command relayed over the Unix socket,
//     writer's verdict passed through;
//   • writer down → NAMED 503, nothing queued anywhere (writer-down honesty);
//   • cross-origin POST → 403 (CSRF defence-in-depth, same as every write route);
//   • structural: the capture dispatch sits AFTER the auth gate in server.js.

// Env BEFORE requiring server.js (same discipline as mission-control-auth.test.js).
process.env.MC_AUTH_SECRET = 'test-operator-secret-0123456789abcdef';
process.env.MC_SESSION_KEY = 'test-session-signing-key-0123456789abcdef';
process.env.MC_LOGIN_DELAY_MS = '0';

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const TMP_DB = path.join(os.tmpdir(), `mc-life-cmd-${process.pid}.db`);
const TMP_SOCK = path.join(os.tmpdir(), `mc-life-cmd-${process.pid}.sock`);
process.env.COYOTE_CLAW_DB = TMP_DB;
process.env.COYOTE_LIFE_SOCK = TMP_SOCK;

const assert = require('node:assert/strict');
const test = require('node:test');
const { Readable } = require('node:stream');
const AUTH = require('../mission-control/ui/auth.js');
const LIFECMD = require('../mission-control/ui/life-command-lib.js');
const { handleRequest } = require('../mission-control/server.js');

test.after(() => {
  for (const f of [TMP_DB, `${TMP_DB}-wal`, `${TMP_DB}-shm`, TMP_SOCK]) { try { fs.unlinkSync(f); } catch (_) { /* gone */ } }
});

function makeRes() {
  const res = { statusCode: 0, headers: {}, body: '', ended: false };
  res.setHeader = (k, v) => { res.headers[String(k).toLowerCase()] = v; };
  res.getHeader = (k) => res.headers[String(k).toLowerCase()];
  res.writeHead = (s, h) => { res.statusCode = s; if (h) for (const k of Object.keys(h)) res.headers[k.toLowerCase()] = h[k]; return res; };
  res.done = new Promise((resolve) => { res._resolve = resolve; });
  res.end = (b) => { if (b != null) res.body += b; res.ended = true; res._resolve(res); };
  return res;
}
function makeReq(method, url, headers, body) {
  const req = Readable.from([body == null ? '' : body]);
  req.method = method;
  req.url = url;
  req.headers = Object.assign({ host: '127.0.0.1:8787' }, headers || {});
  return req;
}
async function run(method, url, headers, body) {
  const res = makeRes();
  handleRequest(makeReq(method, url, headers, body), res);
  await res.done;
  return res;
}
function authedHeaders() {
  return {
    cookie: `${AUTH.COOKIE}=${AUTH.issueToken(Date.now())}`,
    origin: 'http://127.0.0.1:8787',
    'content-type': 'application/json',
  };
}

/** A stub writer on the REAL socket path: records what it receives, answers like writerCore. */
function startStubWriter(reply) {
  const seen = [];
  const srv = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      seen.push({ url: req.url, body: JSON.parse(raw || '{}') });
      res.writeHead(reply.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(reply.body));
    });
  });
  return new Promise((resolve) => srv.listen(TMP_SOCK, () => resolve({
    seen, close: () => new Promise((r) => srv.close(() => { try { fs.unlinkSync(TMP_SOCK); } catch (_) { /* gone */ } r(); })),
  })));
}

test('CHECKLIST unauthenticated: POST /api/life/capture → 401 at the wall, nothing relayed', async () => {
  const stub = await startStubWriter({ status: 201, body: { ok: true } });
  const res = await run('POST', '/api/life/capture', { 'content-type': 'application/json' },
    JSON.stringify({ title: 'sneak', idempotencyKey: 'k-12345678' }));
  assert.equal(res.statusCode, 401);
  assert.match(res.body, /authentication required/);
  assert.equal(stub.seen.length, 0, 'the writer never saw the unauthenticated command');
  await stub.close();
});

test('CHECKLIST end-to-end (MC leg): authenticated capture relays the VALIDATED command, verdict passes through', async () => {
  const stub = await startStubWriter({ status: 201, body: { ok: true, status: 201, result: { id: 'tsk-1', created: true } } });
  const res = await run('POST', '/api/life/capture', authedHeaders(),
    JSON.stringify({ title: '  book dentist  ', idempotencyKey: 'cap-relay-0001', junkField: 'dropped' }));
  assert.equal(res.statusCode, 201, res.body);
  assert.match(res.body, /tsk-1/);
  assert.equal(stub.seen.length, 1);
  const sent = stub.seen[0];
  assert.equal(sent.url, '/command');
  assert.deepEqual(sent.body, {
    command: 'capture', payload: { title: 'book dentist' }, idempotencyKey: 'cap-relay-0001',
  }, 'trimmed, junk dropped, exactly the writer contract');
  await stub.close();
});

test('CHECKLIST writer-down honesty: NAMED 503, nothing queued', async () => {
  // no stub listening — the socket path is dead
  const res = await run('POST', '/api/life/capture', authedHeaders(),
    JSON.stringify({ title: 'x', idempotencyKey: 'k-12345678' }));
  assert.equal(res.statusCode, 503);
  assert.match(res.body, /life writer offline — command NOT accepted, nothing queued/);
});

test('cross-origin authenticated POST → 403 (CSRF defence, like every write route)', async () => {
  const headers = authedHeaders();
  headers.origin = 'https://evil.example';
  const res = await run('POST', '/api/life/capture', headers,
    JSON.stringify({ title: 'x', idempotencyKey: 'k-12345678' }));
  assert.equal(res.statusCode, 403);
});

test('RED validation: missing title / missing key refused at MC before any relay', async () => {
  const noTitle = await run('POST', '/api/life/capture', authedHeaders(), JSON.stringify({ idempotencyKey: 'k-12345678' }));
  assert.equal(noTitle.statusCode, 400);
  const noKey = await run('POST', '/api/life/capture', authedHeaders(), JSON.stringify({ title: 'x' }));
  assert.equal(noKey.statusCode, 400);
  assert.match(noKey.body, /idempotencyKey required/);
  const v = LIFECMD.validateCapture({ title: 'x'.repeat(501), idempotencyKey: 'k-12345678' });
  assert.equal(v.ok, false);
});

test('cancel relay: authenticated cancel forwards the exact command; validation red paths', async () => {
  const stub = await startStubWriter({ status: 200, body: { ok: true, status: 200, result: { id: 't-9', status: 'CANCELLED', changed: true } } });
  const res = await run('POST', '/api/life/cancel', authedHeaders(),
    JSON.stringify({ taskId: 't-9', idempotencyKey: 'cxl-relay-0001', junk: 'dropped' }));
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(stub.seen[0].body, { command: 'cancel', payload: { taskId: 't-9' }, idempotencyKey: 'cxl-relay-0001' });
  await stub.close();
  const unauth = await run('POST', '/api/life/cancel', { 'content-type': 'application/json' },
    JSON.stringify({ taskId: 't-9', idempotencyKey: 'cxl-relay-0002' }));
  assert.equal(unauth.statusCode, 401, 'cancel sits behind the same wall');
  const noKey = await run('POST', '/api/life/cancel', authedHeaders(), JSON.stringify({ taskId: 't-9' }));
  assert.equal(noKey.statusCode, 400);
  const LIFEC = require('../mission-control/ui/life-command-lib.js');
  assert.equal(LIFEC.validateCancel({ idempotencyKey: 'cxl-relay-0003' }).ok, false, 'taskId required');
});

test('CHECKLIST structural: the capture dispatch sits AFTER the auth gate; MC still opens no life.db write handle', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'mission-control', 'server.js'), 'utf8');
  const gate = src.indexOf('AUTH.isAuthed(req');
  const dispatch = src.indexOf("url.pathname === '/api/life/capture'");
  const dispatchCancel = src.indexOf("url.pathname === '/api/life/cancel'");
  assert.ok(gate > 0 && dispatch > 0 && dispatchCancel > 0);
  assert.ok(dispatch > gate, 'capture dispatch is BELOW the wall in handleRequest');
  assert.ok(dispatchCancel > gate, 'cancel dispatch is BELOW the wall too');
  // The relay lib speaks HTTP-over-UDS only — it must never require the sqlite driver.
  const lib = fs.readFileSync(path.join(__dirname, '..', 'mission-control', 'ui', 'life-command-lib.js'), 'utf8');
  assert.ok(!/node:sqlite|DatabaseSync/.test(lib), 'the relay holds no database handle at all');
});
