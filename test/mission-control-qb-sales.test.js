'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');

const DATA = require('../mission-control/ui/data.js');
const reports = require('../mission-control/ui/pages/coyote/reports.js');
const { applyQuickBooksSalesFee } = require('../mission-control/server.js');

const {
  calculateQuickBooksSales,
  formatQuickBooksFeeDerivation,
  latestCompleteMonth,
} = reports;

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
  assert.match(result.rows[1].derivation, /gross card takings 12600 pence \+ signed POS processor fee -300 pence \(deducted\) = net 12300 pence/i);

  fixture.fees.pos_fee = 0;
  const zeroFee = calculateQuickBooksSales(fixture);
  assert.equal(zeroFee.rows[1].amountPence, -12600, 'a persisted zero is still an entered fee');
  assert.match(zeroFee.rows[1].derivation, /gross card takings 12600 pence \+ signed POS processor fee 0 pence = unchanged at 12600 pence/i);
  assert.doesNotMatch(zeroFee.rows[1].derivation, /deducted|\bnet\b/i);
});

test('historic positive POS and online fees render honestly as additions', () => {
  const fixture = aprilFixture();
  fixture.fees = { pos_fee: 300, online_fee: 100 };
  const result = calculateQuickBooksSales(fixture);

  assert.equal(result.rows[1].amountPence, -12900);
  assert.equal(result.rows[7].amountPence, -7900);
  assert.match(result.rows[1].derivation, /gross card takings 12600 pence \+ signed POS processor fee \+300 pence \(added\) = 12900 pence/i);
  assert.match(result.rows[7].derivation, /gross LP takings 7800 pence \+ signed online processor fee \+100 pence \(added\) = 7900 pence/i);
  assert.doesNotMatch(result.rows[1].derivation, /deducted|\bnet\b/i);
  assert.doesNotMatch(result.rows[7].derivation, /deducted|\bnet\b/i);

  const body = reports.render({ tab: 'qbsales', qbsales: result }, {}).body;
  const renderedRow2 = body.match(/<tr data-qb-line="2">[\s\S]*?<\/tr>/);
  const renderedRow8 = body.match(/<tr data-qb-line="8">[\s\S]*?<\/tr>/);
  assert.ok(renderedRow2 && renderedRow8);
  assert.match(renderedRow2[0], /signed POS processor fee \+300 pence \(added\) = 12900 pence/i);
  assert.match(renderedRow8[0], /signed online processor fee \+100 pence \(added\) = 7900 pence/i);
  assert.doesNotMatch(renderedRow2[0], /deducted|\bnet\b/i);
  assert.doesNotMatch(renderedRow8[0], /deducted|\bnet\b/i);
});

test('missing POS fee leaves row 2 gross and never describes it as net', () => {
  const result = calculateQuickBooksSales(aprilFixture());

  assert.equal(result.rows[1].amountPence, -12600);
  assert.match(result.rows[1].derivation, /gross card takings 12600 pence — no processor fee entered for this month/i);
  assert.doesNotMatch(result.rows[1].derivation, /\bnet\b/i);
});

test('persisted online fee nets row 8 while row 9 remains the unchanged negative fee', () => {
  const fixture = aprilFixture();
  fixture.fees = { online_fee: -100 };
  const result = calculateQuickBooksSales(fixture);

  assert.equal(result.rows[7].amountPence, -7700, '£78.00 gross less £1.00 fee is a £77.00 LP settlement');
  assert.equal(result.rows[8].amountPence, -100);
  assert.match(result.rows[7].derivation, /gross LP takings 7800 pence \+ signed online processor fee -100 pence \(deducted\) = net 7700 pence/i);

  fixture.fees.online_fee = 0;
  const zeroFee = calculateQuickBooksSales(fixture);
  assert.equal(zeroFee.rows[7].amountPence, -7800, 'a persisted zero is still an entered fee');
  assert.match(zeroFee.rows[7].derivation, /gross LP takings 7800 pence \+ signed online processor fee 0 pence = unchanged at 7800 pence/i);
  assert.doesNotMatch(zeroFee.rows[7].derivation, /deducted|\bnet\b/i);
});

test('shared fee formatter keeps signed operands, results, wording and plausibility aligned', () => {
  assert.deepEqual(formatQuickBooksFeeDerivation({
    grossPence: 10000, feePence: -500, grossLabel: 'card', feeLabel: 'POS',
  }), {
    resultPence: 9500,
    explanation: 'gross card takings 10000 pence + signed POS processor fee -500 pence (deducted) = net 9500 pence',
    warning: null,
  });
  assert.deepEqual(formatQuickBooksFeeDerivation({
    grossPence: 10000, feePence: 500, grossLabel: 'LP', feeLabel: 'online',
  }), {
    resultPence: 10500,
    explanation: 'gross LP takings 10000 pence + signed online processor fee +500 pence (added) = 10500 pence',
    warning: null,
  });
  assert.deepEqual(formatQuickBooksFeeDerivation({
    grossPence: 10000, feePence: 0, grossLabel: 'card', feeLabel: 'POS',
  }), {
    resultPence: 10000,
    explanation: 'gross card takings 10000 pence + signed POS processor fee 0 pence = unchanged at 10000 pence',
    warning: null,
  });
  assert.deepEqual(formatQuickBooksFeeDerivation({
    grossPence: 10000, feePence: null, grossLabel: 'card', feeLabel: 'POS',
  }), {
    resultPence: 10000,
    explanation: 'gross card takings 10000 pence — no processor fee entered for this month',
    warning: null,
  });
});

