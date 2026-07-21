'use strict';
// MC CHAT — the frontdoor WEB TRANSPORT surface (ruling: mc-chat-approved, 2026-07-21; supersedes
// the recorded "MC Phase 2 write-actions/Chat tab: killed" ruling — journaled in Rex's ledger).
// The page is a THIN TRANSPORT onto the existing frontdoor pipeline: typing here writes ONE
// chat_messages 'in' row (POST /api/chat-message — the narrow write); the box-side web adapter
// (cc: frontdoor/webAdapter.ts, a separate unit from the Telegram front door) claims it and routes
// through the SAME core classifier/guards/enqueue Telegram uses. ZERO routing logic lives here.
//
// STATUS UPDATES: SHORT-POLL (3s fetch of /api/chat-updates?after=<id>), stated choice: the MC
// stack's only refresh convention is a 30s full location.reload — too slow for conversation and it
// clobbers a half-typed message (this page opts out of that global reload via data-chat-page);
// SSE would add a NEW keep-alive failure class to the hand-rolled node:http server. Short-poll
// reuses the exact fetch+JSON machinery the write paths already use, stateless server-side.
//
// AUTH BOUNDARY: MC binds 127.0.0.1 + the tailnet address ONLY (verified 2026-07-21, ss -ltnp).
// This page must NEVER be exposed on a public ingress without an auth layer.
const S = require('../../shared.js');

const PAGE_SIZE = 30;

function rowsOf(res) { return res && res.ok && Array.isArray(res.rows) ? res.rows : []; }

// Source chip labels — the agent speaking. Unknown sources render as-is (never hidden).
const SOURCE_LABEL = {
  router: 'Router', boxquery: 'Box Query', rex: 'Rex', lead: 'Lead', research: 'Researcher',
  brief: 'Rex · morning brief', soto: 'Rex · state of the org',
};
const COLLAPSED_SOURCES = new Set(['brief', 'soto', 'research']); // long-form → collapsed cards

