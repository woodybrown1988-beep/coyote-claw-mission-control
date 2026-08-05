'use strict';
// LIFE OS — WEEKLY REVIEW (and the quarterly evolution beneath it). Build-ahead scaffold:
// snapshots render the moment the engine compiles them; nothing is simulated before that.
const LIFE = require('./life-lib.js');

module.exports = {
  key: 'life-review', route: '/life/review', workspace: 'life', title: 'Weekly Review',
  sub: 'Sunday evidence snapshot, Big 3, carry-forwards, subtraction — 30 minutes maximum · read-only',

  getSection(_db, _ctx) {
    const o = LIFE.openLifeReadonly();
    if (!o.ok) return { engine: { ok: false, reason: o.reason } };
    try {
      const weekly = LIFE.lifeSelect(o.db,
        `SELECT week_start, week_end, status FROM life_weekly_snapshots ORDER BY week_start DESC LIMIT 12`);
      const quarterly = LIFE.lifeSelect(o.db,
        `SELECT period_start, period_end, status FROM life_quarterly_reviews ORDER BY period_start DESC LIMIT 8`);
      return {
        engine: { ok: true },
        weekly: weekly.ok ? weekly.rows : [], quarterly: quarterly.ok ? quarterly.rows : [],
      };
    } finally { o.db.close(); }
  },

  render(section, _ctx) {
    const s = section || {};
    if (!s.engine || !s.engine.ok) {
      return { stamp: 'life-review · engine gate', body: LIFE.engineGate(s.engine ? s.engine.reason : 'no engine state') };
    }
    let body;
    if (s.weekly && s.weekly.length) {
      const tr = s.weekly.map((r) => `<tr><td>${LIFE.esc(r.week_start)} → ${LIFE.esc(r.week_end)}</td><td>${LIFE.esc(r.status)}</td></tr>`).join('');
      body = `<div class="panel"><h3>Weekly snapshots (${s.weekly.length})</h3><table class="data"><thead><tr><th>Week</th><th>Status</th></tr></thead><tbody>${tr}</tbody></table></div>`;
    } else {
      body = LIFE.gatePanel('Weekly review — evidence snapshot + proposed Big 3',
        'the weekly compiler (engine PR 8) writes life_weekly_snapshots before Sunday 18:00; approval rides the gated command path');
    }
    if (s.quarterly && s.quarterly.length) {
      const tr = s.quarterly.map((r) => `<tr><td>${LIFE.esc(r.period_start)} → ${LIFE.esc(r.period_end)}</td><td>${LIFE.esc(r.status)}</td></tr>`).join('');
      body += `<div class="panel"><h3>Quarterly evolution reviews (${s.quarterly.length})</h3><table class="data"><thead><tr><th>Period</th><th>Status</th></tr></thead><tbody>${tr}</tbody></table></div>`;
    } else {
      body += LIFE.gatePanel('Quarterly evolution review — outcomes, calibration, maturity, subtraction, version timeline',
        'the quarterly compiler (Phase-3 acceptance) — one-in/one-review feature discipline included');
    }
    return { stamp: `life-review · w=${s.weekly ? s.weekly.length : 0} q=${s.quarterly ? s.quarterly.length : 0}`, body };
  },
};
