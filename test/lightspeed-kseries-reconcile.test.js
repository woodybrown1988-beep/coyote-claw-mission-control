'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { parseCsv, reconcileFiles, reconcileRecords, summarize } = require('../coyote-intel/src/lightspeed/reconcile.js');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lightspeed-reconcile-'));
}

test('parseCsv handles quoted commas', () => {
  assert.deepEqual(parseCsv('id,name,amount\n1,"coffee, large",4.50\n'), [{
    id: '1',
    name: 'coffee, large',
    amount: '4.50'
  }]);
});

test('reconcileRecords reports counts, totals, missing records, changed records, and explanations', () => {
  const apiRecords = [
    { stable_key: 'same', business_location_id: 'loc-1', time_closed: '2026-06-02T01:30:00.000Z', gross_amount: 10, net_amount: 9, tax_amount: 1, discount_amount: 0, payment_amount: 10, tip_amount: 2 },
    { stable_key: 'changed', business_location_id: 'loc-1', time_closed: '2026-06-02T02:30:00.000Z', gross_amount: 12, net_amount: 10, tax_amount: 2, discount_amount: 0, payment_amount: 12, tip_amount: 0 },
    { stable_key: 'api-only', business_location_id: 'loc-2', time_closed: '2026-06-03T12:00:00.000Z', gross_amount: 5 }
  ];
  const dropRecords = [
    { stable_key: 'same', business_location_id: 'loc-1', time_closed: '2026-06-02T01:30:00.000Z', gross_amount: 10, net_amount: 9, tax_amount: 1, discount_amount: 0, payment_amount: 10, tip_amount: 2 },
    { stable_key: 'changed', business_location_id: 'loc-1', time_closed: '2026-06-02T02:30:00.000Z', gross_amount: 11, net_amount: 10, tax_amount: 1, discount_amount: 0, payment_amount: 11, tip_amount: 0 },
    { stable_key: 'drop-only', business_location_id: 'loc-1', time_closed: '2026-06-02T03:30:00.000Z', gross_amount: 7 }
  ];

  const report = reconcileRecords(apiRecords, dropRecords, {
    generatedAt: '2026-07-01T00:00:00.000Z',
    timezoneByLocation: { 'loc-1': 'America/New_York' },
    materialDifferenceExplanation: 'rounding or late correction requires operator review'
  });

  assert.equal(report.generated_at, '2026-07-01T00:00:00.000Z');
  assert.equal(report.input.api_record_count, 3);
  assert.equal(report.input.file_drop_record_count, 3);
  assert.equal(report.missing_in_api[0].stable_key, 'drop-only');
  assert.equal(report.missing_in_file_drop[0].stable_key, 'api-only');
  assert.equal(report.changed_records[0].stable_key, 'changed');
  assert.deepEqual(report.changed_records[0].changed_fields.map((field) => field.field), ['gross_amount', 'tax_amount', 'payment_amount']);
  assert.equal(report.material_difference_explanations[0].explanation, 'rounding or late correction requires operator review');
  assert.equal(report.counts_by_location_business_day_week.api[0].business_day, '2026-06-01');
});

test('summarize groups by business location, day, and week', () => {
  const summary = summarize([
    { business_location_id: 'loc-1', time_closed: '2026-06-03T10:00:00.000Z', gross_amount: '4.25' },
    { business_location_id: 'loc-1', time_closed: '2026-06-03T12:00:00.000Z', gross_amount: '5.75' }
  ], { 'loc-1': 'UTC' });

  assert.equal(summary.length, 1);
  assert.equal(summary[0].record_count, 2);
  assert.equal(summary[0].business_week_start, '2026-06-01');
  assert.equal(summary[0].totals.gross_amount, 10);
});

test('reconcileFiles requires two weekly drops and writes a report', () => {
  const dir = tempDir();
  const apiPath = path.join(dir, 'api.jsonl');
  const drop1Path = path.join(dir, 'drop1.csv');
  const drop2Path = path.join(dir, 'drop2.csv');
  const reportPath = path.join(dir, 'report.jsonl');
  fs.writeFileSync(apiPath, '{"stable_key":"a","business_location_id":"loc-1","time_closed":"2026-06-01T10:00:00.000Z","gross_amount":1}\n');
  fs.writeFileSync(drop1Path, 'stable_key,business_location_id,time_closed,gross_amount\na,loc-1,2026-06-01T10:00:00.000Z,1\n');
  fs.writeFileSync(drop2Path, 'stable_key,business_location_id,time_closed,gross_amount\nb,loc-1,2026-06-08T10:00:00.000Z,2\n');

  assert.throws(() => reconcileFiles({ apiPath, fileDropPaths: [drop1Path] }), /At least two/);
  const report = reconcileFiles({ apiPath, fileDropPaths: [drop1Path, drop2Path], reportPath });
  assert.equal(report.missing_in_api[0].stable_key, 'b');
  assert.equal(JSON.parse(fs.readFileSync(reportPath, 'utf8')).missing_in_api[0].stable_key, 'b');
});
