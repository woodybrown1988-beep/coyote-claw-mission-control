'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');

const DATA = require('../mission-control/ui/data.js');
const reports = require('../mission-control/ui/pages/coyote/reports.js');
const { applyQuickBooksSalesFee } = require('../mission-control/server.js');

const {
  calculateQuickBooksSales,
  formatQuickBooksOperand,
  latestCompleteMonth,
} = reports;

const ADJUSTMENT_LABELS = {
  refund_pos_card: 'Refunds not on POS — via card',
  refund_pos_cash: 'Refunds not on POS — via cash',
  refund_online_card: 'Refunds not on Online',
  free_gift_cards: 'Free gift cards issued',
};

function allAdjustmentValues(value) {
  return Object.fromEntries(Object.keys(ADJUSTMENT_LABELS).map((key) => [key, value]));
}

function completeAprilFixture() {
  const fixture = aprilFixture();
  fixture.salesDates.push('2026-04-12');
  fixture.receipts = fixture.receipts.filter((row) => row.receipt_id !== 'unmapped');
  fixture.fees = { pos_fee: 0, online_fee: 0 };
  return fixture;
}

function rowByLine(result, line) {
  return result.rows.find((row) => row.line === line);
}

function adjustmentByKey(result, key) {
  return result.adjustments.find((adjustment) => adjustment.key === key);
}

function aprilFixture() {
  const salesDates = [];
  for (let day = 1; day <= 30; day++) {
    if (day !== 12) salesDates.push(`2026-04-${String(day).padStart(2, '0')}`);
  }
  return {
    month: '2026-04',
    salesDates,
    accountingGroups: [{ code: '29', name: 'SHAKES' }],
    receipts: [
      { receipt_id: 'eat', business_date: '2026-04-02', type: 'SALE', cancelled: 0, channel_label: 'EAT IN', net_with_tax_pence: 12000 },
      { receipt_id: 'split', business_date: '2026-04-03', type: 'SPLIT', cancelled: 0, channel_label: 'STOREKIT ORDER & PAY', net_with_tax_pence: 3600 },
      { receipt_id: 'cancelled', business_date: '2026-04-04', type: 'SALE', cancelled: 1, channel_label: 'MON-FRI DEAL', net_with_tax_pence: 9999 },
      { receipt_id: 'void', business_date: '2026-04-05', type: 'VOID', cancelled: 0, channel_label: 'EAT IN', net_with_tax_pence: 9999 },
      { receipt_id: 'online', business_date: '2026-04-06', type: 'SALE', cancelled: 0, channel_label: 'ONLINE ORDER', net_with_tax_pence: 7800 },
      { receipt_id: 'unmapped', business_date: '2026-04-07', type: 'SALE', cancelled: 0, channel_label: null, net_with_tax_pence: 2400 },
    ],
    lines: [
      { receipt_id: 'online', line_id: 'meal', parent_line_id: null, business_date: '2026-04-06', accounting_group: '10', net_with_tax_pence: 6000 },
      { receipt_id: 'online', line_id: 'shake', parent_line_id: null, business_date: '2026-04-06', accounting_group: '29', net_with_tax_pence: 1200 },
      { receipt_id: 'online', line_id: 'option', parent_line_id: 'shake', business_date: '2026-04-06', accounting_group: null, net_with_tax_pence: 600 },
    ],
    payments: [
      { receipt_id: 'eat', payment_seq: 0, business_date: '2026-04-02', code: 'LSPAY_ADYEN_TERMINAL_API_LOCAL', net_with_tax_pence: 10000, tip_pence: 500 },
      { receipt_id: 'split', payment_seq: 0, business_date: '2026-04-03', code: 'STR', net_with_tax_pence: 2000, tip_pence: 100 },
      { receipt_id: 'split', payment_seq: 1, business_date: '2026-04-03', code: 'CASH', net_with_tax_pence: 3000, tip_pence: 200 },
      { receipt_id: 'online', payment_seq: 0, business_date: '2026-04-06', code: 'LP', net_with_tax_pence: 7000, tip_pence: 800 },
    ],
    fees: {},
  };
}

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

