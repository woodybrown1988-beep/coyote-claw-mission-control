'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const reports = require('../mission-control/ui/pages/coyote/reports.js');

const {
  deriveSittingCaptionState,
  sittingCaptureVerdict,
  deriveCoversCaptionState,
  deriveReconciliationCaptionState,
} = reports;

test('sitting population and capture name and count all three known basis grains', () => {
  const sittings = [
    { basis: 'table-cluster', channel: 'served', tableName: 'Table 7', receiptCount: 2, net: 6000 },
    { basis: 'order-tab', channel: 'served', tableName: 'Order 19', receiptCount: 1, net: 3000 },
    { basis: 'channel-slot', channel: 'QR', tableName: 'Order 8', receiptCount: 3, net: 8400 },
  ];
  const captureRows = [
    { label: 'STOREKIT ORDER & PAY', net: 8400, sittingNet: 8400 },
    { label: 'EAT IN', net: 9000, sittingNet: 9000 },
  ];

  const state = deriveSittingCaptionState(sittings, captureRows);

  assert.equal(state.population.total, 3);
  assert.equal(state.population.tableClusters, 1);
  assert.equal(state.population.standaloneOrders, 1);
  assert.equal(state.population.channelSlots, 1);
  assert.equal(state.population.supported, true, 'channel-slot is a supported population, so it must not withhold the panel');
  assert.match(state.populationCaption, /basis "table-cluster".*1 clustered table-served receipt group/);
  assert.match(state.populationCaption, /basis "order-tab".*1 standalone served Order N tab/);
  assert.match(state.populationCaption, /basis "channel-slot".*1 QR session slot/);
  assert.match(state.populationCaption, /STOREKIT receipts sharing one \(business_date, raw table_name\)/);
  for (const basis of ['table-cluster', 'order-tab', 'channel-slot']) assert.match(state.captureCaption, new RegExp(basis));
  assert.match(state.captureCaption, /QR 100\.0%/);
  assert.match(state.captureCaption, /served 100\.0%/);
  assert.equal(sittingCaptureVerdict(state.capture).ok, true);
});

test('an unknown non-empty sitting basis is reported literally without withholding supported channel figures', () => {
  const state = deriveSittingCaptionState([
    { basis: 'table-cluster', channel: 'served', tableName: 'Table 7', receiptCount: 2, net: 6000 },
    { basis: 'order-tab', channel: 'served', tableName: 'Order 19', receiptCount: 1, net: 3000 },
    { basis: 'channel-slot', channel: 'QR', tableName: 'Order 8', receiptCount: 3, net: 8400 },
    { basis: 'future-grain', channel: 'served', tableName: 'Walk-in 2', receiptCount: 1, net: 2000 },
    { basis: 'future-grain', channel: 'served', tableName: 'Walk-in 3', receiptCount: 1, net: 1000 },
  ], [
    { label: 'STOREKIT ORDER & PAY', net: 8400, sittingNet: 8400 },
    { label: 'EAT IN', net: 12000, sittingNet: 12000 },
  ]);

  assert.equal(state.population.total, 5);
  assert.equal(state.population.unknownBases['future-grain'], 2);
  assert.equal(state.population.supported, true);
  assert.match(state.populationCaption, /2 sittings carry basis "future-grain", which this page does not yet describe/);
  assert.match(state.captureCaption, /basis "future-grain": 2 sittings \(not yet described\)/);
  assert.equal(state.capture.supported, true);
  assert.equal(state.capture.QR, 1);
  assert.equal(state.capture.served, 1);
  const verdict = sittingCaptureVerdict(state.capture);
  assert.equal(verdict.ok, true, 'the QR and served figures remain renderable');

  const body = reports.render({
    tab: 'drivers',
    drivers: {
      apiMax: '2026-08-31',
      sit: {
        to: '2026-08-31', totSit: 5,
        by: {
          QR: { sittings: 1, net: 8400, rcpts: 3 },
          served: { sittings: 4, net: 12000, rcpts: 5 },
        },
        capture: state.capture, captureByLabel: state.capture.byLabel,
        captionState: state, verdict,
      },
    },
  }, {}).body;
  assert.match(body, /Net \/ QR sitting<\/div><div class="r-kpi-value">£84\.00</);
  assert.match(body, /Net \/ served sitting<\/div><div class="r-kpi-value">£30\.00</);
});

test('an explicitly missing basis retains the sitting-population withholding guard', () => {
  const state = deriveSittingCaptionState(
    [{ basis: null, channel: 'served', tableName: 'Table 7', receiptCount: 1, net: 3000 }],
    [
      { label: 'STOREKIT ORDER & PAY', net: 3000, sittingNet: 3000 },
      { label: 'EAT IN', net: 3000, sittingNet: 3000 },
    ],
  );

  assert.equal(state.population.supported, false);
  assert.match(state.populationCaption, /Sitting population unavailable — missing basis/);
});

test('sitting capture withholds unsupported percentages and names a missing basis-row net', () => {
  const state = deriveSittingCaptionState(
    [
      { basis: 'channel-slot', channel: 'QR', tableName: 'Order 8', receiptCount: 1, net: 3000 },
      { basis: 'order-tab', channel: 'served', tableName: 'Order 9', receiptCount: 1 },
    ],
    [
      { label: 'STOREKIT ORDER & PAY', net: 3000 },
      { label: 'EAT IN', net: 3000 },
    ],
  );

  assert.equal(state.capture.supported, false);
  assert.match(state.captureCaption, /missing net_pence on sitting rows/);
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
