'use strict';

// QuickBooks Sales Entry — SETTLEMENT BASIS (operator ruling 2026-09-04).
//
// "We shouldn't have overspills changing the sales values — review how our Power BI is worked and do
// it that way." Each processor is a block that nets to zero (Sales = card gross − tips; Card = −(gross
// − fee); Tips = +tips; Fee = −fee), cash takings and gift cards are blocks of their own, and Over/Short
// is 0.00 BY CONSTRUCTION. The till survives only as a diagnostic comparison that feeds no row.
//
// THE CLASSES PINNED HERE:
//  1. A receipt derived from the money that settled cannot leak a residual — so any non-zero
//     Over/Short is a code defect, never a business finding. Every fixture asserts rows sum to zero.
//  2. A tender CODE is a label staff chose; the PROCESSOR is a fact of where the money went. Both
//     "POS error" buttons are the Adyen reader (Lightspeed Payments); VISA/MC are never a processor.
//  3. Sources must be declared: settlement rows win for gross/fee/refunds, an operator-entered value
//     wins over settlement and SAYS so, and a missing input leaves its row gross and INCOMPLETE — it is
//     never treated as a typed zero.
//  4. Cash tips are not the business's money: till-recorded tip_pence on CASH rows reaches no row.

const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');

const reports = require('../mission-control/ui/pages/coyote/reports.js');
const { applyQuickBooksSalesFee } = require('../mission-control/server.js');

const {
  calculateQuickBooksSales,
  formatQuickBooksFeeDerivation,
  latestCompleteMonth,
} = reports;

// The ENGINE declares qb_sales_fees (coyote-claw src/schema.sql); server.js never creates it. The
// two-key CHECK below is the LIVE shape today; the three-key shape is what engine job 306b5f1e lands.
const QB_SALES_FEES_DDL_LIVE = `CREATE TABLE IF NOT EXISTS qb_sales_fees (
  month       TEXT    NOT NULL,
  line        TEXT    NOT NULL CHECK (line IN ('pos_fee','online_fee')),
  value_pence INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (month, line)
)`;
const QB_SALES_FEES_DDL_NEXT = QB_SALES_FEES_DDL_LIVE.replace("('pos_fee','online_fee')", "('pos_fee','online_fee','online_refunds')");

function feeDb(ddl = QB_SALES_FEES_DDL_LIVE) {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(ddl);
  return db;
}

const sum = (result) => result.rows.reduce((total, row) => total + (row.amountPence == null ? 0 : row.amountPence), 0);
const byKey = (result, key) => result.rows.find((row) => row.key === key);

// One synthetic month exercising every rule. Hand-computed expectations are in the tests; nothing is
// copied from a real export.
function mayFixture() {
  const salesDates = [];
  for (let day = 1; day <= 31; day++) salesDates.push(`2026-05-${String(day).padStart(2, '0')}`);
  return {
    month: '2026-05',
    salesDates,
    accountingGroups: [{ code: '29', name: 'SHAKES' }],
    receipts: [
      { receipt_id: 'eat', business_date: '2026-05-02', type: 'SALE', cancelled: 0, channel_label: 'EAT IN', net_with_tax_pence: 12000 },
      { receipt_id: 'split', business_date: '2026-05-03', type: 'SPLIT', cancelled: 0, channel_label: 'STOREKIT ORDER & PAY', net_with_tax_pence: 3600 },
      { receipt_id: 'cash', business_date: '2026-05-04', type: 'SALE', cancelled: 0, channel_label: 'EAT IN', net_with_tax_pence: 3000 },
      { receipt_id: 'online', business_date: '2026-05-06', type: 'SALE', cancelled: 0, channel_label: 'ONLINE ORDER', net_with_tax_pence: 7800 },
      { receipt_id: 'dojo', business_date: '2026-05-07', type: 'SALE', cancelled: 0, channel_label: 'EAT IN', net_with_tax_pence: 400 },
      { receipt_id: 'visa-load', business_date: '2026-05-08', type: 'TRANSFER', cancelled: 0, channel_label: 'MON-FRI DEAL', net_with_tax_pence: null },
      { receipt_id: 'card-load', business_date: '2026-05-09', type: 'TRANSFER', cancelled: 0, channel_label: 'MON-FRI DEAL', net_with_tax_pence: null },
      { receipt_id: 'redeem', business_date: '2026-05-10', type: 'SALE', cancelled: 0, channel_label: 'MON-FRI DEAL', net_with_tax_pence: 2725 },
      { receipt_id: 'cancelled', business_date: '2026-05-11', type: 'SALE', cancelled: 1, channel_label: 'EAT IN', net_with_tax_pence: 9999 },
      { receipt_id: 'void', business_date: '2026-05-12', type: 'VOID', cancelled: 0, channel_label: 'EAT IN', net_with_tax_pence: -400 },
      { receipt_id: 'recall', business_date: '2026-05-12', type: 'RECALL', cancelled: 0, channel_label: 'EAT IN', net_with_tax_pence: 400 },
      { receipt_id: 'takeaway', business_date: '2026-05-13', type: 'SALE', cancelled: 0, channel_label: 'TAKE-AWAY', net_with_tax_pence: 1000 },
      { receipt_id: 'phantom', business_date: '2026-05-14', type: 'SALE', cancelled: 0, channel_label: 'MON-FRI DEAL', net_with_tax_pence: 1860 },
      { receipt_id: 'mc', business_date: '2026-05-15', type: 'SALE', cancelled: 0, channel_label: 'EAT IN', net_with_tax_pence: 500 },
      { receipt_id: 'unmapped', business_date: '2026-05-16', type: 'SALE', cancelled: 0, channel_label: null, net_with_tax_pence: 2400 },
    ],
    lines: [
      { receipt_id: 'online', line_id: 'meal', parent_line_id: null, business_date: '2026-05-06', accounting_group: '10', net_with_tax_pence: 6000 },
      { receipt_id: 'online', line_id: 'shake', parent_line_id: null, business_date: '2026-05-06', accounting_group: '29', net_with_tax_pence: 1200 },
      { receipt_id: 'online', line_id: 'option', parent_line_id: 'shake', business_date: '2026-05-06', accounting_group: null, net_with_tax_pence: 600 },
    ],
    payments: [
      { receipt_id: 'eat', payment_seq: 0, business_date: '2026-05-02', code: 'LSPAY_ADYEN_TERMINAL_API_LOCAL', net_with_tax_pence: 12000, tip_pence: 500 },
      { receipt_id: 'split', payment_seq: 0, business_date: '2026-05-03', code: 'STR', net_with_tax_pence: 3600, tip_pence: 100 },
      { receipt_id: 'cash', payment_seq: 0, business_date: '2026-05-04', code: 'CASH', net_with_tax_pence: 3000, tip_pence: 200 },
      { receipt_id: 'online', payment_seq: 0, business_date: '2026-05-06', code: 'LP', net_with_tax_pence: 7800, tip_pence: 0 },
      { receipt_id: 'dojo', payment_seq: 0, business_date: '2026-05-07', code: 'POS ERROR - PAID ON DOJO', net_with_tax_pence: 400, tip_pence: 50 },
      { receipt_id: 'visa-load', payment_seq: 0, business_date: '2026-05-08', code: 'IKGIFT', net_with_tax_pence: -5000, tip_pence: 0 },
      { receipt_id: 'visa-load', payment_seq: 1, business_date: '2026-05-08', code: 'VISA', net_with_tax_pence: 5000, tip_pence: 0 },
      { receipt_id: 'card-load', payment_seq: 0, business_date: '2026-05-09', code: 'IKGIFT', net_with_tax_pence: -2000, tip_pence: 0 },
      { receipt_id: 'card-load', payment_seq: 1, business_date: '2026-05-09', code: 'LSPAY_ADYEN_TERMINAL_API_LOCAL', net_with_tax_pence: 2000, tip_pence: 0 },
      { receipt_id: 'redeem', payment_seq: 0, business_date: '2026-05-10', code: 'IKGIFT', net_with_tax_pence: 2725, tip_pence: 0 },
      { receipt_id: 'void', payment_seq: 0, business_date: '2026-05-12', code: 'LSPAY_ADYEN_TERMINAL_API_LOCAL', net_with_tax_pence: -400, tip_pence: 0 },
      { receipt_id: 'recall', payment_seq: 0, business_date: '2026-05-12', code: 'LSPAY_ADYEN_TERMINAL_API_LOCAL', net_with_tax_pence: 400, tip_pence: 0 },
      { receipt_id: 'takeaway', payment_seq: 0, business_date: '2026-05-13', code: 'LSPAY_ADYEN_TERMINAL_API_LOCAL', net_with_tax_pence: 1000, tip_pence: 0 },
      { receipt_id: 'phantom', payment_seq: 0, business_date: '2026-05-14', code: null, net_with_tax_pence: 1860, tip_pence: 0 },
      { receipt_id: 'mc', payment_seq: 0, business_date: '2026-05-15', code: 'MC', net_with_tax_pence: 500, tip_pence: 0 },
    ],
    fees: { pos_fee: -300, online_fee: -100, online_refunds: -300 },
  };
}