test('calculation includes SPLIT, shake children and tips, while exact residual balances all ten rows', () => {
  const fixture = aprilFixture();
  fixture.receipts.push({ ...fixture.receipts[1] });
  fixture.lines.push({ ...fixture.lines[1] }, { ...fixture.lines[2] });
  fixture.payments.push({ ...fixture.payments[0] });
  const result = calculateQuickBooksSales(fixture);

  assert.deepEqual(result.rows.map((row) => row.amountPence), [
    15600, -12600, 600, -3200, null, 6000, 1800, -7800, null, -400,
  ]);
  assert.equal(result.rows[0].includedCount, 2, 'SALE and SPLIT receipt identifiers are deduplicated');
  assert.equal(result.rows[5].includedCount, 1, 'only the non-shake online line remains in row 6');
  assert.equal(result.rows[6].includedCount, 2, 'shake root and its direct child option enter row 7');
  assert.equal(result.rows[1].amountPence, -(10000 + 500 + 2000 + 100), 'card payments add tips to net-with-tax');
  assert.equal(result.rows[3].amountPence, -(3000 + 200), 'cash adds tips to net-with-tax');
  assert.equal(result.balancePence, 0);
  assert.equal(result.rows.reduce((sum, row) => sum + (row.amountPence == null ? 0 : row.amountPence), 0), 0);
  assert.equal(result.vatBasePence, 18000);
  assert.equal(result.vatBaseExact, true);
});

test('QuickBooks operand formatting preserves the signed pence value and rejects non-integer fallbacks', () => {
  assert.equal(formatQuickBooksOperand(-123), '−£1.23');
  assert.equal(formatQuickBooksOperand(0), '£0.00');
  assert.equal(formatQuickBooksOperand(123), '+£1.23');
  assert.equal(formatQuickBooksOperand(Number.MAX_SAFE_INTEGER), '+£90,071,992,547,409.91');
  assert.equal(formatQuickBooksOperand(Number.MIN_SAFE_INTEGER), '−£90,071,992,547,409.91');
  assert.equal(formatQuickBooksOperand(null), '—');
  assert.equal(formatQuickBooksOperand(1.5), '—');
});

test('each refund moves Sales Income by x and its designated tender by computed −x without moving Over/Short', () => {
  const cases = [
    { key: 'refund_pos_card', salesLine: 1, tenderLine: 2, value: -1234 },
    { key: 'refund_pos_cash', salesLine: 1, tenderLine: 4, value: -567 },
    { key: 'refund_online_card', salesLine: 6, tenderLine: 8, value: -890 },
  ];

  for (const scenario of cases) {
    const baselineFixture = completeAprilFixture();
    baselineFixture.fees = { ...baselineFixture.fees, ...allAdjustmentValues(0) };
    const baseline = calculateQuickBooksSales(baselineFixture);
    const adjustedFixture = completeAprilFixture();
    adjustedFixture.fees = { ...adjustedFixture.fees, ...allAdjustmentValues(0), [scenario.key]: scenario.value };
    const adjusted = calculateQuickBooksSales(adjustedFixture);
    const salesMovement = rowByLine(adjusted, scenario.salesLine).amountPence - rowByLine(baseline, scenario.salesLine).amountPence;
    const tenderMovement = rowByLine(adjusted, scenario.tenderLine).amountPence - rowByLine(baseline, scenario.tenderLine).amountPence;

    assert.equal(salesMovement, scenario.value, `${scenario.key} uses x on Sales Income`);
    assert.equal(tenderMovement, -scenario.value, `${scenario.key} computes −x for its tender`);
    assert.equal(salesMovement + tenderMovement, 0, `${scenario.key} movements are equal and opposite`);
    assert.equal(rowByLine(adjusted, 10).amountPence, rowByLine(baseline, 10).amountPence,
      `${scenario.key} cannot be implemented as a Sales-Income-only movement`);
    assert.equal(adjustmentByKey(adjusted, scenario.key).salesOperandPence, scenario.value);
    assert.equal(adjustmentByKey(adjusted, scenario.key).counterpartOperandPence, -scenario.value);
  }
});

