'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const reports = require('../mission-control/ui/pages/coyote/reports.js');

const {
  deriveSittingCaptionState,
  deriveCoversCaptionState,
  deriveReconciliationCaptionState,
} = reports;

test('sitting population and capture follow current-window table clusters plus standalone Order receipts', () => {
  const clustered = [
    { channel: 'QR', tableName: '27 Bank Street, Table 4', receiptCount: 2, net: 6000 },
    { channel: 'served', tableName: 'Table 7', receiptCount: 1, net: 4000 },
  ];
  const withOrder = clustered.concat(
    { channel: 'served', tableName: 'Order 19', receiptCount: 1, net: 3000 },
  );
  const captureWithoutOrder = [
    { label: 'STOREKIT ORDER & PAY', net: 6000, sittingNet: 6000 },
    { label: 'EAT IN', net: 7000, sittingNet: 4000 },
  ];
  const captureWithOrder = [
    { label: 'STOREKIT ORDER & PAY', net: 6000, sittingNet: 6000 },
    { label: 'EAT IN', net: 7000, sittingNet: 7000 },
  ];

  const before = deriveSittingCaptionState(clustered, captureWithoutOrder);
  const after = deriveSittingCaptionState(withOrder, captureWithOrder);

  assert.equal(before.population.total, 2);
  assert.equal(after.population.total, 3);
  assert.equal(after.population.tableClusters, 2);
  assert.equal(after.population.standaloneOrders, 1);
  assert.notEqual(before.populationCaption, after.populationCaption);
  assert.match(after.populationCaption, /2 clustered table-served receipt groups \(66\.7%\)/);
  assert.match(after.populationCaption, /1 standalone Order N receipt \(33\.3%\)/);
  assert.match(after.captureCaption, /table clusters and standalone Order N receipts/);
  assert.match(after.captureCaption, /QR 100\.0%/);
  assert.match(after.captureCaption, /served 100\.0%/);
  assert.match(before.captureCaption, /served 57\.1%/);
  assert.notEqual(before.captureCaption, after.captureCaption);
  assert.doesNotMatch(after.captureCaption, /only form from.*numbered table/i);
});

test('sitting capture withholds unsupported percentages and names the missing current-row field', () => {
  const state = deriveSittingCaptionState(
    [{ channel: 'served', tableName: 'Order 8', receiptCount: 1, net: 3000 }],
    [{ label: 'EAT IN', net: 3000 }],
  );

  assert.equal(state.capture.supported, false);
  assert.match(state.captureCaption, /missing sittingNet/);
  assert.doesNotMatch(state.captureCaption, /\b\d+(?:\.\d+)?%/);
});

test('empty covers window becomes complete when rows land, with neither state claiming an unwired feed', () => {
  const sales = [
    { date: '2026-07-13', net: 10000 },
    { date: '2026-07-14', net: 12000 },
  ];
  const empty = deriveCoversCaptionState(sales, [], { from: '2026-07-13', to: '2026-07-19' });
  const covered = deriveCoversCaptionState(sales, [
    { date: '2026-07-13', totalCovers: 10 },
    { date: '2026-07-14', totalCovers: 12 },
  ], { from: '2026-07-13', to: '2026-07-19' });

  assert.equal(empty.kind, 'empty');
  assert.match(empty.caption, /no covers exist/i);
  assert.match(empty.caption, /2026-07-13, 2026-07-14/);
  assert.match(empty.caption, /clear the gate/);
  assert.equal(covered.kind, 'complete');
  assert.equal(covered.totalCovers, 22);
  assert.notEqual(empty.caption, covered.caption);
  for (const state of [empty, covered]) assert.doesNotMatch(state.caption, /unwired|not-wired|feed absent/i);
});

test('closed days are not covers-eligible, but a positive-net date without covers makes the window PARTIAL', () => {
  const coveredSales = [
    { date: '2026-07-13', net: 10000 },
    { date: '2026-07-14', net: 12000 },
  ];
  const covers = [
    { date: '2026-07-13', totalCovers: 10 },
    { date: '2026-07-14', totalCovers: 12 },
  ];
  const withClosedDay = deriveCoversCaptionState(
    coveredSales.concat({ date: '2026-07-15', net: 0 }),
    covers,
    { from: '2026-07-13', to: '2026-07-19' },
  );
  const withEligibleGap = deriveCoversCaptionState(
    coveredSales.concat({ date: '2026-07-15', net: 9000 }),
    covers,
    { from: '2026-07-13', to: '2026-07-19' },
  );

  assert.equal(withClosedDay.kind, 'complete');
  assert.equal(withClosedDay.need, 2);
  assert.equal(withEligibleGap.kind, 'partial');
  assert.deepEqual(withEligibleGap.missingDates, ['2026-07-15']);
  assert.match(withEligibleGap.caption, /PARTIAL/);
  assert.match(withEligibleGap.caption, /2026-07-15/);
});

test('reconciliation label and arithmetic follow the verified requested × eligible × covers intersection', () => {
  const sales = [
    { date: '2026-07-10', net: 100000 },
    { date: '2026-07-11', net: 120000 },
    { date: '2026-07-12', net: 140000 },
    { date: '2026-07-13', net: 160000 },
  ];
  const covers = [
    { date: '2026-07-10', seatedCovers: 50, revenueCovers: 40, revenueNet: 80000, revenueGross: 96000 },
    { date: '2026-07-11', seatedCovers: 60, revenueCovers: 50, revenueNet: 100000, revenueGross: 120000 },
    { date: '2026-07-12', seatedCovers: 70, revenueCovers: 60, revenueNet: 120000, revenueGross: 144000 },
    { date: '2026-07-13', seatedCovers: 80, revenueCovers: 70, revenueNet: 140000, revenueGross: 168000 },
  ];
  const narrow = deriveReconciliationCaptionState(sales, covers.slice(1, 3), { from: '2026-07-10', to: '2026-07-13' });
  const wide = deriveReconciliationCaptionState(sales, covers, { from: '2026-07-10', to: '2026-07-13' });

  assert.equal(narrow.withheld, false);
  assert.equal(narrow.dateLabel, '2026-07-11 → 2026-07-12 · 2 verified dates');
  assert.equal(narrow.lightspeedNet, 260000);
  assert.equal(narrow.openTableNet, 220000);
  assert.equal(narrow.revenueCovers, 110);
  assert.equal(wide.dateLabel, '2026-07-10 → 2026-07-13 · 4 verified dates');
  assert.equal(wide.lightspeedNet, 520000);
  assert.equal(wide.openTableNet, 440000);
  assert.notEqual(narrow.caption, wide.caption);
});

test('reconciliation withholds an empty intersection and gives an actionable coverage requirement', () => {
  const state = deriveReconciliationCaptionState(
    [{ date: '2026-07-12', net: 140000 }],
    [{ date: '2026-07-12', seatedCovers: 70, revenueCovers: null, revenueNet: null }],
    { from: '2026-07-12', to: '2026-07-12' },
  );

  assert.equal(state.withheld, true);
  assert.equal(state.openTableNet, null);
  assert.match(state.caption, /2026-07-12/);
  assert.match(state.caption, /revenue_covers and revenue_net_pence/);
  assert.match(state.caption, /clear the gate/);
  assert.doesNotMatch(state.caption, /£\d/);
});
