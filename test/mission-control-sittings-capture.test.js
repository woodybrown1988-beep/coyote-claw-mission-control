'use strict';
// SITTINGS CAPTURE GATE (2026-08-19) — from a live wrong-number report.
//
// A sitting can only be formed from a receipt carrying a PHYSICAL table; the POS books most service
// against "Order N" (a counter, not a place), and those are deliberately never clustered. So the
// sittings population is a SUBSET of dine-in, and it is not drawn evenly: measured 28d to
// 2026-08-18, MON-FRI DEAL was ~100% captured by net, EAT IN ~9%, QR ~19%. "Net per served sitting"
// was therefore mostly the MON-FRI DEAL price, presented as a channel verdict against QR.
//
// THE CLASS, not the instance: any metric computed on a SUBSET must state what share of the
// population it covers, and must withhold a COMPARISON when two arms are sampled at different
// rates. These tests pin (a) the thresholds, (b) that the real measured rates are refused,
// (c) that a genuinely representative sample passes, and (d) the negative control — that the gate
// can go both ways rather than always refusing.
const assert = require('node:assert/strict');
const test = require('node:test');
const reports = require('../mission-control/ui/pages/coyote/reports.js');

const { sittingCaptureVerdict, SITTING_MIN_CAPTURE, SITTING_MAX_SPREAD } = reports;

test('thresholds are the named, pinned values', () => {
  assert.equal(SITTING_MIN_CAPTURE, 0.50);
  assert.equal(SITTING_MAX_SPREAD, 0.20);
});

test('the REAL measured capture rates are refused (QR 19%, served 29% — the live defect)', () => {
  const v = sittingCaptureVerdict({ QR: 0.191, served: 0.288 });
  assert.equal(v.ok, false, 'a sample this thin must not be presented as a channel verdict');
  assert.match(v.reason, /numbered table/);
  assert.match(v.reason, /QR 19%/);
  assert.match(v.reason, /served 29%/);
});

test('POSITIVE CONTROL: a well-captured, evenly-sampled window passes', () => {
  const v = sittingCaptureVerdict({ QR: 0.82, served: 0.88 });
  assert.equal(v.ok, true, 'the gate must not refuse everything — it has to be able to pass');
  assert.ok(v.spread <= SITTING_MAX_SPREAD);
});

test('a channel below the capture floor is refused even when both are equal', () => {
  const v = sittingCaptureVerdict({ QR: 0.40, served: 0.40 });
  assert.equal(v.ok, false, 'equal sampling does not rescue a sample that is simply too thin');
  assert.match(v.reason, /too little of it is captured/);
});

test('EQUAL-CAPTURE-BUT-DIVERGENT: both above the floor yet sampled differently is refused', () => {
  const v = sittingCaptureVerdict({ QR: 0.55, served: 0.90 });
  assert.equal(v.ok, false);
  assert.match(v.reason, /table-assignment habit, not channel value/,
    'the refusal must name WHY the comparison misleads, not just that it is blocked');
  assert.ok(v.spread > SITTING_MAX_SPREAD);
});

test('unknown capture is refused, never silently treated as fine', () => {
  assert.equal(sittingCaptureVerdict(null).ok, false);
  assert.equal(sittingCaptureVerdict({}).ok, false);
  assert.equal(sittingCaptureVerdict({ QR: 0.9 }).ok, false, 'one arm known is not enough to compare two');
  assert.match(sittingCaptureVerdict({}).reason, /capture rate unknown/);
});