test('free gift cards reduce Sales Income and reach Over/Short only through the residual formula', () => {
  const baselineFixture = completeAprilFixture();
  baselineFixture.fees = { ...baselineFixture.fees, ...allAdjustmentValues(0) };
  const baseline = calculateQuickBooksSales(baselineFixture);
  const adjustedFixture = completeAprilFixture();
  adjustedFixture.fees = { ...adjustedFixture.fees, ...allAdjustmentValues(0), free_gift_cards: -975 };
  const adjusted = calculateQuickBooksSales(adjustedFixture);
  const freeGift = adjustmentByKey(adjusted, 'free_gift_cards');

  assert.equal(rowByLine(adjusted, 1).amountPence - rowByLine(baseline, 1).amountPence, -975);
  for (const tenderLine of [2, 4, 8]) {
    assert.equal(rowByLine(adjusted, tenderLine).amountPence, rowByLine(baseline, tenderLine).amountPence);
  }
  assert.equal(freeGift.counterpartLine, null);
  assert.equal(freeGift.counterpartOperandPence, null);
  assert.equal(freeGift.overShortEffectPence, 975);
  assert.equal(rowByLine(adjusted, 10).amountPence - rowByLine(baseline, 10).amountPence, 975);
  assert.match(rowByLine(adjusted, 10).derivation, /Exact negative of every other receipt row/);
});

test('all adjustment entry states retain ten rows and an exact zero receipt total', () => {
  const fixtures = [
    completeAprilFixture(),
    completeAprilFixture(),
    completeAprilFixture(),
  ];
  fixtures[1].fees = { ...fixtures[1].fees, ...allAdjustmentValues(0) };
  fixtures[2].fees = {
    ...fixtures[2].fees,
    refund_pos_card: -101,
    refund_pos_cash: -202,
    refund_online_card: -303,
    free_gift_cards: -404,
  };

  for (const fixture of fixtures) {
    const result = calculateQuickBooksSales(fixture);
    assert.equal(result.rows.length, 10);
    assert.equal(result.balancePence, 0);
    assert.equal(result.rows.reduce((sum, row) => sum + (row.amountPence == null ? 0 : row.amountPence), 0), 0);
  }
});

test('unentered adjustments render em dashes, name every missing field and differ from explicit zero', () => {
  const missing = calculateQuickBooksSales(completeAprilFixture());
  assert.equal(missing.complete, false, 'the four missing inputs alone keep the receipt incomplete');
  assert.deepEqual(missing.adjustmentMissing, Object.values(ADJUSTMENT_LABELS));
  for (const [key, label] of Object.entries(ADJUSTMENT_LABELS)) {
    assert.deepEqual(adjustmentByKey(missing, key), {
      key,
      label,
      salesLine: key === 'refund_online_card' ? 6 : 1,
      counterpartLine: key === 'refund_pos_card' ? 2 : key === 'refund_pos_cash' ? 4 : key === 'refund_online_card' ? 8 : null,
      counterpartLabel: key === 'refund_pos_card' ? 'Card payments' : key === 'refund_pos_cash' ? 'Cash payments' : key === 'refund_online_card' ? 'Online card payments' : null,
      amountPence: null,
      entered: false,
      salesOperandPence: null,
      counterpartOperandPence: null,
      overShortEffectPence: null,
    });
  }

  const missingBody = reports.render({ tab: 'qbsales', qbsales: missing }, {}).body;
  assert.match(missingBody, />INCOMPLETE</);
  const warning = missingBody.slice(missingBody.indexOf('class="qb-warnings"'), missingBody.indexOf('<div style="overflow:auto"'));
  for (const [key, label] of Object.entries(ADJUSTMENT_LABELS)) {
    assert.ok(warning.includes(label), `${key} is named in the missing-input warning`);
    assert.match(missingBody, new RegExp(`data-qb-adjustment="${key}"[\\s\\S]{0,300}<span class="qb-adjustment-value">—</span>`));
  }

  const zeroFixture = completeAprilFixture();
  zeroFixture.fees = { ...zeroFixture.fees, ...allAdjustmentValues(0) };
  const zero = calculateQuickBooksSales(zeroFixture);
  assert.equal(zero.complete, true);
  assert.deepEqual(zero.adjustmentMissing, []);
  const zeroBody = reports.render({ tab: 'qbsales', qbsales: zero }, {}).body;
  assert.match(zeroBody, />COMPLETE</);
  for (const key of Object.keys(ADJUSTMENT_LABELS)) {
    const adjustment = adjustmentByKey(zero, key);
    assert.equal(adjustment.entered, true);
    assert.equal(adjustment.amountPence, 0);
    assert.match(zeroBody, new RegExp(`data-qb-adjustment="${key}"[\\s\\S]{0,300}<span class="qb-adjustment-value">£0\\.00</span>`));
  }
});

