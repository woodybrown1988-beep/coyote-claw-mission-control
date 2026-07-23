'use strict';
// Lapsed-regular win-back export (Customer Growth PR-B). CONSENT ENFORCED IN THE DATA LAYER: the SQL
// filters to marketing_opt_in = 1 on BOTH the profile and its rows — a non-opted-in guest can NEVER
// appear in the output, regardless of caller or query string. This is the ONLY place per-guest names
// leave the box, and only as a downloaded file (never rendered on a page). Joins the pseudonymous
// guest_profiles (the lapsed filter) to reservations (name/email) via identity_key.

const MAX_MIN_VISITS = 20;

function clampMinVisits(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.max(2, Math.min(MAX_MIN_VISITS, n)) : 3;
}

/** Opted-in lapsed regulars: >= minVisits lifetime visits, last visit 90+ days before the feed's latest
 *  day. marketing_opt_in = 1 is enforced in SQL (belt + braces on both tables). Read-only. */
function lapsedExportRows(db, minVisits) {
  const mv = clampMinVisits(minVisits);
  const win = db.prepare(`SELECT MAX(business_date) d FROM covers_day`).get();
  const winEnd = win && win.d ? win.d : null;
  if (!winEnd) return { minVisits: mv, winEnd: null, rows: [] };
  const rows = db.prepare(`
    SELECT g.completed_visits AS visits, g.recent_visit_date AS last_visit, g.lifetime_spend_pence AS spend_pence,
           MAX(r.guest) AS name, MAX(r.email) AS email, MAX(r.phone) AS phone
      FROM guest_profiles g JOIN reservations r ON r.identity_key = g.identity_key
     WHERE g.marketing_opt_in = 1 AND r.marketing_opt_in = 1
       AND g.completed_visits >= ? AND g.recent_visit_date IS NOT NULL
       AND g.recent_visit_date < date(?, '-90 day')
     GROUP BY g.identity_key
     ORDER BY g.completed_visits DESC, g.recent_visit_date ASC
  `).all(mv, winEnd);
  return { minVisits: mv, winEnd, rows };
}

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function toCsv(rows) {
  const head = 'name,email,phone,lifetime_visits,last_visit,lifetime_spend_gbp';
  const body = rows.map((r) => [
    r.name, r.email, r.phone, r.visits, r.last_visit,
    r.spend_pence != null ? (Number(r.spend_pence) / 100).toFixed(2) : '',
  ].map(csvCell).join(',')).join('\n');
  return head + '\n' + body + (body ? '\n' : '');
}

module.exports = { lapsedExportRows, toCsv, clampMinVisits, MAX_MIN_VISITS };
