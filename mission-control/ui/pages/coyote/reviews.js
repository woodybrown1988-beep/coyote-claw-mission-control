'use strict';

// Reviews page — the Step-2 action queue, re-skinned into the ops-centre .rcard language. STRICTLY
// read-only via ctx.q (SELECT-only): STORED drafts are RENDERED, never generated. The only board write
// is POST /api/review-action (server.js) — here we only emit the buttons the shared client script wires
// (data-copy / data-op). Google replies are Telegram-gated OFF the board, so a Google card shows status
// only: NO data-op, NO data-review wrapper, never a control that could post a Google reply.
// Contract: { key, route, title, sub, getSection(db,ctx), render(section,ctx) }.
const S = require('../../shared.js');

// --- tiny local coercers (NEVER require anything but ../shared.js) ---
function toIntOrNull(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}
function toMs(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}
function ratingOrNull(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function str(v) {
  return typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v);
}
function fmtRating(r) {
  return r === null || r === undefined ? '—' : Number(r).toFixed(2);
}

// Colour-coded badge per platform (Google blue / TripAdvisor green / OpenTable orange — the rcard CSS).
const PLATFORMS = {
  google: { cls: 'b-google', label: 'Google' },
  tripadvisor: { cls: 'b-tripadvisor', label: 'TripAdvisor' },
  opentable: { cls: 'b-opentable', label: 'OpenTable' },
};
// Only TA/OT get the safe write controls; Google (and any unknown source) is status-only.
function isWriteable(platform) {
  return platform === 'tripadvisor' || platform === 'opentable';
}

