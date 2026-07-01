'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { dedupeRecords, extractEarliestSupportedDate, runBackfill } = require('../coyote-intel/src/lightspeed/backfill.js');
const { JsonStateStore } = require('../coyote-intel/src/lightspeed/state-store.js');
const { readJsonl, syncSales } = require('../coyote-intel/src/lightspeed/sales-sync.js');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lightspeed-state-'));
}

test('JsonStateStore persists per-location cursors and earliest supported dates', () => {
  const dir = tempDir();
  const store = new JsonStateStore(path.join(dir, 'state.json'));

  store.setSalesCursor('loc-1', '2026-06-02T00:00:00.000Z');
  store.setLabourCursor('loc-1', '2026-06-02T01:00:00.000Z');
  store.setEarliestSupportedDate('loc-1', '2024-01-01');

  const reloaded = new JsonStateStore(path.join(dir, 'state.json'));
  assert.equal(reloaded.getSalesCursor('loc-1'), '2026-06-02T00:00:00.000Z');
  assert.equal(reloaded.getLabourCursor('loc-1'), '2026-06-02T01:00:00.000Z');
  assert.equal(reloaded.getEarliestSupportedDate('loc-1'), '2024-01-01');
  assert.equal(reloaded.getSalesCursor('missing'), null);
});

test('dedupeRecords keeps one record per stable key', () => {
  const deduped = dedupeRecords([
    { stable_key: 'b', value: 1 },
    { stable_key: 'a', value: 2 },
    { stable_key: 'b', value: 3 }
  ], (record) => record.stable_key);

  assert.deepEqual(deduped, [
    { stable_key: 'a', value: 2 },
    { stable_key: 'b', value: 3 }
  ]);
});

test('runBackfill chunks ranges and reruns without duplicate normalized records', async () => {
  const dir = tempDir();
  const stateStore = new JsonStateStore(path.join(dir, 'state.json'));
  const config = {
    outputDir: path.join(dir, 'out'),
    locationIds: ['loc-1'],
    salesPageSize: 100
  };
  const rawSale = {
    id: 'sale-1',
    account: { accountReference: 'acct-1' },
    lines: [{ lineId: 'line-1', grossAmount: 10 }],
    payments: [{ uuid: 'pay-1', amount: 10 }]
  };
  const client = {
    calls: [],
    async fetchSales(locationId, params) {
      this.calls.push({ locationId, params });
      return [rawSale, rawSale];
    }
  };

  const first = await runBackfill({
    client,
    config,
    stateStore,
    from: '2025-01-01T00:00:00.000Z',
    to: '2026-01-02T00:00:00.000Z'
  });
  const second = await runBackfill({
    client,
    config,
    stateStore,
    from: '2025-01-01T00:00:00.000Z',
    to: '2026-01-02T00:00:00.000Z'
  });

  assert.equal(first.length, 2);
  assert.equal(second.length, 2);
  assert.equal(client.calls.length, 4);
  assert.equal(new Set(client.calls.map((call) => call.params.from)).size, 2);
  for (const result of second) {
    assert.equal(readJsonl(result.normalizedPath).length, 1);
  }
});

test('syncSales runs every configured location and applies cursor lookback window', async () => {
  const dir = tempDir();
  const stateStore = new JsonStateStore(path.join(dir, 'state.json'));
  stateStore.setSalesCursor('loc-1', '2026-06-10T00:00:00.000Z');
  stateStore.setSalesCursor('loc-2', '2026-06-10T00:00:00.000Z');
  const calls = [];
  const client = {
    async fetchSales(locationId, params) {
      calls.push({ locationId, params });
      return [{
        id: `sale-${locationId}`,
        account: { accountReference: `acct-${locationId}` },
        lines: [{ lineId: 'line-1', grossAmount: 10 }],
        payments: [{ uuid: 'pay-1', amount: 10 }]
      }];
    }
  };

  const results = await syncSales({
    client,
    stateStore,
    config: {
      outputDir: path.join(dir, 'out'),
      locationIds: ['loc-1', 'loc-2'],
      lookbackDays: 2,
      salesPageSize: 100
    },
    to: '2026-06-11T00:00:00.000Z'
  });

  assert.deepEqual(calls.map((call) => call.locationId), ['loc-1', 'loc-2']);
  assert.equal(calls[0].params.from, '2026-06-08T00:00:00.000Z');
  assert.equal(calls[0].params.to, '2026-06-11T00:00:00.000Z');
  assert.equal(stateStore.getSalesCursor('loc-1'), '2026-06-11T00:00:00.000Z');
  assert.equal(results.length, 2);
  assert.equal(readJsonl(results[0].normalizedPath).length, 1);
});

test('runBackfill records earliest supported date from invalid from date errors', async () => {
  const dir = tempDir();
  const stateStore = new JsonStateStore(path.join(dir, 'state.json'));
  const error = new Error('invalid from date; earliest supported date is 2024-02-03');
  error.status = 400;
  error.body = 'earliest supported date is 2024-02-03';

  const results = await runBackfill({
    client: { async fetchSales() { throw error; } },
    config: { outputDir: path.join(dir, 'out'), locationIds: ['loc-1'], salesPageSize: 100 },
    stateStore,
    from: '2020-01-01T00:00:00.000Z',
    to: '2020-01-02T00:00:00.000Z'
  });

  assert.equal(extractEarliestSupportedDate(error), '2024-02-03');
  assert.deepEqual(results, [{
    locationId: 'loc-1',
    from: '2020-01-01T00:00:00.000Z',
    to: '2020-01-02T00:00:00.000Z',
    skipped: true,
    earliestSupportedDate: '2024-02-03'
  }]);
  assert.equal(stateStore.getEarliestSupportedDate('loc-1'), '2024-02-03');
});