test('displayed adjustment derivations use the exact formatted arithmetic operands', () => {
  const fixture = completeAprilFixture();
  fixture.fees = {
    ...fixture.fees,
    refund_pos_card: -123,
    refund_pos_cash: -234,
    refund_online_card: -345,
    free_gift_cards: -456,
  };
  const result = calculateQuickBooksSales(fixture);
  const body = reports.render({ tab: 'qbsales', qbsales: result }, {}).body;

  for (const adjustment of result.adjustments) {
    const salesText = formatQuickBooksOperand(adjustment.salesOperandPence);
    const salesRow = rowByLine(result, adjustment.salesLine);
    assert.ok(salesRow.derivation.includes(salesText));
    const renderedSalesRow = body.match(new RegExp(`<tr data-qb-line="${adjustment.salesLine}">[\\s\\S]*?<\\/tr>`))[0];
    assert.ok(renderedSalesRow.includes(salesText));
    if (adjustment.counterpartLine != null) {
      const counterpartText = formatQuickBooksOperand(adjustment.counterpartOperandPence);
      assert.ok(rowByLine(result, adjustment.counterpartLine).derivation.includes(counterpartText));
      const renderedTenderRow = body.match(new RegExp(`<tr data-qb-line="${adjustment.counterpartLine}">[\\s\\S]*?<\\/tr>`))[0];
      assert.ok(renderedTenderRow.includes(counterpartText));
    } else {
      assert.ok(salesRow.derivation.includes(formatQuickBooksOperand(adjustment.overShortEffectPence)));
    }
  }
  assert.match(body, /no honest tender counterpart/i);
  assert.match(body, /No card, cash, gift-card-liability or invented balancing line is used/);
});

test('Lightspeed Comps never populate or determine free gift cards', () => {
  const fixture = completeAprilFixture();
  fixture.comps = 222825;
  fixture.lightspeed = { comps: 222825 };
  const missing = calculateQuickBooksSales(fixture);
  assert.equal(adjustmentByKey(missing, 'free_gift_cards').amountPence, null);
  assert.equal(adjustmentByKey(missing, 'free_gift_cards').entered, false);
  const body = reports.render({ tab: 'qbsales', qbsales: missing }, {}).body;
  assert.doesNotMatch(body, /£2,228\.25/);

  fixture.fees.free_gift_cards = -500;
  const entered = calculateQuickBooksSales(fixture);
  assert.equal(adjustmentByKey(entered, 'free_gift_cards').amountPence, -500);
  assert.notEqual(adjustmentByKey(entered, 'free_gift_cards').amountPence, fixture.comps);
  assert.notEqual(adjustmentByKey(entered, 'free_gift_cards').amountPence, -fixture.comps);
});

test('unentered adjustments leave April card payments and tips unchanged', () => {
  const fixture = completeAprilFixture();
  fixture.payments = [
    { receipt_id: 'april-card', payment_seq: 0, business_date: '2026-04-02', code: 'LSPAY_ADYEN_TERMINAL_API_LOCAL', net_with_tax_pence: 13795928, tip_pence: 824925 },
  ];
  const unentered = calculateQuickBooksSales(fixture);
  assert.equal(rowByLine(unentered, 2).amountPence, -14620853);
  assert.equal(rowByLine(unentered, 3).amountPence, 824925);

  const zeroFixture = { ...fixture, fees: { ...fixture.fees, ...allAdjustmentValues(0) } };
  const explicitZero = calculateQuickBooksSales(zeroFixture);
  assert.deepEqual(explicitZero.rows.map((row) => row.amountPence), unentered.rows.map((row) => row.amountPence));
});