// =====================================================================================
// getSection — SELECT-only reads, returns a plain model. No throws on missing tables
// (ctx.q returns {ok:false, rows:[]} → empty states downstream).
// =====================================================================================
function getSection(db, ctx) {
  const now = ctx && Number.isFinite(ctx.now) ? ctx.now : Date.now();
  const q = ctx.q;

  // The action queue (audit 2026-07-21 fix): TRIAGE order — low-star (≤3) first, then OLDEST
  // first — with paging. The old newest-8 render hid 71 of 79 pending and the oldest could
  // NEVER surface. `?qpage=N` pages through; the header states showing-X-of-Y honestly.
  const qpage = Math.max(0, parseInt((ctx.query && ctx.query.qpage) || '0', 10) || 0);
  const pendingRow = q(
    `SELECT COUNT(*) AS c FROM review_drafts rd
      WHERE rd.draft_status NOT IN ('responded','skipped')
        AND (rd.snoozed_until IS NULL OR rd.snoozed_until < ?)`, [now]);
  const pendingTotal = (pendingRow && pendingRow.ok && pendingRow.rows[0]) ? Number(pendingRow.rows[0].c) || 0 : 0;
  const draftsRes = q(
    `SELECT rc.review_id, rc.platform, rc.overall, rc.reviewer, rc.reviewed_date, rc.text,
            rd.draft_text, rd.draft_status, rd.review_url, rd.guard_flagged
       FROM review_drafts rd JOIN review_corpus rc ON rd.review_id = rc.review_id
      WHERE rd.draft_status NOT IN ('responded','skipped')
        AND (rd.snoozed_until IS NULL OR rd.snoozed_until < ?)
      ORDER BY (COALESCE(rc.overall, 5) <= 3) DESC, rc.reviewed_date ASC LIMIT 10 OFFSET ?`,
    [now, qpage * 10]
  );
  const tagsRes = q(`SELECT review_id, issue_code FROM review_issues`);
  const trendsRes = q(
    `SELECT issue_code, count_current, count_prior, rising FROM issue_trends
      WHERE computed_at = (SELECT MAX(computed_at) FROM issue_trends)
      ORDER BY rising DESC, count_current DESC`
  );
  const escRes = q(
    `SELECT issue_code, status, evidence_summary FROM review_actions
      WHERE escalate = 1 ORDER BY auto DESC, id DESC`
  );
  const snapRes = q(
    `SELECT total, awaiting_response, awaiting_recent_text, awaiting_over_1y, awaiting_star_only,
            overall_rating, google_rating, tripadvisor_rating, opentable_rating, ratings_window, fetched_at
       FROM review_snapshot ORDER BY fetched_at DESC LIMIT 1`
  );

  // Group issue tags per review (for the cards' filter chips + data-issues).
  const tagsByReview = {};
  if (tagsRes.ok) {
    for (const row of tagsRes.rows) {
      const id = String(row.review_id);
      const code = str(row.issue_code);
      if (!code) continue;
      (tagsByReview[id] = tagsByReview[id] || []).push(code);
    }
  }

  const cards = (draftsRes.ok ? draftsRes.rows : []).map((row) => {
    const id = String(row.review_id);
    return {
      reviewId: id,
      platform: str(row.platform) || 'unknown',
      overall: ratingOrNull(row.overall),
      reviewer: str(row.reviewer),
      date: row.reviewed_date ? String(row.reviewed_date).slice(0, 10) : '',
      text: str(row.text),
      draft: str(row.draft_text),
      status: str(row.draft_status) || 'draft',
      url: row.review_url ? String(row.review_url) : '',
      flagged: row.guard_flagged ? String(row.guard_flagged) : '',
      tags: tagsByReview[id] || [],
    };
  });

  const trends = (trendsRes.ok ? trendsRes.rows : []).map((row) => ({
    code: str(row.issue_code),
    current: toIntOrNull(row.count_current),
    prior: toIntOrNull(row.count_prior),
    rising: toIntOrNull(row.rising) === 1,
  }));

  const escalations = (escRes.ok ? escRes.rows : []).map((row) => ({
    code: str(row.issue_code),
    status: str(row.status),
    summary: str(row.evidence_summary),
  }));

  const snapRow = snapRes.ok && snapRes.rows.length ? snapRes.rows[0] : null;
  const snapshot = snapRow
    ? {
        total: toIntOrNull(snapRow.total),
        awaiting: toIntOrNull(snapRow.awaiting_response),
        awaitingRecentText: toIntOrNull(snapRow.awaiting_recent_text),
        awaitingOver1y: toIntOrNull(snapRow.awaiting_over_1y),
        awaitingStarOnly: toIntOrNull(snapRow.awaiting_star_only),
        overall: ratingOrNull(snapRow.overall_rating),
        google: ratingOrNull(snapRow.google_rating),
        tripadvisor: ratingOrNull(snapRow.tripadvisor_rating),
        opentable: ratingOrNull(snapRow.opentable_rating),
        window: str(snapRow.ratings_window),
        fetchedAt: toMs(snapRow.fetched_at),
      }
    : null;

  return { ok: true, cards, trends, escalations, snapshot, pendingTotal, qpage };
}

