'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { LightspeedClient, capPageSize, retryAfterMs } = require('../coyote-intel/src/lightspeed/client.js');
const { syncLabour } = require('../coyote-intel/src/lightspeed/labour-sync.js');
const { OAuthTokenManager, isTokenExpired, redactSecrets } = require('../coyote-intel/src/lightspeed/oauth.js');
const { JsonStateStore } = require('../coyote-intel/src/lightspeed/state-store.js');
const { readJsonl } = require('../coyote-intel/src/lightspeed/sales-sync.js');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lightspeed-client-'));
}

function jsonResponse(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return headers[String(name).toLowerCase()] || headers[name] || null;
      }
    },
    async text() {
      return JSON.stringify(body);
    }
  };
}

function tokenConfig(dir, overrides = {}) {
  return {
    clientId: 'client-id',
    clientSecret: 'client-secret',
    tokenUrl: 'https://auth.example.test/token',
    tokenStorePath: path.join(dir, 'token.json'),
    ...overrides
  };
}

test('OAuthTokenManager refreshes expired access token and stores rotated refresh token', async () => {
  const dir = tempDir();
  const config = tokenConfig(dir);
  fs.writeFileSync(config.tokenStorePath, JSON.stringify({
    access_token: 'old-access',
    refresh_token: 'old-refresh',
    expires_at: '2026-01-01T00:00:00.000Z'
  }));
  const calls = [];
  const manager = new OAuthTokenManager(config, {
    async fetch(url, options) {
      calls.push({ url, options });
      return jsonResponse(200, {
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        token_type: 'Bearer',
        expires_in: 1500
      });
    }
  });

  const accessToken = await manager.getAccessToken(Date.parse('2026-07-01T00:00:00.000Z'));
  const stored = JSON.parse(fs.readFileSync(config.tokenStorePath, 'utf8'));

  assert.equal(accessToken, 'new-access');
  assert.equal(stored.refresh_token, 'new-refresh');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers.Authorization, `Basic ${Buffer.from('client-id:client-secret').toString('base64')}`);
  assert.match(String(calls[0].options.body), /grant_type=refresh_token/);
  assert.equal(isTokenExpired(stored, Date.parse('2026-07-01T00:00:00.000Z')), false);
});

test('redactSecrets removes token and auth material from error text', () => {
  const text = redactSecrets('Bearer abc.def client_secret=topsecret refresh_token=refreshvalue Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==');
  assert.equal(text.includes('topsecret'), false);
  assert.equal(text.includes('refreshvalue'), false);
  assert.match(text, /Bearer \[REDACTED\]/);
  assert.match(text, /Basic \[REDACTED\]/);
});

test('LightspeedClient paginates V2 sales with nextPageToken and caps page size', async () => {
  const requests = [];
  const client = new LightspeedClient({
    apiBaseUrl: 'https://api.trial.lsk.lightspeed.app',
    salesPageSize: 999,
    retryCount: 0
  }, {
    async getAccessToken() { return 'access'; }
  }, {
    async fetch(url, options) {
      requests.push({ url, options });
      if (requests.length === 1) {
        return jsonResponse(200, { data: [{ id: 'sale-1' }], nextPageToken: 'next-1' });
      }
      return jsonResponse(200, { data: [{ id: 'sale-2' }] });
    }
  });

  const records = await client.fetchSales('loc-1', {
    from: '2026-06-01T00:00:00.000Z',
    to: '2026-06-02T00:00:00.000Z',
    pageSize: 999
  });

  assert.deepEqual(records, [{ id: 'sale-1' }, { id: 'sale-2' }]);
  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /pageSize=100/);
  assert.match(requests[1].url, /nextPageToken=next-1/);
  assert.equal(requests[0].options.headers.Authorization, 'Bearer access');
  assert.equal(capPageSize(999, 100), 100);
});

test('LightspeedClient respects Retry-After for transient failures', async () => {
  const waits = [];
  let calls = 0;
  const client = new LightspeedClient({
    apiBaseUrl: 'https://api.trial.lsk.lightspeed.app',
    retryCount: 1
  }, {
    async getAccessToken() { return 'access'; }
  }, {
    async fetch() {
      calls += 1;
      return calls === 1
        ? jsonResponse(429, { error: 'slow down' }, { 'retry-after': '2' })
        : jsonResponse(200, { ok: true });
    },
    async sleep(ms) {
      waits.push(ms);
    }
  });

  assert.deepEqual(await client.get('/f/data/businesses'), { ok: true });
  assert.deepEqual(waits, [2000]);
  assert.equal(retryAfterMs('2'), 2000);
});

test('syncLabour writes a machine-readable limitation when staff scope is missing', async () => {
  const dir = tempDir();
  const result = await syncLabour({
    client: {},
    config: {
      scopes: ['financial-api'],
      outputDir: path.join(dir, 'out'),
      locationIds: ['loc-1']
    },
    stateStore: new JsonStateStore(path.join(dir, 'state.json')),
    from: '2026-06-01T00:00:00.000Z',
    to: '2026-06-02T00:00:00.000Z'
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].type, 'lightspeed_staff_api_limitation');
  assert.match(result[0].reason, /scope/);
  assert.equal(readJsonl(result[0].limitationPath)[0].fallback, 'Use the existing wage/labour-cost file drop until an approved source is supplied.');
});

test('syncLabour writes a limitation when Staff API authorization fails', async () => {
  const dir = tempDir();
  const error = new Error('forbidden');
  error.status = 403;
  error.body = 'scope missing';
  const result = await syncLabour({
    client: { async fetchStaffShifts() { throw error; } },
    config: {
      scopes: ['staff-api'],
      outputDir: path.join(dir, 'out'),
      locationIds: ['loc-1'],
      staffPageSize: 100
    },
    stateStore: new JsonStateStore(path.join(dir, 'state.json')),
    from: '2026-06-01T00:00:00.000Z',
    to: '2026-06-02T00:00:00.000Z'
  });

  assert.equal(result[0].reason, 'staff-api authorization failed');
  assert.equal(readJsonl(result[0].limitationPath)[0].detail.status, 403);
});
