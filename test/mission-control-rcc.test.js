'use strict';

// RCC Stage 1A — the Revenue Command Centre design system (extracted 2026-07-21 DIRECTLY from the
// operator mock's CSS). Pins: token fidelity (the mock's exact values), component grammar, the
// scoping rule (nothing renders outside .rcc — no other page changes), and the honest-gaps
// emptyState (blocker + unlock named, never a number).

const assert = require('node:assert/strict');
const test = require('node:test');
const S = require('../mission-control/ui/shared.js');

test('tokens are the MOCK VALUES verbatim (extracted from CSS, not inferred from renders)', () => {
  const T = S.rcc.tokens;
  assert.equal(T.bg, '#0b0d10');
  assert.equal(T.accent, '#e44b36', 'orange primary series');
  assert.equal(T.blue, '#67a7ff', 'LY blue');
  assert.equal(T.y2024, '#56616e', '2024 grey');
  assert.equal(T.good, '#45c486'); assert.equal(T.warn, '#f0b64f'); assert.equal(T.bad, '#ef6b68');
  assert.deepEqual(T.heat, ['#17242b', '#18333a', '#244c4f', '#6b4c2d', '#8a3d31', '#b44736'], 'the l1..l6 heat ramp');
});

test('the CSS is SCOPED under .rcc — the revenue canon cannot leak into other pages', () => {
  const css = S.rcc.css();
  for (const line of css.split('\n').map((l) => l.trim()).filter((l) => l && l.includes('{'))) {
    assert.ok(line.startsWith('.rcc') || line.startsWith('${'), `unscoped selector: ${line.slice(0, 60)}`);
  }
  assert.match(css, /repeating-linear-gradient\(135deg,#e44b36 0,#e44b36 4px,#702c25 4px,#702c25 8px\)/, 'the hatched forecast bar, verbatim');
});

test('component grammar: kpi / panel / tag / alert / heatCell / mbar render the mock shapes, escaped, clamped', () => {
  const kpi = S.rcc.kpi({ label: 'Net revenue', value: '£24,860', delta: { dir: 'up', text: '+6.2%' }, sub: 'vs LY', barPct: 140 });
  assert.match(kpi, /r-kpi-label">Net revenue/);
  assert.match(kpi, /r-delta r-up">\+6\.2%/);
  assert.match(kpi, /width:100%/, 'microbar clamped to 100');
  const evil = S.rcc.kpi({ label: '<script>x</script>', value: 'v' });
  assert.doesNotMatch(evil, /<script>x/, 'labels escaped');
  assert.match(S.rcc.tag('On track', 'good'), /r-tag good">On track/);
  assert.match(S.rcc.alert({ title: 'ATV gap', text: 'below target', impact: '−£1.2k', tone: 'bad' }), /r-alert bad/);
  assert.match(S.rcc.heatCell(9, 'tip'), /r-l6/, 'heat level clamped to 6');
  assert.match(S.rcc.heatCell(null), /r-cell"/, 'no-data cell has NO level class');
  assert.match(S.rcc.mbar(2026, 50, 'Jul', true), /r-mbar forecast/, 'forecast = hatched, not a solid year colour');
  assert.match(S.rcc.mbar(2024, 0.5), /height:1%/, 'floor at 1% so a real month is never invisible');
});

test('emptyState (honest-gaps rule): names the blocker + unlock, and there is no way to hand it a number', () => {
  const es = S.rcc.emptyState({ title: 'Covers', blocker: 'OpenTable not flowing — POS guest-count is NOT covers (canon).', unlock: 'wire the OpenTable email export' });
  assert.match(es, /<b>Covers<\/b> — not wired\./);
  assert.match(es, /OpenTable not flowing/);
  assert.match(es, /Unlock: wire the OpenTable email export/);
  assert.doesNotMatch(es, /\d+%|£\d/, 'no numeric content in the designed empty state');
});

test('Reservations Stage-1 extension: ONE new token (cyan) + stackCol/meterRow/stars extend the canon, never fork it', () => {
  assert.equal(S.rcc.tokens.cyan, '#5bd1d7', 'the mock\'s one addition');
  assert.equal(S.rcc.tokens.bg, '#0b0d10', 'the canon values unchanged');
  const col = S.rcc.stackCol(80, [{ pct: 60, color: S.rcc.tokens.accent }, { pct: 40, color: S.rcc.tokens.cyan }], 'W29');
  assert.match(col, /r-stackcol/); assert.match(col, /#5bd1d7/);
  assert.match(S.rcc.stackCol(0.2, []), /height:1%/, 'floor — a real week is never invisible');
  const row = S.rcc.meterRow({ label: 'Burger quality', pct: 140, value: '38' });
  assert.match(row, /width:100%/, 'meter clamped');
  assert.match(S.rcc.stars(4.62), /★★★★★|★★★★☆/);
  assert.match(S.rcc.stars(99), /★★★★★/, 'clamped to 5');
});