test('implausible POS and online fee ratios warn beside their derivations without blocking output', () => {
  const fixture = aprilFixture();
  fixture.fees = { pos_fee: -1300, online_fee: -1000 };
  const result = calculateQuickBooksSales(fixture);

  assert.match(result.rows[1].feeWarning, /Suspicious POS processor fee: -1300 pence is 10\.3% of positive gross takings, exceeding the named 10% plausibility threshold\./);
  assert.match(result.rows[7].feeWarning, /Suspicious online processor fee: -1000 pence is 12\.8% of positive gross takings, exceeding the named 10% plausibility threshold\./);
  const body = reports.render({ tab: 'qbsales', qbsales: result }, {}).body;
  assert.match(body, /data-qb-line="2"[\s\S]*?Suspicious POS processor fee/);
  assert.match(body, /data-qb-line="8"[\s\S]*?Suspicious online processor fee/);
});

test('plausible fee ratios do not warn, while a non-zero fee without positive gross does', () => {
  const plausible = aprilFixture();
  plausible.fees = { pos_fee: -1260, online_fee: -780 };
  const plausibleResult = calculateQuickBooksSales(plausible);
  assert.equal(plausibleResult.rows[1].feeWarning, null, 'the named 10% threshold is permitted');
  assert.equal(plausibleResult.rows[7].feeWarning, null);
  assert.doesNotMatch(reports.render({ tab: 'qbsales', qbsales: plausibleResult }, {}).body, /Suspicious (?:POS|online) processor fee/);

  const noGross = aprilFixture();
  noGross.payments = noGross.payments.filter((payment) => payment.code !== 'LP');
  noGross.fees = { online_fee: -100 };
  const noGrossResult = calculateQuickBooksSales(noGross);
  assert.match(noGrossResult.rows[7].feeWarning, /Suspicious online processor fee: -100 pence with gross takings 0 pence; no meaningful percentage exists when gross is zero or negative\./);
});

test('missing online fee leaves row 8 gross and row 9 explicitly unentered', () => {
  const result = calculateQuickBooksSales(aprilFixture());

  assert.equal(result.rows[7].amountPence, -7800);
  assert.equal(result.rows[8].amountPence, null);
  assert.equal(result.rows[8].entered, false);
  assert.match(result.rows[7].derivation, /gross LP takings 7800 pence — no processor fee entered for this month/i);
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

test('fee persistence validates month, line and signed integer pence and preserves zero as entered', () => {
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
  assert.deepEqual(zero, { ok: true, status: 200, op: 'set_qb_sales_fee', month: '2026-04', line: 'pos_fee', value_pence: 0 });
  assert.equal(online.value_pence, -100);
  assert.deepEqual(db.prepare('SELECT month, line, value_pence FROM qb_sales_fees ORDER BY line').all().map((row) => ({ ...row })), [
    { month: '2026-04', line: 'online_fee', value_pence: -100 },
    { month: '2026-04', line: 'pos_fee', value_pence: 0 },
  ]);
  db.close();
});

test('fee persistence rejects positive POS and online writes with field-specific sign errors', () => {
  const db = new sqlite.DatabaseSync(':memory:');
  const pos = applyQuickBooksSalesFee(db, {
    op: 'set_qb_sales_fee', month: '2026-04', line: 'pos_fee', value_pence: 1,
  }, 126);
  const online = applyQuickBooksSalesFee(db, {
    op: 'set_qb_sales_fee', month: '2026-04', line: 'online_fee', value_pence: 500,
  }, 127);

  assert.deepEqual(pos, { ok: false, status: 400, error: 'pos_fee must be zero or negative.' });
  assert.deepEqual(online, { ok: false, status: 400, error: 'online_fee must be zero or negative.' });
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='qb_sales_fees'").get(), undefined,
    'validation happens before persistence');
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

  applyQuickBooksSalesFee(db, { op: 'set_qb_sales_fee', month: '2026-04', line: 'pos_fee', value_pence: -321 }, 200);
  applyQuickBooksSalesFee(db, { op: 'set_qb_sales_fee', month: '2026-04', line: 'online_fee', value_pence: 0 }, 201);
  const reloaded = reports.getSection(db, ctx).qbsales;
  assert.equal(reloaded.rows[4].amountPence, -321);
  assert.equal(reloaded.rows[4].entered, true);
  assert.equal(reloaded.rows[8].amountPence, 0);
  assert.equal(reloaded.rows[8].entered, true, 'stored zero remains distinct from no row');
  db.close();
});