module.exports = {
  key: 'chat', route: '/claw/chat', workspace: 'claw', title: 'Chat',
  sub: 'The front door, on the board — same classifier, guards and gates as Telegram · tailnet-only',

  getSection(db, ctx) {
    const q = ctx && ctx.q;
    const now = (ctx && ctx.now) || Date.now();
    if (typeof q !== 'function') return { now, wired: false, messages: [], total: 0, cpage: 0, lastId: 0 };

    const cpage = Math.max(0, parseInt((ctx.query && ctx.query.cpage) || '0', 10) || 0);
    // Newest page window, rendered oldest-first. LEFT JOIN jobs for the async-status chips.
    const res = q(
      `SELECT m.id, m.direction, m.source, m.text, m.job_id, m.created_at,
              j.status AS job_status, j.type AS job_type
         FROM chat_messages m LEFT JOIN jobs j ON j.id = m.job_id
        ORDER BY m.id DESC LIMIT ? OFFSET ?`, [PAGE_SIZE, cpage * PAGE_SIZE]);
    const wired = !!(res && res.ok);
    const messages = rowsOf(res).reverse();
    const totalRow = rowsOf(q(`SELECT COUNT(*) AS c FROM chat_messages`))[0];
    const lastRow = rowsOf(q(`SELECT MAX(id) AS m FROM chat_messages`))[0];
    return {
      now, wired, messages, cpage,
      total: totalRow ? Number(totalRow.c) || 0 : 0,
      lastId: lastRow && lastRow.m != null ? Number(lastRow.m) : 0,
    };
  },

  render(section, ctx) {
    const m = section || {};
    const esc = S.escapeHtml;
    const parts = [];

    parts.push(`<style>
      .ch-thread{display:flex;flex-direction:column;gap:10px;margin-bottom:14px}
      .ch-msg{max-width:76%;border-radius:12px;padding:9px 13px;font-size:13px;line-height:1.5;white-space:pre-wrap;word-break:break-word}
      .ch-in{align-self:flex-end;background:rgba(34,211,238,.10);border:1px solid rgba(34,211,238,.25)}
      .ch-out{align-self:flex-start;background:var(--panel-2,rgba(255,255,255,.04));border:1px solid var(--border,rgba(255,255,255,.09))}
      .ch-src{font-family:var(--font-mono,monospace);font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted,#8b98a5);margin-bottom:4px;display:flex;gap:8px;align-items:center}
      .ch-sql{background:rgba(0,0,0,.35);border-radius:8px;padding:8px 10px;font-family:var(--font-mono,monospace);font-size:11.5px;overflow-x:auto;margin-top:6px;white-space:pre}
      .ch-chip{display:inline-block;font-size:10px;border-radius:9px;padding:1px 8px;border:1px solid rgba(251,191,36,.5);color:var(--amber,#FBBF24)}
      .ch-form{display:flex;gap:8px;align-items:flex-end;position:sticky;bottom:0;background:var(--bg,#0b1420);padding:8px 0}
      .ch-form textarea{flex:1;min-height:44px;max-height:150px;resize:vertical;background:var(--panel-2);border:1px solid var(--border);border-radius:9px;color:var(--text);font-family:var(--font-body);font-size:13px;padding:9px 11px}
      .ch-details summary{cursor:pointer}
      .ch-meta{font-family:var(--font-mono,monospace);font-size:10.5px;color:var(--muted,#8b98a5);margin-top:5px}
      .ch-workings summary{cursor:pointer;font-family:var(--font-mono,monospace);font-size:10.5px;color:var(--muted,#8b98a5);margin-top:5px}
    </style>`);

    if (!m.wired) {
      parts.push(`<div class="banner muted" data-chat-page>Chat lands once the engine side deploys (the <span class="mono">chat_messages</span> store is not in this DB yet — cc PR #80). Nothing is simulated in the meantime; Telegram remains fully live.</div>`);
      return { stamp: 'web transport · awaiting engine deploy', body: parts.join('\n') };
    }

    // ---- pager (unbounded-list rule: last page window + honest total) ----
    const shownFrom = m.total - m.cpage * PAGE_SIZE - m.messages.length;
    const pager = [];
    if (m.total > (m.cpage + 1) * PAGE_SIZE) pager.push(`<a class="btn" href="/claw/chat?cpage=${m.cpage + 1}">older ↑</a>`);
    if (m.cpage > 0) pager.push(`<a class="btn" href="/claw/chat?cpage=${m.cpage - 1}">newer ↓</a>`);
    parts.push(`<div class="sec-label">Thread <span class="mono">(${esc(String(m.total))} messages · showing ${esc(String(Math.max(0, shownFrom) + 1))}–${esc(String(m.total - m.cpage * PAGE_SIZE))})</span><span class="rule"></span>${pager.join(' ')}</div>`);

    // ---- the thread (verbosity ruling 2026-07-21: ANSWERS ONLY, workings collapsed) ----
    // Router acks FOLD once answered: an ack row whose job has an agent answer IN THIS WINDOW is
    // not rendered standalone — its ask-time folds into the answer card's meta line. (An ack whose
    // answer hasn't landed — or sits outside the page window — still renders, with its live chip.)
    const answerByJob = new Map();
    const ackByJob = new Map();
    for (const r of m.messages) {
      if (r.direction !== 'out' || !r.job_id) continue;
      if (r.source === 'router') ackByJob.set(r.job_id, r);
      else answerByJob.set(r.job_id, r);
    }
    // LENGTH GUARD: >10 lines → first paragraph + "show more"; at or under → untouched, NO chrome.
    const LENGTH_CAP = 10;
    const guarded = (text) => {
      const lines = String(text).split('\n');
      if (lines.length <= LENGTH_CAP) return esc(text);
      // first paragraph, but a single wall-of-lines paragraph (Rex's list style) caps at 4 lines —
      // "beyond the first paragraph" must never mean "everything".
      let firstPara = String(text).split(/\n\s*\n/)[0];
      const pLines = firstPara.split('\n');
      if (pLines.length > 4) firstPara = pLines.slice(0, 4).join('\n');
      const rest = lines.length - firstPara.split('\n').length;
      return `${esc(firstPara)}<details class="ch-workings"><summary>show more (${rest} more line${rest === 1 ? '' : 's'}) ▸</summary>${esc(text)}</details>`;
    };
    const bubble = (r) => {
      if (r.direction === 'in') {
        return `<div class="ch-msg ch-in" data-mid="${esc(String(r.id))}">${esc(r.text)}</div>`;
      }
      // folded ack: the answer card carries its timing
      if (r.source === 'router' && r.job_id && answerByJob.has(r.job_id)) return '';
      const label = SOURCE_LABEL[r.source] || r.source || 'box';
      // async chip: a linked job still in flight → amber status chip the poller updates live
      const terminal = r.job_status == null || ['done', 'failed', 'escalated'].includes(String(r.job_status));
      const chip = r.job_id && !terminal
        ? ` <span class="ch-chip" data-jobchip="${esc(r.job_id)}">${esc(String(r.job_status))}…</span>`
        : '';
      const ack = r.job_id ? ackByJob.get(r.job_id) : null;
      const asked = ack ? `asked <time data-ms="${esc(String(ack.created_at))}"></time> · ` : '';
      const ackMark = (r.source === 'router' && r.job_id) ? ` data-ackjob="${esc(r.job_id)}"` : '';
      let body;
      const fence = /```\n?([\s\S]*?)```/.exec(String(r.text));
      if (r.source === 'boxquery' && fence) {
        // ANSWER-FIRST: prose visible; meta muted; the SQL behind "show workings" — nothing deleted,
        // the full text stays in the row and the expander (the Reports basis-caption pattern).
        const [before, after] = [String(r.text).slice(0, fence.index), String(r.text).slice(fence.index + fence[0].length)];
        const meta = after.trim();
        body = `${guarded(before.trim())}`
          + `<div class="ch-meta">${asked}answered <time data-ms="${esc(String(r.created_at))}"></time>${meta ? ` · ${esc(meta.replace(/\n/g, ' · '))}` : ''}</div>`
          + `<details class="ch-workings"><summary>show workings ▸</summary><div class="ch-sql">${esc(fence[1].trim())}</div></details>`;
      } else {
        body = `${guarded(r.text)}${ack ? `<div class="ch-meta">${asked}answered <time data-ms="${esc(String(r.created_at))}"></time></div>` : ''}`;
      }
      const inner = `<div class="ch-src">${esc(label)}${chip}<time data-ms="${esc(String(r.created_at))}"></time></div>${body}`;
      if (COLLAPSED_SOURCES.has(String(r.source))) {
        const first = String(r.text).split('\n')[0].slice(0, 80);
        return `<div class="ch-msg ch-out" data-mid="${esc(String(r.id))}"><details class="ch-details"><summary><span class="ch-src" style="display:inline-flex">${esc(label)}</span> ${esc(first)} ▸</summary>${inner}</details></div>`;
      }
      return `<div class="ch-msg ch-out" data-mid="${esc(String(r.id))}"${ackMark}>${inner}</div>`;
    };
    parts.push(`<div class="ch-thread" id="ch-thread" data-chat-page data-last="${esc(String(m.lastId))}" data-rev="${esc(String((ctx && ctx.serverRev) || ''))}">`);
    if (m.messages.length === 0) {
      parts.push(`<div class="banner muted">No messages yet. Ask anything — <span class="mono">data:</span> for a SQL answer, <span class="mono">research:</span> for a cited briefing, plain text goes to the Lead as a build brief, or address Rex by name for org state.</div>`);
    } else {
      parts.push(m.messages.map(bubble).filter(Boolean).join('\n'));
    }
    parts.push(`</div>`);

    // ---- input (the ONE write affordance — POST /api/chat-message) ----
    parts.push(`<form class="ch-form" id="ch-form">
      <textarea name="text" id="ch-text" placeholder="data: … / research: … / plain text → the Lead / ask Rex by name" maxlength="4000" required></textarea>
      <button class="btn" type="submit" id="ch-send">Send</button>
    </form>
    <div class="ash" style="font-size:11px;margin-top:4px">Same pipeline as Telegram — plan/merge gates still tap on Telegram in Phase 1. Tailnet-only surface.</div>`);

    // Page-scoped script: send + 3s short-poll (choice + why in the header comment). The global 30s
    // reload is skipped on this page (data-chat-page — see shared.js) so typing never gets clobbered.
    parts.push(`<script>(function(){
      var last = Number(document.getElementById('ch-thread') ? document.getElementById('ch-thread').dataset.last : 0) || 0;
      var busy = false;
      var form = document.getElementById('ch-form');
      if (form) form.addEventListener('submit', function(e){
        e.preventDefault();
        if (busy) return;
        var ta = document.getElementById('ch-text');
        var text = (ta.value || '').trim();
        if (!text) return;
        busy = true; document.getElementById('ch-send').disabled = true;
        fetch('/api/chat-message', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: text }) })
          .then(function(r){ return r.json(); })
          .then(function(r){ if (r && r.ok) { ta.value=''; poll(); } })
          .finally(function(){ busy = false; document.getElementById('ch-send').disabled = false; });
      });
      function collapsedText(target, text){
        var lines = String(text).split('\n');
        if (lines.length <= 10) { target.appendChild(document.createTextNode(text)); return; }
        var head = lines.slice(0, 4).join('\n');
        target.appendChild(document.createTextNode(head));
        var det = document.createElement('details'); det.className = 'ch-workings';
        var sum = document.createElement('summary'); sum.textContent = 'show more (' + (lines.length - 4) + ' more lines) ▸';
        det.appendChild(sum);
        var full = document.createElement('div'); full.textContent = text; det.appendChild(full);
        target.appendChild(det);
      }
      function addMsg(m){
        var th = document.getElementById('ch-thread'); if (!th) return;
        var d = document.createElement('div');
        d.className = 'ch-msg ' + (m.direction === 'in' ? 'ch-in' : 'ch-out');
        d.setAttribute('data-mid', String(m.id));
        if (m.direction === 'out') {
          var src = document.createElement('div'); src.className = 'ch-src';
          src.textContent = m.label || m.source || 'box';
          if (m.job_id && m.job_status && ['done','failed','escalated'].indexOf(m.job_status) === -1) {
            var c = document.createElement('span'); c.className = 'ch-chip'; c.setAttribute('data-jobchip', m.job_id);
            c.textContent = m.job_status + '…'; src.appendChild(document.createTextNode(' ')); src.appendChild(c);
            if (m.source === 'router' && m.job_id) d.setAttribute('data-ackjob', m.job_id);
          }
          d.appendChild(src);
          // an arriving ANSWER folds its standalone ack bubble (same rule as the server render)
          if (m.source !== 'router' && m.job_id) {
            var ackEl = th.querySelector('[data-ackjob="' + m.job_id + '"]'); if (ackEl) ackEl.remove();
          }
        }
        // ANSWER-FIRST (verbosity ruling): fenced SQL → prose + muted meta + collapsed workings
        var fence = /\x60\x60\x60\n?([\s\S]*?)\x60\x60\x60/.exec(String(m.text));
        if (m.direction === 'out' && fence) {
          var prose = String(m.text).slice(0, fence.index).trim();
          var after = String(m.text).slice(fence.index + fence[0].length).trim();
          var p = document.createElement('div'); collapsedText(p, prose); d.appendChild(p);
          var meta = document.createElement('div'); meta.className = 'ch-meta';
          meta.textContent = after ? after.split('\n').join(' · ') : 'answered just now';
          d.appendChild(meta);
          var det = document.createElement('details'); det.className = 'ch-workings';
          var sum = document.createElement('summary'); sum.textContent = 'show workings ▸';
          det.appendChild(sum);
          var sql = document.createElement('div'); sql.className = 'ch-sql'; sql.textContent = fence[1].trim();
          det.appendChild(sql);
          d.appendChild(det);
        } else {
          var body = document.createElement('div'); collapsedText(body, m.text); d.appendChild(body);
        }
        th.appendChild(d); d.scrollIntoView({ block: 'end' });
      }
      function poll(){
        var jobs = Array.prototype.map.call(document.querySelectorAll('[data-jobchip]'), function(el){ return el.getAttribute('data-jobchip'); });
        fetch('/api/chat-updates?after=' + last + (jobs.length ? '&jobs=' + jobs.slice(0, 20).join(',') : ''))
          .then(function(r){ return r.json(); })
          .then(function(r){
            if (!r || !r.ok) return;
            // stale-tab self-heal: the server rev changed (a deploy) → reload for the new page code,
            // but NEVER over a half-typed message.
            var myRev = document.getElementById('ch-thread') ? document.getElementById('ch-thread').dataset.rev : '';
            var ta2 = document.getElementById('ch-text');
            if (r.rev && myRev && r.rev !== myRev && (!ta2 || !ta2.value.trim())) { location.reload(); return; }
            (r.messages || []).forEach(function(m){ if (m.id > last) { addMsg(m); last = m.id; } });
            Object.keys(r.jobs || {}).forEach(function(id){
              var chip = document.querySelector('[data-jobchip="' + id + '"]'); if (!chip) return;
              var st = r.jobs[id];
              if (['done','failed','escalated'].indexOf(st) !== -1) chip.remove(); else chip.textContent = st + '…';
            });
          }).catch(function(){});
      }
      setInterval(poll, 3000);
    })();</script>`);

    return { stamp: `web transport · ${m.total} messages · short-poll 3s`, body: parts.join('\n') };
  },
};
