'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  businessDate,
  labourStableKey,
  normalizeLabourShift,
  normalizeSalesRecord,
  salesStableKey
} = require('../coyote-intel/src/lightspeed/normalize.js');

test('normalizeSalesRecord maps sales lines and payments with stable keys', () => {
  const rows = normalizeSalesRecord({
    id: 'sale-1',
    account: { accountReference: 'acct-1', receiptId: 'r-1' },
    timeClosed: '2026-06-01T12:00:00.000Z',
    lines: [{ lineId: 'line-1', sku: 'sku-1', itemName: 'Coffee', quantity: '2', grossAmount: '10.50', netAmount: '9.50', taxAmount: '1.00' }],
    payments: [{ uuid: 'pay-1', amount: '10.50', tipAmount: '1.50' }]
  }, {
    businessId: 'biz-1',
    businessLocationId: 'loc-1',
    businessTimezone: 'UTC'
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].source_system, 'lightspeed-kseries');
  assert.equal(rows[0].business_id, 'biz-1');
  assert.equal(rows[0].business_location_id, 'loc-1');
  assert.equal(rows[0].line_id, 'line-1');
  assert.equal(rows[0].payment_uuid, 'pay-1');
  assert.equal(rows[0].quantity, 2);
  assert.equal(rows[0].gross_amount, 10.5);
  assert.equal(rows[0].stable_key, 'biz-1|loc-1|acct-1|line-1|pay-1');
  assert.equal(salesStableKey(rows[0]), rows[0].stable_key);
});

test('normalizeSalesRecord falls back to raw hash when line or payment identifiers are absent', () => {
  const rows = normalizeSalesRecord({ id: 'sale-2', timeClosed: '2026-06-01T12:00:00.000Z' }, { businessLocationId: 'loc-1' });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].line_id, null);
  assert.equal(rows[0].payment_uuid, null);
  assert.match(rows[0].raw_record_hash, /^[a-f0-9]{64}$/);
  assert.match(rows[0].stable_key, /loc-1/);
});

test('normalizeLabourShift uses newest duplicate event type and excludes payroll fields', () => {
  const row = normalizeLabourShift({
    uuid: 'shift-1',
    staffId: 'staff-1',
    declaredCashTips: '4.25',
    events: [
      { uuid: 'in-old', type: 'CLOCK_IN', dateInUTC: '2026-06-01T08:00:00.000Z' },
      { uuid: 'in-new', type: 'CLOCK_IN', dateInUTC: '2026-06-01T08:05:00.000Z' },
      { uuid: 'out-1', type: 'CLOCK_OUT', dateInUTC: '2026-06-01T16:00:00.000Z' }
    ],
    staff: { name: 'Pat Staff', email: 'pat@example.test', active: true, roles: ['server'] }
  }, { businessLocationId: 'loc-1' });

  assert.equal(row.clock_in_timestamp, '2026-06-01T08:05:00.000Z');
  assert.equal(row.clock_out_timestamp, '2026-06-01T16:00:00.000Z');
  assert.deepEqual(row.event_uuids, ['in-old', 'in-new', 'out-1']);
  assert.equal(row.declared_cash_tips, 4.25);
  assert.equal(row.stable_key, 'loc-1|shift-1');
  assert.equal(labourStableKey(row), row.stable_key);
  assert.equal(Object.hasOwn(row, 'wage_rate'), false);
  assert.equal(Object.hasOwn(row, 'labour_cost'), false);
});

test('businessDate slices by supplied timezone', () => {
  assert.equal(businessDate('2026-06-02T01:30:00.000Z', 'America/New_York'), '2026-06-01');
  assert.equal(businessDate('not-a-date', 'UTC'), 'unknown');
});