test('POSERROR payments contribute their gross and tips to card settlement and Tips payable', () => {
  const fixture = aprilFixture();
  fixture.payments.push({
    receipt_id: 'pos-error', payment_seq: 0, business_date: '2026-04-08', code: 'POSERROR',
    net_with_tax_pence: 400, tip_pence: 50,
  });
  const result = calculateQuickBooksSales(fixture);

  assert.equal(result.rows[1].amountPence, -13050, 'row 2 includes the POSERROR gross payment and tip');
  assert.equal(result.rows[2].amountPence, 650, 'row 3 includes the POSERROR tip');
  assert.match(result.rows[1].derivation, /POSERROR/, 'the generated row-2 derivation lists the payment code');
  const body = reports.render({ tab: 'qbsales', qbsales: result }, {}).body;
  const renderedRow2 = body.match(/<tr data-qb-line="2">[\s\S]*?<\/tr>/);
  assert.ok(renderedRow2);
  assert.match(renderedRow2[0], /POSERROR/, 'the on-page row-2 derivation visibly lists the payment code');
});

test('persisted POS fee nets row 2 while row 5 remains the unchanged negative fee', () => {
  const fixture = aprilFixture();
  fixture.fees = { pos_fee: -300 };
  const result = calculateQuickBooksSales(fixture);

  assert.equal(result.rows[1].amountPence, -12300, '£126.00 gross less £3.00 fee is a £123.00 card settlement');
  assert.equal(result.rows[4].amountPence, -300);
  assert.match(result.rows[1].derivation, /gross card takings \+£126\.00 \+ POS processor fee −£3\.00 = settlement \+£123\.00, giving row operand −£123\.00/i);

  fixture.fees.pos_fee = 0;
  const zeroFee = calculateQuickBooksSales(fixture);
  assert.equal(zeroFee.rows[1].amountPence, -12600, 'a persisted zero is still an entered fee');
  assert.match(zeroFee.rows[1].derivation, /POS processor fee £0\.00 = settlement \+£126\.00, giving row operand −£126\.00/i);
});

test('missing POS fee leaves row 2 gross and never describes it as net', () => {
  const result = calculateQuickBooksSales(aprilFixture());

  assert.equal(result.rows[1].amountPence, -12600);
  assert.match(result.rows[1].derivation, /gross card takings \+£126\.00 — no processor fee entered for this month, giving row operand −£126\.00/i);
  assert.doesNotMatch(result.rows[1].derivation, /\bnet\b/i);
});

test('persisted online fee nets row 8 while row 9 remains the unchanged negative fee', () => {
  const fixture = aprilFixture();
  fixture.fees = { online_fee: -100 };
  const result = calculateQuickBooksSales(fixture);

  assert.equal(result.rows[7].amountPence, -7700, '£78.00 gross less £1.00 fee is a £77.00 LP settlement');
  assert.equal(result.rows[8].amountPence, -100);
  assert.match(result.rows[7].derivation, /gross LP takings \+£78\.00 \+ online processor fee −£1\.00 = settlement \+£77\.00, giving row operand −£77\.00/i);

  fixture.fees.online_fee = 0;
  const zeroFee = calculateQuickBooksSales(fixture);
  assert.equal(zeroFee.rows[7].amountPence, -7800, 'a persisted zero is still an entered fee');
  assert.match(zeroFee.rows[7].derivation, /online processor fee £0\.00 = settlement \+£78\.00, giving row operand −£78\.00/i);
});