// Hand-computed from the fixture:
//   Lightspeed gross = 12000+500 (eat) + 2000 (card-load) − 400 (void) + 400 (recall) + 1000 (takeaway) + 400+50 (dojo) = 15950; tips 550; sales 15400
//   Storekit gross = 3600+100 = 3700; tips 100; sales 3600
//   Cash = 3000 (the 200 tip excluded) · gift sold = 5000 + 2000 = 7000 · redeemed = 2725
//   Row 1 = 15400 + 3600 + 3000 + 2725 − 7000 = 17725
//   Online gross 7800, refunds −300 → net 7500; shakes 1800 → row 6 = 5700; row 8 = −(7500 − 100) = −7400
const EXPECTED_MAY = [17725, -19350, 650, -3000, -300, 5700, 1800, -7400, -100, 7000, -2725, 0];

function withFreeLoads(fixture) {
  fixture.receipts.push(
    { receipt_id: 'bonus-load', business_date: '2026-05-20', type: 'TRANSFER', cancelled: 0, channel_label: 'MON-FRI DEAL', net_with_tax_pence: null },
    { receipt_id: 'R1038197.18539', business_date: '2026-05-06', type: 'TRANSFER', cancelled: 0, channel_label: 'EAT IN', net_with_tax_pence: null },
  );
  fixture.payments.push(
    { receipt_id: 'bonus-load', payment_seq: 0, business_date: '2026-05-20', code: 'IKGIFT', net_with_tax_pence: -1000, tip_pence: 0 },
    { receipt_id: 'bonus-load', payment_seq: 1, business_date: '2026-05-20', code: 'BLACK FRIDAY 10', net_with_tax_pence: 1000, tip_pence: 0 },
    { receipt_id: 'R1038197.18539', payment_seq: 0, business_date: '2026-05-06', code: 'IKGIFT', net_with_tax_pence: -5000, tip_pence: 0 },
    { receipt_id: 'R1038197.18539', payment_seq: 1, business_date: '2026-05-06', code: 'CASH', net_with_tax_pence: 5000, tip_pence: 0 },
  );
  return fixture;
}
const aprilOf = (fixture) => {
  const shifted = JSON.parse(JSON.stringify(fixture).split('2026-05-').join('2026-04-'));
  shifted.month = '2026-04';
  shifted.salesDates = shifted.salesDates.filter((d) => d <= '2026-04-30');
  return shifted;
};

test('sixth QuickBooks tab defaults to the latest fully completed calendar month', () => {
  assert.equal(latestCompleteMonth(Date.UTC(2026, 8, 3)), '2026-08');
  assert.equal(latestCompleteMonth(Date.UTC(2026, 0, 4)), '2025-12', 'January crosses the year boundary');

  const q = () => ({ ok: true, rows: [] });
  const section = reports.getSection(null, { q, now: Date.UTC(2026, 8, 3), query: { tab: 'qbsales' } });
  assert.equal(section.qbsales.month, '2026-08');
  const selected = reports.getSection(null, { q, now: Date.UTC(2026, 8, 3), query: { tab: 'qbsales', month: '2026-04' } });
  const malformed = reports.getSection(null, { q, now: Date.UTC(2026, 8, 3), query: { tab: 'qbsales', month: 'April' } });
  assert.equal(selected.qbsales.month, '2026-04');
  assert.equal(malformed.qbsales.month, '2026-08', 'malformed picker input falls back safely');
  const body = reports.render(section, {}).body;
  assert.equal((body.match(/class="r-tab[ "]/g) || []).length, 6);
  assert.match(body, /QuickBooks Sales Entry/);
  assert.match(body, /type="month"[^>]*value="2026-08"/);
});

test('settlement basis: every row is derived, twelve rows sum to zero, Over/Short is 0.00 by construction', () => {
  const result = calculateQuickBooksSales(mayFixture());
  assert.deepEqual(result.rows.map((row) => row.amountPence), EXPECTED_MAY);
  assert.equal(result.rows.length, 12);
  assert.equal(sum(result), 0);
  assert.equal(result.subtotalPence, 0, 'rows 1–11 already sum to zero — nothing is balanced through row 12');
  assert.equal(byKey(result, 'over_short').amountPence, 0);
  assert.match(byKey(result, 'over_short').derivation, /by construction/);
  // row 1 = Σ(card gross − tips) + cash + redeemed − sold, stated in its own derivation
  assert.match(byKey(result, 'in_house_sales').derivation, /gross 15950 − tips 550 = 15400/);
  assert.match(byKey(result, 'in_house_sales').derivation, /gross 3700 − tips 100 = 3600/);
  assert.match(byKey(result, 'in_house_sales').derivation, /cash takings 3000 \+ gift cards redeemed 2725 − gift cards sold 7000 = 17725/);
  assert.deepEqual(result.blocks.gift, { soldPence: 7000, redeemedPence: 2725 });
  assert.deepEqual(result.blocks.cash, { pence: 3000, tipPence: 200 });
});

