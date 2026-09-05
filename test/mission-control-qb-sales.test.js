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

  const complete = calculateQuickBooksSales(mayFixture());
  assert.deepEqual(complete.feeMissing, []);
  assert.equal(complete.complete, complete.vatBaseExact, 'with every input present, completeness is only the VAT-base penny check');
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

test('gift cards: loads are IKGIFT-negative on TRANSFER whatever paid for them; redemptions are IKGIFT-positive on non-cancelled SALE/SPLIT/RECALL', () => {
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
  assert.equal(byKey(result, 'gift_sold').amountPence, 8000, 'the free voucher load is still a card sold (liability), paid by a zero-money tender');
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