test('missing online fee leaves row 8 gross and row 9 explicitly unentered', () => {
  const result = calculateQuickBooksSales(aprilFixture());

  assert.equal(result.rows[7].amountPence, -7800);
  assert.equal(result.rows[8].amountPence, null);
  assert.equal(result.rows[8].entered, false);
  assert.match(result.rows[7].derivation, /gross LP takings \+£78\.00 — no processor fee entered for this month, giving row operand −£78\.00/i);
  assert.doesNotMatch(result.rows[7].derivation, /\bnet\b/i);
});

test('fee presence does not close genuine residuals; Over/Short balances all ten rows and cash is unchanged', () => {
  const missingFees = calculateQuickBooksSales(aprilFixture());
  const persistedFixture = aprilFixture();
  persistedFixture.fees = { pos_fee: -300, online_fee: -100 };
  const persistedFees = calculateQuickBooksSales(persistedFixture);

  for (const result of [missingFees, persistedFees]) {
    assert.equal(result.rows.length, 10);
    assert.equal(result.rows[3].amountPence, -3200, 'cash classification and calculation stay unchanged');
    assert.equal(result.rows[9].amountPence, -400, 'the genuine fixture residual remains formula-driven');
    assert.equal(result.rows.reduce((sum, row) => sum + (row.amountPence == null ? 0 : row.amountPence), 0), 0);
  }
});

test('missing date and unmapped receipt stay visible, and absent fees stay explicitly unentered', () => {
  const result = calculateQuickBooksSales(aprilFixture());
  assert.deepEqual(result.missingDates, ['2026-04-12']);
  assert.deepEqual(result.unmapped, { count: 1, valuePence: 2400 });
  assert.equal(result.rows[4].amountPence, null);
  assert.equal(result.rows[8].amountPence, null);
  assert.equal(result.rows[4].entered, false);
  assert.equal(result.rows[8].entered, false);
  assert.equal(result.complete, false);

  const body = reports.render({ tab: 'qbsales', qbsales: result }, {}).body;
  assert.match(body, /2026-04-12/);
  assert.match(body, /Unmapped receipts diagnostic/);
  assert.match(body, /1 receipt[^<]*£24\.00/);
  assert.match(body, /Operator input required — from the card processor statement; not held on this box\./);
  assert.match(body, /settlement row remains gross because no processor fee was entered for this month/);
  assert.doesNotMatch(body, /unentered fee is treated as zero|residual currently absorbs the missing fee/);
  assert.match(body, /April 2026/);
});

test('sales-entry persistence validates month, line and signed integer pence and preserves zero as entered', () => {
  const db = new sqlite.DatabaseSync(':memory:');
  for (const body of [
    { op: 'set_qb_sales_fee', month: '2026-4', line: 'pos_fee', value_pence: -100 },
    { op: 'set_qb_sales_fee', month: '2026-13', line: 'pos_fee', value_pence: -100 },
    { op: 'set_qb_sales_fee', month: '2026-04', line: 'row_1', value_pence: -100 },
    { op: 'set_qb_sales_fee', month: '2026-04', line: 'online_fee', value_pence: -1.5 },
    { op: 'set_qb_sales_fee', month: '2026-04', line: 'online_fee', value_pence: '-100' },
    { op: 'set_qb_sales_fee', month: '2026-04', line: 'pos_fee', value_pence: -100, arbitrary_key: true },
    { op: 'arbitrary', month: '2026-04', line: 'pos_fee', value_pence: -100 },
  ]) {
    const refused = applyQuickBooksSalesFee(db, body, 123);
    assert.equal(refused.ok, false);
    assert.equal(refused.status, 400);
  }

  const zero = applyQuickBooksSalesFee(db, {
    op: 'set_qb_sales_fee', month: '2026-04', line: 'pos_fee', value_pence: 0,
  }, 124);
  const online = applyQuickBooksSalesFee(db, {
    op: 'set_qb_sales_fee', month: '2026-04', line: 'online_fee', value_pence: -100,
  }, 125);
  const adjustmentValues = {
    refund_pos_card: -201,
    refund_pos_cash: 0,
    refund_online_card: -303,
    free_gift_cards: -404,
  };
  let now = 126;
  for (const [line, value_pence] of Object.entries(adjustmentValues)) {
    const stored = applyQuickBooksSalesFee(db, {
      op: 'set_qb_sales_fee', month: '2026-04', line, value_pence,
    }, now++);
    assert.deepEqual(stored, { ok: true, status: 200, op: 'set_qb_sales_fee', month: '2026-04', line, value_pence });
  }
  assert.deepEqual(zero, { ok: true, status: 200, op: 'set_qb_sales_fee', month: '2026-04', line: 'pos_fee', value_pence: 0 });
  assert.equal(online.value_pence, -100);
  assert.deepEqual(db.prepare('SELECT month, line, value_pence FROM qb_sales_fees ORDER BY line').all().map((row) => ({ ...row })), [
    { month: '2026-04', line: 'free_gift_cards', value_pence: -404 },
    { month: '2026-04', line: 'online_fee', value_pence: -100 },
    { month: '2026-04', line: 'pos_fee', value_pence: 0 },
    { month: '2026-04', line: 'refund_online_card', value_pence: -303 },
    { month: '2026-04', line: 'refund_pos_card', value_pence: -201 },
    { month: '2026-04', line: 'refund_pos_cash', value_pence: 0 },
  ]);
  const schema = db.prepare("SELECT sql FROM sqlite_master WHERE name='qb_sales_fees'").get().sql;
  for (const line of Object.keys(ADJUSTMENT_LABELS)) assert.ok(schema.includes(`'${line}'`));
  db.close();
});