// =====================================================================================
// render helpers
// =====================================================================================
function renderStars(overall) {
  if (overall === null || overall === undefined) return '—';
  const n = Math.max(0, Math.min(5, Math.round(overall)));
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

// escalate=1 → a top safety alert. ALLERGEN leads (escalated on sight, any count); other escalations
// still surface honestly. Red is RESERVED for blocked-on-you / critical — this qualifies.
function renderEscalationBanner(escalations) {
  if (!escalations.length) return '';
  const allergen = escalations.find((e) => /ALLERGEN/i.test(e.code));
  if (allergen) {
    const first = (allergen.summary || '').split('\n')[0];
    return `<div class="banner red">⚠ <b>ALLERGEN</b> — escalated on sight (safety, any count).${
      first ? ' ' + S.escapeHtml(first) : ''
    } <span class="mono">· surface to research</span></div>`;
  }
  const codes = escalations.map((e) => S.escapeHtml(e.code || 'issue')).join(', ');
  return `<div class="banner red">⚠ ${S.fmtInt(escalations.length)} escalated issue${
    escalations.length > 1 ? 's' : ''
  } — ${codes}</div>`;
}

// Honest ratings line as tiles: real stored ratings + the actionable-30d queue + the lifetime backlog
// (the "959") demoted to historical context. NEVER a fabricated number — '—' when not yet ingested.
function renderRatings(snap) {
  if (!snap) {
    return '<div class="banner muted">Review snapshot not yet ingested — ratings + the awaiting backlog appear after the daily ingest.</div>';
  }
  const win = snap.window ? S.escapeHtml(snap.window) : 'rating';
  return `<div class="tiles">
    <div class="tile blue"><div class="lab">Google</div><div class="val">${fmtRating(snap.google)}</div><div class="sub">${win}</div></div>
    <div class="tile green"><div class="lab">TripAdvisor</div><div class="val">${fmtRating(snap.tripadvisor)}</div><div class="sub">${win}</div></div>
    <div class="tile amber"><div class="lab">OpenTable</div><div class="val">${fmtRating(snap.opentable)}</div><div class="sub">${win}</div></div>
    <div class="tile"><div class="lab">Actionable · 30d</div><div class="val">${S.fmtInt(snap.awaitingRecentText)}</div><div class="sub g">recent text · the live queue</div></div>
    <div class="tile muted"><div class="lab">Awaiting · lifetime</div><div class="val">${S.fmtInt(snap.awaiting)}</div><div class="sub">historical · not a queue</div></div>
  </div>`;
}

// Rising-issue chips (issue_trends latest). Click filters the cards client-side (data-filter, no network).
function renderRising(trends) {
  const rising = trends.filter((t) => t.rising);
  if (!rising.length) return '';
  const chips = rising
    .map(
      (t) =>
        `<span class="chip amber" data-filter="${S.escapeHtml(t.code)}">${S.escapeHtml(
          t.code
        )} ↑${S.fmtInt(t.current)} (was ${S.fmtInt(t.prior)})</span>`
    )
    .join('');
  const all = '<span class="chip muted" data-filter="">all</span>';
  return `<div class="sec-label">Rising · 30d<span class="rule"></span></div><div class="ract">${chips}${all}</div>`;
}

// One review card. Google = status-only (no data-op / no data-review). TA/OT = copy + open-link +
// mark-responded/snooze (the narrow safe write-path the client script POSTs to /api/review-action).
function renderCard(card) {
  const plat = PLATFORMS[card.platform] || { cls: '', label: card.platform || 'unknown' };
  const issuesAttr = S.escapeHtml(card.tags.join(' '));
  const tags = card.tags.length
    ? `<div class="rtags">${card.tags
        .map((t) => `<span class="tag" data-filter="${S.escapeHtml(t)}">${S.escapeHtml(t)}</span>`)
        .join('')}</div>`
    : '';
  const flag = card.flagged
    ? `<div class="rflag">⚠ guard flag: ${S.escapeHtml(card.flagged)} — review before posting</div>`
    : '';
  const top = `<div class="rcard-top">
      <span class="rbadge ${plat.cls}">${S.escapeHtml(plat.label)}</span>
      <span class="rstars">${renderStars(card.overall)}</span>
      <span class="rwho">${S.escapeHtml(card.reviewer || '—')}</span>
      <span class="rdate">${card.date ? S.escapeHtml(card.date) : '—'}</span>
    </div>`;
  const text = `<div class="rtext">${S.escapeHtml(card.text || '(no review text)')}</div>`;

  if (isWriteable(card.platform)) {
    const draft = `<div class="rdraft"><div class="rdraft-lab">Stored draft reply</div><div class="rdraft-body" data-draft>${S.escapeHtml(
      card.draft || '(no draft stored)'
    )}</div></div>`;
    const open = card.url && /^https?:\/\//.test(card.url) // only http(s) — never a javascript: scheme
      ? `<a class="btn" href="${S.escapeHtml(card.url)}" target="_blank" rel="noopener noreferrer">Open review ↗</a>`
      : '';
    const act = `<div class="ract">
        <button class="btn cyan" type="button" data-copy>Copy reply</button>
        ${open}
        <button class="btn" type="button" data-op="mark_responded">Mark responded</button>
        <button class="btn" type="button" data-op="snooze">Snooze</button>
        <span class="state">draft · post manually</span>
      </div>`;
    return `<div class="rcard ${plat.cls}" data-card data-review="${S.escapeHtml(
      card.reviewId
    )}" data-issues="${issuesAttr}">
      ${top}${text}${tags}${draft}${flag}${act}
    </div>`;
  }

  // Google / unknown source: Telegram-gated off the board. Status only — render the stored draft for
  // context but emit NO write control of any kind.
  const state = card.status === 'posted' ? 'posted ✓' : '⏳ Approve in Telegram';
  const draft = `<div class="rdraft"><div class="rdraft-lab">Stored draft reply</div><div class="rdraft-body">${S.escapeHtml(
    card.draft || '(no draft stored)'
  )}</div></div>`;
  const act = `<div class="ract"><span class="state">${S.escapeHtml(state)}</span></div>`;
  return `<div class="rcard ${plat.cls}" data-issues="${issuesAttr}">
    ${top}${text}${tags}${draft}${flag}${act}
  </div>`;
}

// =====================================================================================
// render — returns { stamp, body }
// =====================================================================================
function render(section, ctx) {
  const now = ctx && Number.isFinite(ctx.now) ? ctx.now : Date.now();
  const model = section && section.ok ? section : { cards: [], trends: [], escalations: [], snapshot: null };
  const cards = model.cards || [];
  const snap = model.snapshot;

  // stamp: honest review_snapshot freshness (fresh → green, stale → amber, none → muted).
  const fr = S.freshness(snap ? snap.fetchedAt : 0, now);
  const inner = fr.cls === 'fresh' ? `<b>${fr.label}</b>` : `<span class="${fr.cls}">${fr.label}</span>`;
  const stamp = `review snapshot · ${inner}`;

  const escalationBanner = renderEscalationBanner(model.escalations || []);
  const ratings = renderRatings(snap);
  const rising = renderRising(model.trends || []);

  const awaitingTap = cards.filter((c) => c.platform === 'google' && c.status === 'awaiting_approval').length;
  const cardsHtml = cards.length
    ? `<div class="rcards">${cards.map(renderCard).join('')}</div>`
    : '<div class="banner muted">No drafts in the queue — drafts generate on the daily ingest (responded / skipped / snoozed are filtered out).</div>';

  const total = Number(model.pendingTotal) || cards.length;
  const qpage = Number(model.qpage) || 0;
  const pager = total > (qpage + 1) * 10 || qpage > 0
    ? `<div style="margin-top:10px;font-size:12px" class="mono">${qpage > 0 ? `<a href="/coyote/reviews?qpage=${qpage - 1}" style="color:var(--cyan,#22D3EE)">← newer-triage</a> · ` : ''}showing ${S.fmtInt(qpage * 10 + 1)}–${S.fmtInt(Math.min((qpage + 1) * 10, total))} of ${S.fmtInt(total)} pending (low-star + oldest first)${total > (qpage + 1) * 10 ? ` · <a href="/coyote/reviews?qpage=${qpage + 1}" style="color:var(--cyan,#22D3EE)">next 10 →</a>` : ''}</div>`
    : '';
  const panel = `<div class="panel">
    <div class="panel-head"><h2>Action queue</h2><span class="meta">${S.fmtInt(total)} pending · showing ${S.fmtInt(cards.length)} (low-star + oldest first) · ${S.fmtInt(
    awaitingTap
  )} awaiting Telegram tap</span></div>
    <div class="panel-body">
      ${rising}
      ${cardsHtml}
      ${pager}
    </div>
  </div>`;

  const body = [escalationBanner, ratings, panel].filter(Boolean).join('\n');
  return { stamp, body };
}

module.exports = {
  key: 'reviews',
  route: '/coyote/reviews', workspace: 'coyote',
  title: 'Reviews',
  sub: 'Action queue · drafts, tags, per-platform reply',
  getSection,
  render,
};
