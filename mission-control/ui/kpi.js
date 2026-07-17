'use strict';
// Overview KPI compute — PURE functions (no DB, no clock). The Overview's business feed computes
// every value AT READ TIME from librarian.db per the canonical-source ruling (coyote-claw
// CLAUDE.md "Canonical sources") — no stored copies, markdown holds pointers only.
//
// The decomposition identity (the diagnostic core): with C = transactions (guest checks — the
// trustworthy count; pos_guest_count is NOT real covers), R = net ex-VAT pence, A = R/C:
//   ΔR = R1 − R0 = (C1 − C0)·A0  +  (A1 − A0)·C1
//        └ volume effect ┘        └ spend effect ┘
// This is EXACT (algebraic identity), so volume + spend always reconciles to the actual revenue
// delta — the page renders the check, and the test asserts it.

/** ISO date + n days (UTC-safe on 'YYYY-MM-DD' strings). */
function shiftDays(iso, n) {
  const t = Date.parse(`${iso}T12:00:00Z`) + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Day-of-week of an ISO date (0=Sun..6=Sat), DST-proof via noon-UTC anchor. */
function dow(iso) {
  return new Date(Date.parse(`${iso}T12:00:00Z`)).getUTCDay();
}

/** The Monday of the ISO date's Mon–Sun week. */
function weekMonday(iso) {
  const d = dow(iso);
  return shiftDays(iso, d === 0 ? -6 : 1 - d);
}

/** Last COMPLETE Mon–Sun week ending on or before maxIso: { from, to }. */
function lastFullWeek(maxIso) {
  const d = dow(maxIso);
  const to = d === 0 ? maxIso : shiftDays(maxIso, -d); // most recent Sunday ≤ max
  return { from: shiftDays(to, -6), to };
}

/**
 * Decompose a revenue delta into volume + spend effects (pence floats; render rounds).
 * Returns null when either side has zero transactions — no fabricated split.
 *   volume = (C1−C0) × A0   (covers change at LAST YEAR's spend level)
 *   spend  = (A1−A0) × C1   (spend-per-head change at CURRENT volume)
 */
function decompose(c0, r0, c1, r1) {
  if (!(c0 > 0) || !(c1 > 0)) return null;
  const a0 = r0 / c0;
  const a1 = r1 / c1;
  const volume = (c1 - c0) * a0;
  const spend = (a1 - a0) * c1;
  const delta = r1 - r0;
  return {
    delta, volume, spend,
    a0, a1,
    checkOk: Math.abs(volume + spend - delta) < 0.5, // float dust only — the identity is exact
    lead: Math.abs(volume) >= Math.abs(spend) ? 'volume' : 'spend',
  };
}

/** Percent delta vs a base (null-safe; null when base is 0/absent). */
function pctDelta(cur, base) {
  if (!(base > 0) || cur === null || cur === undefined) return null;
  return ((cur - base) / base) * 100;
}

module.exports = { shiftDays, dow, weekMonday, lastFullWeek, decompose, pctDelta };