test('every adjustment rejects positive pence server-side with a field-specific sign error', () => {
  const db = new sqlite.DatabaseSync(':memory:');
  for (const line of Object.keys(ADJUSTMENT_LABELS)) {
    const result = applyQuickBooksSalesFee(db, {
      op: 'set_qb_sales_fee', month: '2026-04', line, value_pence: 1,
    }, 123);
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    assert.match(result.error, new RegExp(line));
    assert.match(result.error, /zero or a negative amount/i);
  }
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='qb_sales_fees'").get(), undefined,
    'validation happens before persistence');
  db.close();
});

test('the existing two-fee CHECK constraint is widened in place without losing values', () => {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(`CREATE TABLE qb_sales_fees (
    month TEXT NOT NULL,
    line TEXT NOT NULL CHECK (line IN ('pos_fee','online_fee')),
    value_pence INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (month, line)
  )`);
  db.prepare(`INSERT INTO qb_sales_fees VALUES ('2026-04','pos_fee',-321,100)`).run();

  const result = applyQuickBooksSalesFee(db, {
    op: 'set_qb_sales_fee', month: '2026-04', line: 'refund_pos_card', value_pence: -123,
  }, 200);
  assert.equal(result.ok, true);
  assert.deepEqual(db.prepare('SELECT line, value_pence FROM qb_sales_fees ORDER BY line').all().map((row) => ({ ...row })), [
    { line: 'pos_fee', value_pence: -321 },
    { line: 'refund_pos_card', value_pence: -123 },
  ]);
  const schema = db.prepare("SELECT sql FROM sqlite_master WHERE name='qb_sales_fees'").get().sql;
  for (const line of Object.keys(ADJUSTMENT_LABELS)) assert.ok(schema.includes(`'${line}'`));
  db.close();
});

test('entered processor fees are used verbatim and VAT imprecision is warned without changing rows', () => {
  const fixture = aprilFixture();
  fixture.fees = { pos_fee: -300, online_fee: -100 };
  let result = calculateQuickBooksSales(fixture);
  assert.equal(result.rows[4].amountPence, -300);
  assert.equal(result.rows[4].entered, true);
  assert.equal(result.rows[8].amountPence, -100);
  assert.equal(result.rows[9].amountPence, -400, 'persisted fees do not erase the genuine residual');

  fixture.receipts[0].net_with_tax_pence += 1;
  result = calculateQuickBooksSales(fixture);
  assert.equal(result.vatBaseExact, false);
  assert.equal(result.rows[0].amountPence, 15601, 'VAT diagnostic never rewrites a QuickBooks row');
  assert.equal(result.rows.reduce((sum, row) => sum + (row.amountPence == null ? 0 : row.amountPence), 0), 0);
});