test('a tender code is a label; the processor is the fact — DOJO button is Lightspeed Payments, VISA/MC never a processor, cash tips reach no row', () => {
  const fixture = mayFixture();
  const withoutDojo = { ...fixture, payments: fixture.payments.filter((payment) => payment.code !== 'POS ERROR - PAID ON DOJO') };
  const full = calculateQuickBooksSales(fixture);
  const less = calculateQuickBooksSales(withoutDojo);
  assert.equal(byKey(full, 'card_payments').amountPence - byKey(less, 'card_payments').amountPence, -450, 'the DOJO code adds its gross+tip to row 2');
  assert.equal(byKey(full, 'tips_payable').amountPence - byKey(less, 'tips_payable').amountPence, 50, 'and its tip to row 3');
  assert.match(byKey(full, 'card_payments').derivation, /POS ERROR - PAID ON DOJO/);

  const withoutNever = { ...fixture, payments: fixture.payments.filter((payment) => payment.code !== 'VISA' && payment.code !== 'MC') };
  const noNever = calculateQuickBooksSales(withoutNever);
  assert.deepEqual(full.rows.map((row) => row.amountPence), noNever.rows.map((row) => row.amountPence), 'VISA and MC payments change no row');
  assert.deepEqual(full.blocks.neverCard, { count: 2, pence: 5500 }, 'they are counted and reported outside the receipt, never absorbed');
  assert.match(byKey(full, 'in_house_sales').derivation, /VISA\/MC are never a processor/);

  const withoutCashTip = { ...fixture, payments: fixture.payments.map((payment) => (payment.code === 'CASH' ? { ...payment, tip_pence: 0 } : payment)) };
  const noTip = calculateQuickBooksSales(withoutCashTip);
  assert.deepEqual(full.rows.map((row) => row.amountPence), noTip.rows.map((row) => row.amountPence), 'a till-recorded cash tip reaches no row');
  assert.equal(byKey(full, 'cash_payments').amountPence, -3000);
  assert.match(byKey(full, 'tips_payable').derivation, /Cash tips \(200 pence this month\) are not the business's money/);
});

test('a missing input leaves its row gross, is named, marks the receipt INCOMPLETE — and Over/Short still 0.00', () => {
  const fixture = mayFixture();
  fixture.fees = {};
  const result = calculateQuickBooksSales(fixture);
  assert.equal(byKey(result, 'card_payments').amountPence, -19650, 'gross card when no POS fee');
  assert.equal(byKey(result, 'pos_fee').amountPence, null);
  assert.equal(byKey(result, 'pos_fee').entered, false);
  assert.equal(byKey(result, 'online_twenty_sales').amountPence, 7800 - 1800, 'online sales gross when refunds unknown');
  assert.equal(byKey(result, 'online_card_payments').amountPence, -7800, 'online card gross when neither fee nor refunds entered');
  assert.equal(byKey(result, 'online_fee').amountPence, null);
  assert.match(byKey(result, 'online_twenty_sales').derivation, /online refunds UNKNOWN/);
  assert.match(byKey(result, 'card_payments').derivation, /no processor fee entered for this month/);
  assert.doesNotMatch(byKey(result, 'card_payments').derivation, /\bnet\b/i);
  assert.deepEqual(result.feeMissing, ['POS card fees', 'Online card fees', 'Online refunds']);
  assert.equal(result.complete, false);
  assert.equal(byKey(result, 'over_short').amountPence, 0);
  assert.equal(sum(result), 0);

  assert.deepEqual(result.incompleteReasons, ['POS card fees', 'Online card fees', 'Online refunds'], 'incomplete always names why');

  // Operator ruling 2026-09-07: with every input present the receipt is COMPLETE even when the VAT base
  // is not an exact 20% split of gross — that is a penny of rounding, surfaced as a named warning.
  const complete = calculateQuickBooksSales(mayFixture());
  assert.deepEqual(complete.feeMissing, []);
  assert.equal(complete.vatBaseExact, false, 'the fixture gross (row 1 + row 6) is deliberately not divisible by 6');
  assert.equal(complete.complete, true, 'a penny of VAT rounding never makes the receipt incomplete');
  assert.deepEqual(complete.incompleteReasons, []);
  assert.equal(complete.warnings.length, 1);
  assert.match(complete.warnings[0], /VAT base not an exact 20% split of gross/);

  const gap = mayFixture();
  gap.salesDates = gap.salesDates.filter((d) => d !== '2026-05-09');
  const withGap = calculateQuickBooksSales(gap);
  assert.equal(withGap.complete, false);
  assert.deepEqual(withGap.incompleteReasons, ['1 expected sales date(s) (2026-05-09)'], 'a missing trading date is named');
});

test("settlement rows are matched by the names the ENGINE writes ('Lightspeed Payments', 'LivePepper'), not only the slot names", () => {
  // The class: a consumer that keys on a name it invented, while the writer writes the real one. With
  // 'Lightspeed Payments' unmatched, the card block silently stayed a till proxy for a month whose
  // settlement rows were already in the table. Storekit is deliberately absent (its export is a later
  // job), so the card source must read MIXED and the POS fee must stay missing — one processor's fee
  // is never presented as both.
  assert.deepEqual(Object.keys(reports.QB_SETTLEMENT_PROCESSOR_ALIASES), ['lightspeed', 'storekit', 'livepepper']);
  assert.ok(reports.QB_SETTLEMENT_PROCESSOR_ALIASES.lightspeed.includes('lightspeed payments'));
  const fixture = mayFixture();
  fixture.fees = {};
  fixture.settlement = [
    { processor: 'Lightspeed Payments', grossPence: 16000, feePence: -200, refundPence: null },
    { processor: 'LivePepper', grossPence: 7900, feePence: -120, refundPence: -400 },
  ];
  const result = calculateQuickBooksSales(fixture);
  assert.match(byKey(result, 'in_house_sales').derivation, /Lightspeed Payments \(gross 16000 − tips 550 = 15450\) \[settlement\]/, 'the engine-named row drives the Lightspeed block');
  assert.equal(result.sources.card, 'mixed (settlement + till proxy)', 'Storekit absent: mixed, never claimed as settlement');
  assert.equal(result.sources.online, 'settlement');
  assert.equal(byKey(result, 'pos_fee').entered, false, 'POS fee stays missing until BOTH card processors carry a fee');
  assert.equal(byKey(result, 'online_fee').amountPence, -120);
  assert.match(byKey(result, 'online_twenty_sales').derivation, /refunds -400/, 'refunds ride on the online sales row, from the engine-named LivePepper row');
});

test('settlement rows win for gross, fee and refunds; an operator-entered value wins over settlement and says so; tips stay the till\'s', () => {
  const fixture = mayFixture();
  fixture.fees = {};
  fixture.settlement = [
    { processor: 'lightspeed', grossPence: 16000, feePence: -200, refundPence: null },
    { processor: 'storekit', grossPence: 3700, feePence: -100, refundPence: null },
    { processor: 'livepepper', grossPence: 7900, feePence: -120, refundPence: -400 },
  ];
  const result = calculateQuickBooksSales(fixture);
  assert.equal(result.sources.card, 'settlement');
  assert.equal(result.sources.online, 'settlement');
  assert.equal(byKey(result, 'in_house_sales').amountPence, (16000 - 550) + (3700 - 100) + 3000 + 2725 - 7000, 'settlement gross, till tips');
  assert.equal(byKey(result, 'card_payments').amountPence, -(19700 - 300), 'settlement fees summed across the two card processors');
  assert.equal(byKey(result, 'pos_fee').amountPence, -300);
  assert.equal(result.sources.posFee, 'settlement');
  assert.equal(byKey(result, 'online_twenty_sales').amountPence, 7900 - 400 - 1800);
  assert.equal(byKey(result, 'online_card_payments').amountPence, -(7900 - 400 - 120));
  assert.match(result.sourceCaption, /processor settlement rows/);
  assert.doesNotMatch(byKey(result, 'card_payments').derivation, /TILL PROXY/);
  assert.equal(sum(result), 0);

  fixture.fees = { pos_fee: -250 };
  const override = calculateQuickBooksSales(fixture);
  assert.equal(byKey(override, 'pos_fee').amountPence, -250, 'operator entry wins');
  assert.match(byKey(override, 'pos_fee').derivation, /operator-entered POS fee -250 pence used; settlement carried -300 pence — operator entry wins by precedence/);
  assert.equal(override.sources.posFee, 'operator input');
  assert.equal(sum(override), 0);

  const proxy = calculateQuickBooksSales(mayFixture());
  assert.equal(proxy.sources.card, 'till proxy');
  assert.match(byKey(proxy, 'card_payments').derivation, /TILL PROXY — settlement export not yet loaded/);
  assert.match(proxy.sourceCaption, /from till tenders — settlement export not yet loaded/);
});

test('gift cards: from 2026-05 a load funded by a free tender is outside the receipt (marketing, not a sale); before it, every load was sold whatever paid for it; redemptions are IKGIFT-positive on non-cancelled SALE/SPLIT/RECALL', () => {
  const fixture = mayFixture();
  fixture.receipts.push(
    { receipt_id: 'voucher', business_date: '2026-05-17', type: 'TRANSFER', cancelled: 0, channel_label: 'MON-FRI DEAL', net_with_tax_pence: null },
    { receipt_id: 'redeem-cancelled', business_date: '2026-05-18', type: 'SALE', cancelled: 1, channel_label: 'EAT IN', net_with_tax_pence: 1000 },
    { receipt_id: 'redeem-recall', business_date: '2026-05-19', type: 'RECALL', cancelled: 0, channel_label: 'EAT IN', net_with_tax_pence: 1500 },
    { receipt_id: 'gift-void', business_date: '2026-05-20', type: 'VOID', cancelled: 0, channel_label: 'EAT IN', net_with_tax_pence: -700 },
  );
  fixture.payments.push(
    { receipt_id: 'voucher', payment_seq: 0, business_date: '2026-05-17', code: 'IKGIFT', net_with_tax_pence: -1000, tip_pence: 0 },
    { receipt_id: 'voucher', payment_seq: 1, business_date: '2026-05-17', code: 'BLACK FRIDAY 10', net_with_tax_pence: 1000, tip_pence: 0 },
    { receipt_id: 'redeem-cancelled', payment_seq: 0, business_date: '2026-05-18', code: 'IKGIFT', net_with_tax_pence: 1000, tip_pence: 0 },
    { receipt_id: 'redeem-recall', payment_seq: 0, business_date: '2026-05-19', code: 'IKGIFT', net_with_tax_pence: 1500, tip_pence: 0 },
    { receipt_id: 'gift-void', payment_seq: 0, business_date: '2026-05-20', code: 'IKGIFT', net_with_tax_pence: -700, tip_pence: 0 },
  );
  const result = calculateQuickBooksSales(fixture);
  assert.equal(byKey(result, 'gift_sold').amountPence, 7000, 'May 2026: the free-voucher load is outside the receipt — row 10 carries the two paid loads');
  assert.deepEqual({ count: result.freeGiftCards.count, pence: result.freeGiftCards.pence, byTender: result.freeGiftCards.byTender }, { count: 1, pence: 1000, byTender: { 'BLACK FRIDAY 10': 1000 } });
  assert.equal(byKey(calculateQuickBooksSales(aprilOf(fixture)), 'gift_sold').amountPence, 8000, 'April 2026, before the cut-in: not restated — the free-voucher load is still a card sold');
  assert.equal(byKey(result, 'gift_redeemed').amountPence, -(2725 + 1500), 'RECALL counts, cancelled does not, a VOID reversal is not a redemption');
  assert.equal(sum(result), 0);
});

test('the till is kept visible and OUT of the numbers: Lightspeed-basis comparison incl. Take-Away feeds no row', () => {
  const result = calculateQuickBooksSales(mayFixture());
  // eat 12000 + split 3600 + cash 3000 + dojo 400 + redeem 2725 + void −400 + recall 400 + takeaway 1000 + phantom 1860 + mc 500
  assert.equal(result.tillComparison.tillSalesPence, 25085);
  assert.equal(result.tillComparison.settlementSalesPence, 17725);
  assert.equal(result.tillComparison.differencePence, 25085 - 17725);
  assert.match(result.tillComparison.caption, /Diagnostic only — feeds no row/);
  const shifted = mayFixture();
  shifted.receipts.find((row) => row.receipt_id === 'phantom').net_with_tax_pence = 99999;
  const moved = calculateQuickBooksSales(shifted);
  assert.deepEqual(moved.rows.map((row) => row.amountPence), result.rows.map((row) => row.amountPence), 'a till-only change moves no row');
  assert.notEqual(moved.tillComparison.tillSalesPence, result.tillComparison.tillSalesPence, 'but the comparison sees it');
});

test('the page renders twelve rows, the by-construction tag, the source caption, the refunds control, and a client script that parses', () => {
  const result = calculateQuickBooksSales(mayFixture());
  const body = reports.render({ tab: 'qbsales', qbsales: result }, {}).body;
  for (let line = 1; line <= 12; line++) assert.match(body, new RegExp(`<tr data-qb-line="${line}">`));
  assert.match(body, /0\.00 by construction/);
  assert.match(body, /Sources<\/strong> — /);
  assert.match(body, /Till comparison \(diagnostic only — feeds no row\)/);
  assert.match(body, /data-qb-line="online_refunds"/);
  assert.match(body, /data-qb-line="pos_fee"/);
  assert.match(body, /Gift cards sold \(liability \+\)/);
  assert.match(body, /Settlement basis/);
  const scripts = [...body.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  assert.ok(scripts.length >= 1, 'the fee-entry script is emitted');
  for (const script of scripts) assert.doesNotThrow(() => new Function(script), 'the emitted client script must parse — one parse error kills every button');

  const missing = calculateQuickBooksSales({ ...mayFixture(), fees: {} });
  const missingBody = reports.render({ tab: 'qbsales', qbsales: missing }, {}).body;
  assert.match(missingBody, /INCOMPLETE/);
  assert.match(missingBody, /missing POS card fees, Online card fees, Online refunds/);
  assert.match(missingBody, /Operator input required — from the card processor statement; not held on this box\./);
});

test('shared fee formatter keeps signed operands, results, wording and plausibility aligned', () => {
  assert.deepEqual(formatQuickBooksFeeDerivation({ grossPence: 10000, feePence: -500, grossLabel: 'card', feeLabel: 'POS' }), {
    resultPence: 9500,
    explanation: 'gross card takings 10000 pence + signed POS processor fee -500 pence (deducted) = net 9500 pence',
    warning: null,
  });
  assert.deepEqual(formatQuickBooksFeeDerivation({ grossPence: 10000, feePence: 500, grossLabel: 'LP', feeLabel: 'online' }), {
    resultPence: 10500,
    explanation: 'gross LP takings 10000 pence + signed online processor fee +500 pence (added) = 10500 pence',
    warning: null,
  });
  assert.deepEqual(formatQuickBooksFeeDerivation({ grossPence: 10000, feePence: 0, grossLabel: 'card', feeLabel: 'POS' }), {
    resultPence: 10000,
    explanation: 'gross card takings 10000 pence + signed POS processor fee 0 pence = unchanged at 10000 pence',
    warning: null,
  });
  assert.deepEqual(formatQuickBooksFeeDerivation({ grossPence: 10000, feePence: null, grossLabel: 'card', feeLabel: 'POS' }), {
    resultPence: 10000,
    explanation: 'gross card takings 10000 pence — no processor fee entered for this month',
    warning: null,
  });
  assert.match(formatQuickBooksFeeDerivation({ grossPence: 10000, feePence: -1300, grossLabel: 'card', feeLabel: 'POS' }).warning, /13\.0% of positive gross takings/);
});

test('fee persistence validates month, line and signed integer pence; online_refunds is accepted by the route and refused by the live two-key table until the engine migration lands', () => {
  const live = feeDb();
  for (const body of [
    { op: 'set_qb_sales_fee', month: '2026-4', line: 'pos_fee', value_pence: -100 },
    { op: 'set_qb_sales_fee', month: '2026-13', line: 'pos_fee', value_pence: -100 },
    { op: 'set_qb_sales_fee', month: '2026-04', line: 'row_1', value_pence: -100 },
    { op: 'set_qb_sales_fee', month: '2026-04', line: 'online_fee', value_pence: -1.5 },
    { op: 'set_qb_sales_fee', month: '2026-04', line: 'online_fee', value_pence: '-100' },
    { op: 'set_qb_sales_fee', month: '2026-04', line: 'pos_fee', value_pence: -100, arbitrary_key: true },
    { op: 'arbitrary', month: '2026-04', line: 'pos_fee', value_pence: -100 },
    { op: 'set_qb_sales_fee', month: '2026-04', line: 'pos_fee', value_pence: 100 },
  ]) {
    const refused = applyQuickBooksSalesFee(live, body, 123);
    assert.equal(refused.ok, false, JSON.stringify(body));
    assert.equal(refused.status, 400);
  }
  const ok = applyQuickBooksSalesFee(live, { op: 'set_qb_sales_fee', month: '2026-05', line: 'pos_fee', value_pence: -219764 }, 123);
  assert.equal(ok.ok, true);
  assert.equal(ok.value_pence, -219764);
  const zero = applyQuickBooksSalesFee(live, { op: 'set_qb_sales_fee', month: '2026-05', line: 'online_fee', value_pence: 0 }, 124);
  assert.equal(zero.ok, true, 'an explicit zero is an entered value');

  const refundsOnLive = applyQuickBooksSalesFee(live, { op: 'set_qb_sales_fee', month: '2026-05', line: 'online_refunds', value_pence: -5275 }, 125);
  assert.equal(refundsOnLive.ok, false, 'the route allows it; the engine-owned table does not yet');
  assert.match(String(refundsOnLive.error), /CHECK|write failed/i, 'SQLite\'s own words, never a bare failure');

  const next = feeDb(QB_SALES_FEES_DDL_NEXT);
  const refundsOnNext = applyQuickBooksSalesFee(next, { op: 'set_qb_sales_fee', month: '2026-05', line: 'online_refunds', value_pence: -5275 }, 126);
  assert.equal(refundsOnNext.ok, true, 'once the migration widens the CHECK, the same write succeeds unchanged');
  assert.deepEqual(next.prepare('SELECT line, value_pence FROM qb_sales_fees ORDER BY line').all().map((row) => [row.line, row.value_pence]), [['online_refunds', -5275]]);
});

test('free gift cards (from 2026-05): a load funded by a free tender or a ruled cash-keyed receipt leaves rows 1, 4 and 10 and lands in the memo; before the cut-in nothing is restated', () => {
  // THE CLASS: a card given away is a marketing cost and a liability. Counting it as sold reduced Sales
  // income; keying it as cash invented money. Both are excluded from the receipt and named in a memo.
  const base = calculateQuickBooksSales(mayFixture());
  const result = calculateQuickBooksSales(withFreeLoads(mayFixture()));
  assert.equal(byKey(result, 'gift_sold').amountPence, byKey(base, 'gift_sold').amountPence, 'row 10 carries paid loads only');
  assert.equal(byKey(result, 'cash_payments').amountPence, byKey(base, 'cash_payments').amountPence, 'row 4: the cash keyed for a ruled free card never existed');
  assert.equal(byKey(result, 'in_house_sales').amountPence, byKey(base, 'in_house_sales').amountPence, 'row 1: a free card is neither a sale nor a reduction of sales');
  assert.equal(byKey(result, 'over_short').amountPence, 0);
  assert.equal(result.freeGiftCards.active, true);
  assert.deepEqual({ count: result.freeGiftCards.count, pence: result.freeGiftCards.pence }, { count: 2, pence: 6000 });
  assert.deepEqual(result.freeGiftCards.byTender, { 'BLACK FRIDAY 10': 1000, 'ruled free (keyed as cash)': 5000 });
  assert.match(byKey(result, 'gift_sold').derivation, /2 free load\(s\), 6000 pence, are outside this receipt/);
  // before the cut-in: the same evidence is NOT restated — loads count as sold and the keyed cash stays
  const aprilBase = calculateQuickBooksSales(aprilOf(mayFixture()));
  const april = calculateQuickBooksSales(aprilOf(withFreeLoads(mayFixture())));
  assert.equal(april.freeGiftCards.active, false);
  assert.equal(byKey(april, 'gift_sold').amountPence - byKey(aprilBase, 'gift_sold').amountPence, 6000, 'April: every load is sold, as it was');
  assert.equal(byKey(aprilBase, 'cash_payments').amountPence - byKey(april, 'cash_payments').amountPence, 5000, 'April: the keyed cash stays');
  assert.equal(byKey(april, 'over_short').amountPence, 0);
});

test('the cut-in month carries the opening position forward — liability outstanding and its free share as the journal; later months do not', () => {
  const fixture = mayFixture();
  fixture.giftLedgerBefore = { asAt: '2026-05-01', freePence: 81500, paidPence: 2240000, redeemedPence: 1884757 };
  const bf = calculateQuickBooksSales(fixture).freeGiftCards.broughtForward;
  assert.deepEqual(bf, { asAt: '2026-05-01', freeIssuedPence: 81500, paidLoadsPence: 2240000, redeemedPence: 1884757, outstandingPence: 436743,
    journal: { marketingPence: 81500, salesIncomePence: 355243, salesIncomeNetPence: 296036, salesIncomeVatPence: 59207, liabilityPence: 436743 } });
  // the Sales income line is a 20% VAT-inclusive reversal (operator 2026-09-07): net + VAT = gross, VAT = gross/6 to the penny
  assert.equal(bf.journal.salesIncomeNetPence + bf.journal.salesIncomeVatPence, bf.journal.salesIncomePence);
  assert.equal(bf.journal.marketingPence + bf.journal.salesIncomePence, bf.journal.liabilityPence, 'the journal balances');
  const june = calculateQuickBooksSales({ month: '2026-06', giftLedgerBefore: fixture.giftLedgerBefore });
  assert.equal(june.freeGiftCards.active, true);
  assert.equal(june.freeGiftCards.broughtForward, null, 'only the cut-in month shows the opening position');
  assert.equal(calculateQuickBooksSales(mayFixture()).freeGiftCards.broughtForward, null, 'no ledger supplied: nothing invented');
});

test('tender classes: the Lightspeed MOTO and Storekit variants are card money; a tender in no list is surfaced by name, never dropped silently; free vouchers on meals are comps', () => {
  const fixture = mayFixture();
  fixture.receipts.push(
    { receipt_id: 'moto', business_date: '2026-05-21', type: 'SALE', cancelled: 0, channel_label: 'EAT IN', net_with_tax_pence: 7825 },
    { receipt_id: 'skm', business_date: '2026-05-22', type: 'SALE', cancelled: 0, channel_label: 'STOREKIT ORDER & PAY', net_with_tax_pence: 9825 },
    { receipt_id: 'odd', business_date: '2026-05-23', type: 'SALE', cancelled: 0, channel_label: 'EAT IN', net_with_tax_pence: 1234 },
    { receipt_id: 'comp', business_date: '2026-05-24', type: 'SALE', cancelled: 0, channel_label: 'EAT IN', net_with_tax_pence: 790 },
  );
  fixture.payments.push(
    { receipt_id: 'moto', payment_seq: 0, business_date: '2026-05-21', code: 'LSPAY_ADYEN_TERMINAL_API_LOCAL_MOTO', net_with_tax_pence: 7825, tip_pence: 0 },
    { receipt_id: 'skm', payment_seq: 0, business_date: '2026-05-22', code: 'STOREKITM', net_with_tax_pence: 9825, tip_pence: 0 },
    { receipt_id: 'odd', payment_seq: 0, business_date: '2026-05-23', code: 'PAYERROR', net_with_tax_pence: 1234, tip_pence: 0 },
    { receipt_id: 'comp', payment_seq: 0, business_date: '2026-05-24', code: 'BLACK FRIDAY', net_with_tax_pence: 790, tip_pence: 0 },
  );
  const base = calculateQuickBooksSales(mayFixture());
  const result = calculateQuickBooksSales(fixture);
  assert.equal(result.blocks.lightspeed.grossPence - base.blocks.lightspeed.grossPence, 7825, 'MOTO is Lightspeed Payments money');
  assert.equal(result.blocks.storekit.grossPence - base.blocks.storekit.grossPence, 9825, 'STOREKITM is Storekit money');
  assert.deepEqual(result.unclassifiedTenders, [{ code: 'PAYERROR', count: 1, pence: 1234 }]);
  assert.deepEqual(base.unclassifiedTenders, [], 'a null-code phantom payment is not an unclassified tender');
  assert.deepEqual(result.freeVoucherMeals, { count: 1, pence: 790 });
  assert.equal(byKey(result, 'cash_payments').amountPence, byKey(base, 'cash_payments').amountPence, 'neither PAYERROR nor a free voucher is cash');
  assert.equal(byKey(result, 'over_short').amountPence, 0);
});

test('posted-receipt reconciliation: the previous month as posted vs its settlement basis becomes correction lines for this month, summing to zero, with the VAT effect; the posted month is never restated', () => {
  const { reconcilePostedReceipt } = reports;
  const prior = calculateQuickBooksSales(mayFixture());               // settlement basis for the posted month
  const money = byKey(prior, 'in_house_sales').amountPence - prior.blocks.gift.redeemedPence + prior.blocks.gift.soldPence;
  // David's posted receipt, as the mirror stores it: 20% lines NET (+ a VAT Control line), signs as journal credits/debits
  const posted = (rows) => rows.map(([memo, gross, vat]) => ({ doc_num: '1183', memo, debit_pence: gross < 0 ? -gross : 0, credit_pence: gross > 0 ? (vat ? Math.round(gross * 5 / 6) : gross) : 0 }));
  const identical = posted([
    ['Sales Income with VAT (+) May 2026', money, true],
    ['In-Restaurant Card Payments (-) May 2026', byKey(prior, 'card_payments').amountPence, false],
    ['Tips Payable (+) May 2026', byKey(prior, 'tips_payable').amountPence, false],
    ['Cash Payments (-) May 2026', byKey(prior, 'cash_payments').amountPence, false],
    ['Card Payment Fees (POS) (-) May 2026', byKey(prior, 'pos_fee').amountPence, false],
    ['Online Sales Income with VAT (+) May 2026', byKey(prior, 'online_twenty_sales').amountPence, true],
    ['Online Sales Income 0% VAT (+) May 2026', byKey(prior, 'online_zero_sales').amountPence, false],
    ['Online Card Payments (-) May 2026', byKey(prior, 'online_card_payments').amountPence, false],
    ['Card Payment Fees (Online) (-) May 2026', byKey(prior, 'online_fee').amountPence, false],
  ]);
  const same = reconcilePostedReceipt(identical, prior, { moneyBasis: true });
  assert.equal(same.nothingToCarry, true, 'a receipt posted on the settlement basis carries nothing');
  assert.equal(same.balanced, true);
  assert.deepEqual(same.docNums, ['1183']);

  // April-shaped differences: card gross over-posted, tips and cash tips over-posted, fee over-posted, online split moved
  const drifted = identical.map((l) => ({ ...l }));
  const bump = (memo, deltaGross, vat) => { const l = drifted.find((x) => x.memo.startsWith(memo)); const d = vat ? Math.round(deltaGross * 5 / 6) : deltaGross; if (l.credit_pence) l.credit_pence += d; else l.debit_pence -= d; };
  bump('Sales Income with VAT (+)', 43872, true);        // posted 438.72 higher
  bump('In-Restaurant Card Payments (-)', -55524, false); // posted 555.24 more negative
  bump('Tips Payable (+)', 13037, false);
  bump('Cash Payments (-)', -755, false);
  bump('Card Payment Fees (POS) (-)', -630, false);
  bump('Online Sales Income with VAT (+)', -10075, true);
  bump('Online Sales Income 0% VAT (+)', 10075, false);
  const r = reconcilePostedReceipt(drifted, prior, { moneyBasis: true });
  const adj = Object.fromEntries(r.lines.map((l) => [l.key, l.adjustmentPence]));
  assert.deepEqual(adj, { in_house_sales: -43872, card_payments: 55524, tips_payable: -13037, cash_payments: 755, pos_fee: 630, online_twenty_sales: 10075, online_zero_sales: -10075, online_card_payments: 0, online_fee: 0 }, 'corrections = settlement − posted, per line');
  assert.equal(r.balanced, true, 'both receipts balance, so the corrections sum to zero');
  assert.equal(r.vatMovementGrossPence, -43872 + 10075);
  assert.equal(r.vatEffectPence, Math.round((-43872 + 10075) / 6), 'VAT effect = 20% lines gross movement / 6');
  assert.equal(r.nothingToCarry, false);

  // an unknown posted memo is listed, never silently absorbed; row 1 on the FULL basis after the cut-in
  const withStranger = [...identical, { doc_num: '1183', memo: 'Charity Donations (+) May 2026', debit_pence: 0, credit_pence: 25500 }];
  const s2 = reconcilePostedReceipt(withStranger, prior, { moneyBasis: false });
  assert.deepEqual(s2.unknownMemos, ['Charity Donations (+) May 2026']);
  assert.equal(s2.lines.find((l) => l.key === 'in_house_sales').settlementPence, byKey(prior, 'in_house_sales').amountPence, 'after the cut-in row 1 is compared as posted, gift lines included');
  assert.equal(reconcilePostedReceipt([], prior), null, 'no posted receipt: nothing to compare');
});

test('posted-receipt reconciliation: the June/July memo typo still maps; a not-yet-entered input compares as nothing and is named; a posted month carries nothing; an unposted month carries every consecutive posted month before it', () => {
  const { reconcilePostedReceipt } = reports;
  const prior = calculateQuickBooksSales(mayFixture());
  const typo = [{ doc_num: '1185', memo: 'Online Sales Income with June (+) June 2026', debit_pence: 0, credit_pence: Math.round(byKey(prior, 'online_twenty_sales').amountPence * 5 / 6) }];
  const r1 = reconcilePostedReceipt(typo, prior, { moneyBasis: false });
  assert.equal(r1.unknownMemos.length, 0, "'with June' is the 20% online line");
  assert.ok(r1.lines.some((l) => l.key === 'online_twenty_sales' && l.postedPence === byKey(prior, 'online_twenty_sales').amountPence), 'mapped to the 20% online line at the posted gross');

  const noFee = mayFixture(); noFee.fees = {};
  const priorNoFee = calculateQuickBooksSales(noFee);
  const posted = [{ doc_num: '1185', memo: 'Card Payment Fees (POS) (-) June 2026', debit_pence: 0, credit_pence: 0 }];
  const r2 = reconcilePostedReceipt(posted, priorNoFee, { moneyBasis: false });
  assert.deepEqual(r2.missingInputs, ['Card Payment Fees (POS)'], 'a posted zero fee against an un-entered fee is NOT a correction of the whole fee');
  assert.equal(r2.lines.find((l) => l.key === 'pos_fee').adjustmentPence, null);
  assert.equal(r2.nothingToCarry, false);
  assert.equal(r2.balanced, false);

  // the builder: August is unposted; July and June are posted; May is not → August carries July AND June; July itself carries nothing
  const journal = { '2026-06': [{ doc_num: '1185', memo: 'Tips Payable (+) June 2026', debit_pence: 0, credit_pence: 855459 }], '2026-07': [{ doc_num: '1186', memo: 'Tips Payable (+) July 2026', debit_pence: 0, credit_pence: 958465 }] };
  const q = (sql, params) => {
    if (/qb_journal_lines/.test(sql)) return { ok: true, rows: journal[params[0]] || [] };
    if (/sales_api_ingest_runs/.test(sql)) return { ok: true, rows: [] };
    return { ok: true, rows: [] };
  };
  const august = reports.getSection(null, { q, now: Date.UTC(2026, 8, 7), query: { tab: 'qbsales', month: '2026-08' } }).qbsales;
  assert.equal(august.thisMonthPosted, null);
  assert.deepEqual(august.postedReconciliations, [], 'June and July receipts are PLACEHOLDERS (after the final-through month): nothing is carried from them');
  const july = reports.getSection(null, { q, now: Date.UTC(2026, 8, 7), query: { tab: 'qbsales', month: '2026-07' } }).qbsales;
  assert.deepEqual(july.placeholder, { docNums: ['1186'], txnDate: null }, 'a placeholder is named, the month stays live');
  assert.equal(july.thisMonthPosted, null);
  assert.equal(july.frozen, null);
  assert.deepEqual(july.postedReconciliations.map((r) => r.docNums[0]), ['1185'], 'July (unposted) carries June, the most recent final month');
  assert.equal(reports.QB_POSTED_FINAL_THROUGH, '2026-06', 'final through June (operator 2026-09-07)');
});

test('a FINAL posted month is shown AS POSTED and never recomputed; its settlement basis is kept aside for the carry-forward (operator 2026-09-07)', () => {
  const posted = [
    { doc_num: '1183', memo: 'Sales Income with VAT (+) April 2026', debit_pence: 0, credit_pence: 12070088, txn_date: '2026-04-30' },
    { doc_num: '1183', memo: 'In-Restaurant Card Payments (-) April 2026', debit_pence: 15031103, credit_pence: 0, txn_date: '2026-04-30' },
    { doc_num: '1183', memo: 'Card Payment Fees (POS) (-) April 2026', debit_pence: 0, credit_pence: 0, txn_date: '2026-04-30' },
    { doc_num: '1183', memo: 'Over/Short (- / +) April 2026', debit_pence: 0, credit_pence: 8445, txn_date: '2026-04-30' },
  ];
  const q = (sql, params) => {
    if (/qb_journal_lines/.test(sql)) return { ok: true, rows: params[0] === '2026-04' ? posted : [] };
    return { ok: true, rows: [] };
  };
  const june = reports.getSection(null, { q, now: Date.UTC(2026, 8, 7), query: { tab: 'qbsales', month: '2026-04' } }).qbsales;
  assert.deepEqual(june.frozen && june.frozen.docNums, ['1183']);
  assert.equal(june.frozen.txnDate, '2026-04-30');
  assert.equal(byKey(june, 'in_house_sales').amountPence, 14484106, 'the posted 20% line, gross (net × 6/5)');
  assert.equal(byKey(june, 'card_payments').amountPence, -15031103, 'as posted');
  assert.equal(byKey(june, 'over_short').amountPence, 8445, 'the posted plug is shown, not zeroed');
  assert.equal(byKey(june, 'gift_sold').amountPence, 0, 'a line not on the posted receipt shows 0, not a recomputation');
  assert.match(byKey(june, 'in_house_sales').derivation, /As posted in QuickBooks \(Sales Receipt #1183, dated 2026-04-30\)/);
  assert.equal(june.complete, true, 'a posted month is closed');
  assert.deepEqual(june.incompleteReasons, []);
  assert.ok(Array.isArray(june.settlementRows) && june.settlementRows.length === 12, 'the settlement basis is kept aside for the carry-forward');
  assert.deepEqual(june.carryNeeds, ['POS card fees', 'Online card fees', 'Online refunds'], 'what the carry-forward still needs is named (no data in this fake)');
  assert.deepEqual(june.postedReconciliations, [], 'a posted month carries nothing itself');
  const may = reports.getSection(null, { q, now: Date.UTC(2026, 8, 7), query: { tab: 'qbsales', month: '2026-05' } }).qbsales;
  assert.equal(may.frozen, null, 'an unposted month stays live');
  assert.deepEqual(may.postedReconciliations.map((r) => r.docNums[0]), ['1183'], 'and carries the final month before it');
});

test('a settlement row the posting lacks (gift-card lines after the cut-in) is carried as a correction with posted 0 — so the set nets to zero', () => {
  const { reconcilePostedReceipt } = reports;
  const prior = calculateQuickBooksSales(mayFixture());          // May 2026: gift rows are live (sold 7000, redeemed 2725)
  const gross = (key) => byKey(prior, key).amountPence;
  // David's posting of that month WITHOUT gift lines, balanced with an Over/Short plug
  const noGift = [
    ['Sales Income with VAT (+) May 2026', gross('in_house_sales'), true],
    ['In-Restaurant Card Payments (-) May 2026', gross('card_payments'), false],
    ['Tips Payable (+) May 2026', gross('tips_payable'), false],
    ['Cash Payments (-) May 2026', gross('cash_payments'), false],
    ['Card Payment Fees (POS) (-) May 2026', gross('pos_fee'), false],
    ['Online Sales Income with VAT (+) May 2026', gross('online_twenty_sales'), true],
    ['Online Sales Income 0% VAT (+) May 2026', gross('online_zero_sales'), false],
    ['Online Card Payments (-) May 2026', gross('online_card_payments'), false],
    ['Card Payment Fees (Online) (-) May 2026', gross('online_fee'), false],
  ];
  const plug = -noGift.reduce((sum, [, g]) => sum + g, 0);        // = −(gift sold − gift redeemed) = −4275
  noGift.push(['Over/Short (- / +) May 2026', plug, false]);
  const posted = noGift.map(([memo, g, vat]) => ({ doc_num: '1184', memo, debit_pence: g < 0 ? -g : 0, credit_pence: g > 0 ? (vat ? Math.round(g * 5 / 6) : g) : 0 }));
  const r = reconcilePostedReceipt(posted, prior, { moneyBasis: false });
  const adj = Object.fromEntries(r.lines.map((l) => [l.key, l.adjustmentPence]));
  assert.equal(adj.gift_sold, 7000, 'gift cards sold: settlement 7000, posted nothing');
  assert.equal(adj.gift_redeemed, -2725, 'gift redemptions: settlement −2725, posted nothing');
  assert.equal(adj.over_short, -4275, 'the plug reverses: posted +4275, settlement 0');
  assert.equal(r.balanced, true, 'with the unposted rows included the corrections net to zero');
  assert.equal(r.lines.filter((l) => l.key === 'gift_sold')[0].postedPence, 0);
});

test('a correction line posted on a later receipt (its description names another month) is carried, not counted as that month\'s own figure — so the next month compares the month\'s own lines only', () => {
  const { reconcilePostedReceipt } = reports;
  const prior = calculateQuickBooksSales(mayFixture());
  const gross = (key) => byKey(prior, key).amountPence;
  const own = [
    ['Sales Income with VAT (+) May 2026', gross('in_house_sales'), true],
    ['In-Restaurant Card Payments (-) May 2026', gross('card_payments'), false],
    ['Tips Payable (+) May 2026', gross('tips_payable'), false],
    ['Cash Payments (-) May 2026', gross('cash_payments'), false],
    ['Card Payment Fees (POS) (-) May 2026', gross('pos_fee'), false],
    ['Online Sales Income with VAT (+) May 2026', gross('online_twenty_sales'), true],
    ['Online Sales Income 0% VAT (+) May 2026', gross('online_zero_sales'), false],
    ['Online Card Payments (-) May 2026', gross('online_card_payments'), false],
    ['Card Payment Fees (Online) (-) May 2026', gross('online_fee'), false],
    ['Gift cards sold (liability +)', gross('gift_sold'), false],
    ['Gift card redemptions (liability −)', gross('gift_redeemed'), false],
    // the April corrections David added to the May receipt
    ['Sales Income with VAT (+) April 2026', -43872, true],
    ['In-Restaurant Card Payments (-) April 2026', 55524, false],
    ['Tips Payable (+) April 2026', -13037, false],
  ];
  const posted = own.map(([memo, g, vat]) => ({ doc_num: '1184', memo, debit_pence: g < 0 ? (vat ? Math.round(-g * 5 / 6) : -g) : 0, credit_pence: g > 0 ? (vat ? Math.round(g * 5 / 6) : g) : 0 }));
  const r = reconcilePostedReceipt(posted, prior, { moneyBasis: false, month: '2026-05' });
  assert.equal(r.carried.count, 3, 'the three April lines are carried corrections');
  assert.deepEqual(r.carried.fromMonths, ['2026-04']);
  assert.equal(r.carried.netPence, -43872 + 55524 - 13037);
  assert.equal(r.nothingToCarry, true, "May's own lines equal the settlement basis, so June carries nothing");
  assert.equal(r.lines.find((l) => l.key === 'in_house_sales').postedPence, gross('in_house_sales'), 'the carried line did not leak into the month\'s own figure');
  const without = reconcilePostedReceipt(posted, prior, { moneyBasis: false });
  assert.equal(without.carried.count, 0, 'without the month there is nothing to classify against');
});

test('an unposted month carries only the MOST RECENT final month — the one before it was absorbed by that posting (June carries May, not April again)', () => {
  const journal = {
    '2026-04': [{ doc_num: '1183', memo: 'Tips Payable (+) April 2026', debit_pence: 0, credit_pence: 837962, txn_date: '2026-04-30' }],
    '2026-05': [{ doc_num: '1184', memo: 'Tips Payable (+) May 2026', debit_pence: 0, credit_pence: 944284, txn_date: '2026-05-31' }, { doc_num: '1184', memo: 'Tips Payable (+) April 2026', debit_pence: 13037, credit_pence: 0, txn_date: '2026-05-31' }],
  };
  const q = (sql, params) => (/qb_journal_lines/.test(sql) ? { ok: true, rows: journal[params[0]] || [] } : { ok: true, rows: [] });
  const june = reports.getSection(null, { q, now: Date.UTC(2026, 8, 7), query: { tab: 'qbsales', month: '2026-06' } }).qbsales;
  assert.deepEqual(june.postedReconciliations.map((r) => r.docNums[0]), ['1184'], 'May only');
  const may = reports.getSection(null, { q, now: Date.UTC(2026, 8, 7), query: { tab: 'qbsales', month: '2026-05' } }).qbsales;
  assert.deepEqual(may.frozen && may.frozen.docNums, ['1184']);
  assert.equal(may.frozen.carried.count, 1, "the April line on May's receipt is recognised as carried");
});

test("a line naming an earlier month WITHOUT a same-product sibling is the month's own line with a stale description (June's '… (+) May 2026' typo), not a carried correction", () => {
  const { reconcilePostedReceipt } = reports;
  const prior = calculateQuickBooksSales(mayFixture());
  const gross = (key) => byKey(prior, key).amountPence;
  const posted = [
    { doc_num: '1185', memo: 'Online Sales Income with June (+) April 2026', debit_pence: 0, credit_pence: Math.round(gross('online_twenty_sales') * 5 / 6) },
    { doc_num: '1185', memo: 'Tips Payable (+) May 2026', debit_pence: 0, credit_pence: gross('tips_payable') },
    { doc_num: '1185', memo: 'Tips Payable (+) April 2026', debit_pence: 13037, credit_pence: 0 },
  ];
  const r = reconcilePostedReceipt(posted, prior, { moneyBasis: false, month: '2026-05' });
  assert.equal(r.carried.count, 1, 'only the tips line with a sibling is carried');
  assert.deepEqual(r.staleDescriptions, ['Online Sales Income with June (+) April 2026']);
  assert.equal(r.lines.find((l) => l.key === 'online_twenty_sales').postedPence, gross('online_twenty_sales'), "the stale-described line counts as the month's own");
});