test('page read seam reloads the exact persisted month/line fee values', () => {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE sales_day (business_date TEXT PRIMARY KEY);
    CREATE TABLE sales_api_ingest_runs (business_date TEXT, source TEXT, status TEXT);
    CREATE TABLE sales_receipts_api (receipt_id TEXT PRIMARY KEY, business_date TEXT, type TEXT,
      cancelled INTEGER, account_profile_code TEXT, net_with_tax_pence INTEGER);
    CREATE TABLE sales_channel_map_api (account_profile_code TEXT PRIMARY KEY, channel_label TEXT);
    CREATE TABLE sales_receipt_lines_api (receipt_id TEXT, line_id TEXT, parent_line_id TEXT,
      business_date TEXT, accounting_group TEXT, net_with_tax_pence INTEGER,
      PRIMARY KEY (receipt_id, line_id));
    CREATE TABLE sales_payments_api (receipt_id TEXT, payment_seq INTEGER, business_date TEXT,
      code TEXT, net_with_tax_pence INTEGER, tip_pence INTEGER,
      PRIMARY KEY (receipt_id, payment_seq));
    CREATE TABLE acct_groups_api (code TEXT PRIMARY KEY, name TEXT);
  `);
  db.prepare(`INSERT INTO sales_channel_map_api VALUES ('LOCAL','EAT IN')`).run();
  db.prepare(`INSERT INTO sales_receipts_api VALUES ('r1','2026-04-01','SPLIT',0,'LOCAL',12000)`).run();
  const ctx = {
    q: (sql, params) => DATA.safeSelect(db, sql, params),
    now: Date.UTC(2026, 4, 2),
    query: { tab: 'qbsales', month: '2026-04' },
  };
  const blank = reports.getSection(db, ctx).qbsales;
  assert.equal(blank.rows[4].entered, false);
  assert.equal(blank.rows[8].entered, false);
  for (const key of Object.keys(ADJUSTMENT_LABELS)) assert.equal(adjustmentByKey(blank, key).entered, false);

  applyQuickBooksSalesFee(db, { op: 'set_qb_sales_fee', month: '2026-04', line: 'pos_fee', value_pence: -321 }, 200);
  applyQuickBooksSalesFee(db, { op: 'set_qb_sales_fee', month: '2026-04', line: 'online_fee', value_pence: 0 }, 201);
  applyQuickBooksSalesFee(db, { op: 'set_qb_sales_fee', month: '2026-04', line: 'refund_pos_card', value_pence: -123 }, 202);
  applyQuickBooksSalesFee(db, { op: 'set_qb_sales_fee', month: '2026-04', line: 'refund_pos_cash', value_pence: 0 }, 203);
  applyQuickBooksSalesFee(db, { op: 'set_qb_sales_fee', month: '2026-04', line: 'refund_online_card', value_pence: -345 }, 204);
  applyQuickBooksSalesFee(db, { op: 'set_qb_sales_fee', month: '2026-04', line: 'free_gift_cards', value_pence: -456 }, 205);
  const reloaded = reports.getSection(db, ctx).qbsales;
  assert.equal(reloaded.rows[4].amountPence, -321);
  assert.equal(reloaded.rows[4].entered, true);
  assert.equal(reloaded.rows[8].amountPence, 0);
  assert.equal(reloaded.rows[8].entered, true, 'stored zero remains distinct from no row');
  assert.equal(adjustmentByKey(reloaded, 'refund_pos_card').amountPence, -123);
  assert.equal(adjustmentByKey(reloaded, 'refund_pos_cash').amountPence, 0);
  assert.equal(adjustmentByKey(reloaded, 'refund_pos_cash').entered, true, 'stored adjustment zero remains distinct from no row');
  assert.equal(adjustmentByKey(reloaded, 'refund_online_card').amountPence, -345);
  assert.equal(adjustmentByKey(reloaded, 'free_gift_cards').amountPence, -456);
  db.close();
});
