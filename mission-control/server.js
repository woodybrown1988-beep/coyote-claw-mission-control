'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const HOST = '127.0.0.1';
const DEFAULT_PORT = 8787;
const CODEX_SUBSCRIPTION_USD = 200;
const DEFAULT_CEILING_PENCE = 7500;
const RATE_STALE_DAYS = 90;
const MONTH_MODE = 'UTC';
const ACTIVE_STATUSES = [
  'active',
  'executing',
  'in-flight',
  'in_flight',
  'in progress',
  'in_progress',
  'processing',
  'running',
  'started'
];

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = process.env.COYOTE_CLAW_DB || path.join(ROOT, 'data', 'librarian.db');
const RATES_PATH = path.join(ROOT, 'config', 'api-rates.json');

function main() {
  const port = readPort(process.env.MISSION_CONTROL_PORT);
  const server = http.createServer(handleRequest);

  server.on('error', (error) => {
    const code = error && error.code ? error.code : 'UNKNOWN';
    console.error(`Mission Control failed to start (${code}).`);
    process.exitCode = 1;
  });

  server.listen(port, HOST, () => {
    console.log(`Mission Control listening on http://${HOST}:${port}`);
  });
}

function handleRequest(req, res) {
  const url = new URL(req.url, `http://${HOST}`);

  if (req.method !== 'GET') {
    sendText(res, 405, 'Method not allowed');
    return;
  }

  if (url.pathname === '/health') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (url.pathname !== '/') {
    sendText(res, 404, 'Not found');
    return;
  }

  const model = buildDashboardModel();
  sendHtml(res, 200, renderDashboard(model));
}

function buildDashboardModel() {
  const monthStartMs = getMonthStartMs(new Date());
  const rates = readRates();
  const opened = openDatabase();

  if (!opened.ok) {
    return {
      ok: false,
      monthStartMs,
      monthMode: MONTH_MODE,
      rates,
      error: opened.message,
      sections: emptySections()
    };
  }

  const db = opened.db;

  try {
    const sections = {
      queue: getQueueSection(db),
      worker: getWorkerSection(db),
      spend: getSpendSection(db, monthStartMs),
      tokens: getTokenSection(db, monthStartMs, rates),
      outcomes: getOutcomesSection(db)
    };

    return {
      ok: true,
      monthStartMs,
      monthMode: MONTH_MODE,
      rates,
      sections
    };
  } finally {
    try {
      db.close();
    } catch (_) {
      // Closing failure is not user-actionable and must not leak internals.
    }
  }
}

function emptySections() {
  return {
    queue: unavailable('Database unavailable'),
    worker: unavailable('Database unavailable'),
    spend: unavailable('Database unavailable'),
    tokens: unavailable('Database unavailable'),
    outcomes: unavailable('Database unavailable')
  };
}

function openDatabase() {
  let sqlite;
  try {
    sqlite = require('node:sqlite');
  } catch (_) {
    return { ok: false, message: 'node:sqlite is unavailable in this Node.js runtime.' };
  }

  if (!fs.existsSync(DB_PATH)) {
    return { ok: false, message: 'Librarian database is unavailable.' };
  }

  try {
    return { ok: true, db: new sqlite.DatabaseSync(DB_PATH, { readOnly: true }) };
  } catch (readOnlyError) {
    try {
      return { ok: true, db: new sqlite.DatabaseSync(DB_PATH) };
    } catch (_) {
      return { ok: false, message: 'Librarian database could not be opened read-only.' };
    }
  }
}

function getQueueSection(db) {
  const counts = safeSelect(db, `
    SELECT status, COUNT(*) AS count
    FROM jobs
    GROUP BY status
    ORDER BY count DESC, status ASC
  `);

  const recentJobs = safeSelect(db, `
    SELECT id, type, status, attempts, created_at, updated_at
    FROM jobs
    ORDER BY COALESCE(updated_at, created_at, 0) DESC
    LIMIT 20
  `);

  if (!counts.ok && !recentJobs.ok) {
    return unavailable('Job queue tables are unavailable.');
  }

  return {
    ok: true,
    counts: counts.ok ? counts.rows.map((row) => ({
      status: safeLabel(row.status, 'unknown'),
      count: toInteger(row.count)
    })) : [],
    recentJobs: recentJobs.ok ? recentJobs.rows.map((row) => ({
      id: shortId(row.id),
      type: safeLabel(row.type, 'unknown'),
      status: safeLabel(row.status, 'unknown'),
      attempts: toInteger(row.attempts),
      createdAt: toMs(row.created_at),
      updatedAt: toMs(row.updated_at)
    })) : [],
    warnings: collectWarnings([
      counts.ok ? null : 'Job status counts unavailable.',
      recentJobs.ok ? null : 'Recent jobs unavailable.'
    ])
  };
}

function getWorkerSection(db) {
  const explicit = safeSelect(db, `
    SELECT key, value, updated_at
    FROM system_state
    WHERE key IN (
      'worker_active',
      'worker_last_activity',
      'worker_last_activity_ms',
      'worker_heartbeat',
      'worker_current_job',
      'worker_current_job_id',
      'worker_inflight_job_id',
      'worker_in_flight_job_id'
    )
  `);

  const state = explicit.ok ? mapSystemState(explicit.rows) : new Map();
  const explicitActive = firstStateValue(state, ['worker_active']);
  const explicitLastActivity = firstStateValue(state, [
    'worker_last_activity_ms',
    'worker_last_activity',
    'worker_heartbeat'
  ]);
  const explicitCurrentJob = firstStateValue(state, [
    'worker_current_job_id',
    'worker_current_job',
    'worker_inflight_job_id',
    'worker_in_flight_job_id'
  ]);

  if (explicit.ok && (explicitActive !== null || explicitLastActivity !== null || explicitCurrentJob !== null)) {
    return {
      ok: true,
      derived: false,
      active: parseBooleanLike(explicitActive),
      lastActivity: toMs(explicitLastActivity),
      currentJob: shortId(explicitCurrentJob),
      warnings: collectWarnings([
        explicitActive === null ? 'Worker active flag missing.' : null,
        explicitLastActivity === null ? 'Worker heartbeat timestamp missing.' : null,
        explicitCurrentJob === null ? 'Current in-flight job missing.' : null
      ])
    };
  }

  const activeJob = safeSelect(db, `
    SELECT id, status, updated_at, created_at
    FROM jobs
    WHERE lower(status) IN (
      'active',
      'executing',
      'in-flight',
      'in_flight',
      'in progress',
      'in_progress',
      'processing',
      'running',
      'started'
    )
    ORDER BY COALESCE(updated_at, created_at, 0) DESC
    LIMIT 1
  `);

  const jobActivity = safeSelect(db, `
    SELECT MAX(COALESCE(updated_at, created_at, 0)) AS last_activity
    FROM jobs
  `);

  const eventActivity = safeSelect(db, `
    SELECT MAX(created_at) AS last_activity
    FROM job_events
  `);

  if (!activeJob.ok && !jobActivity.ok && !eventActivity.ok) {
    return unavailable('Worker status cannot be derived from available tables.');
  }

  const active = activeJob.ok && activeJob.rows.length > 0;
  const activeRow = active ? activeJob.rows[0] : null;
  const lastActivity = Math.max(
    jobActivity.ok ? toMs(jobActivity.rows[0] && jobActivity.rows[0].last_activity) : 0,
    eventActivity.ok ? toMs(eventActivity.rows[0] && eventActivity.rows[0].last_activity) : 0
  );

  return {
    ok: true,
    derived: true,
    active,
    lastActivity,
    currentJob: activeRow ? shortId(activeRow.id) : '',
    warnings: collectWarnings([
      explicit.ok ? null : 'No explicit worker heartbeat keys found.',
      activeJob.ok ? null : 'Active job lookup unavailable.',
      jobActivity.ok || eventActivity.ok ? null : 'Last activity unavailable.'
    ])
  };
}

function getSpendSection(db, monthStartMs) {
  const ceiling = getMonthlyCeilingPence(db);
  const spend = safeSelect(db, `
    SELECT COALESCE(SUM(sl.cost_pence), 0) AS total_pence
    FROM spend_log sl
    LEFT JOIN jobs j ON j.id = sl.job_id
    WHERE sl.created_at >= ?
      AND (
        lower(COALESCE(sl.note, '')) LIKE '%claude%'
        OR lower(COALESCE(j.type, '')) LIKE '%claude%'
      )
      AND lower(COALESCE(sl.note, '')) NOT LIKE '%codex%'
      AND lower(COALESCE(j.type, '')) NOT LIKE '%codex%'
  `, [monthStartMs]);

  if (!spend.ok) {
    return unavailable('Claude-metered spend cannot be read. Spend rows must identify Claude API usage by note or job type.');
  }

  const totalPence = toInteger(spend.rows[0] && spend.rows[0].total_pence);
  const percent = ceiling > 0 ? (totalPence / ceiling) * 100 : 0;

  return {
    ok: true,
    label: 'Metered spend (Claude API)',
    totalPence,
    ceilingPence: ceiling,
    percent,
    level: spendLevel(percent),
    warnings: [
      'Codex is excluded from this GBP metered total; Codex subscription economics are shown separately.'
    ]
  };
}

function getMonthlyCeilingPence(db) {
  const result = safeSelect(db, `
    SELECT value
    FROM system_state
    WHERE key = 'monthly_ceiling_pence'
    LIMIT 1
  `);

  if (!result.ok || result.rows.length === 0) {
    return DEFAULT_CEILING_PENCE;
  }

  const parsed = toInteger(result.rows[0].value);
  return parsed > 0 ? parsed : DEFAULT_CEILING_PENCE;
}

function getTokenSection(db, monthStartMs, rates) {
  const rows = safeSelect(db, `
    SELECT jtu.job_id, COALESCE(j.type, '') AS type, jtu.input_tokens, jtu.output_tokens,
           jtu.total_tokens, jtu.created_at
    FROM job_token_usage jtu
    LEFT JOIN jobs j ON j.id = jtu.job_id
    WHERE lower(jtu.engine) = 'codex'
    ORDER BY jtu.created_at DESC
    LIMIT 50
  `);

  const totals = safeSelect(db, `
    SELECT COALESCE(SUM(input_tokens), 0) AS input_tokens,
           COALESCE(SUM(output_tokens), 0) AS output_tokens,
           COALESCE(SUM(total_tokens), 0) AS total_tokens
    FROM job_token_usage
    WHERE lower(engine) = 'codex'
      AND created_at >= ?
  `, [monthStartMs]);

  if (!rows.ok && !totals.ok) {
    return unavailable('Codex token usage table is unavailable. Create job_token_usage and record worker token usage first.');
  }

  const tokenTotals = totals.ok ? {
    input: toInteger(totals.rows[0] && totals.rows[0].input_tokens),
    output: toInteger(totals.rows[0] && totals.rows[0].output_tokens),
    total: toInteger(totals.rows[0] && totals.rows[0].total_tokens)
  } : { input: 0, output: 0, total: 0 };

  const estimated = rates.ok ? estimateApiCost(tokenTotals, rates.gpt55) : null;

  return {
    ok: true,
    rows: rows.ok ? rows.rows.map((row) => ({
      id: shortId(row.job_id),
      type: safeLabel(row.type, 'unknown'),
      input: toInteger(row.input_tokens),
      output: toInteger(row.output_tokens),
      total: toInteger(row.total_tokens),
      createdAt: toMs(row.created_at)
    })) : [],
    totals: tokenTotals,
    rates,
    estimatedApiCostUsd: estimated,
    subscriptionUsd: CODEX_SUBSCRIPTION_USD,
    differenceUsd: estimated === null ? null : CODEX_SUBSCRIPTION_USD - estimated,
    warnings: collectWarnings([
      rows.ok ? null : 'Per-job Codex token rows unavailable.',
      totals.ok ? null : 'MTD Codex token totals unavailable.',
      rates.ok ? null : rates.message
    ])
  };
}

function getOutcomesSection(db) {
  const result = safeSelect(db, `
    SELECT job_id, kind, actor, gate, decision, detail, created_at
    FROM job_events
    ORDER BY created_at DESC
    LIMIT 50
  `);

  if (!result.ok) {
    return unavailable('Job event trail is unavailable.');
  }

  return {
    ok: true,
    events: result.rows.map((row) => ({
      createdAt: toMs(row.created_at),
      jobId: shortId(row.job_id),
      kind: safeLabel(row.kind, ''),
      actor: safeLabel(row.actor, ''),
      gate: safeLabel(row.gate, ''),
      decision: safeLabel(row.decision, ''),
      summary: summarizeDetail(row)
    })),
    warnings: []
  };
}

function safeSelect(db, sql, params = []) {
  const normalized = sql.trim().replace(/\s+/g, ' ').toLowerCase();
  if (!normalized.startsWith('select ')) {
    return { ok: false, rows: [] };
  }

  try {
    const statement = db.prepare(sql);
    return { ok: true, rows: statement.all(...params) };
  } catch (_) {
    return { ok: false, rows: [] };
  }
}

function readRates() {
  let raw;
  try {
    raw = fs.readFileSync(RATES_PATH, 'utf8');
  } catch (_) {
    return { ok: false, message: 'GPT-5.5 rates unavailable.' };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_) {
    return { ok: false, message: 'GPT-5.5 rates invalid.' };
  }

  const gpt55 = parsed && parsed['gpt-5.5'];
  if (!gpt55 || typeof gpt55 !== 'object') {
    return { ok: false, message: 'GPT-5.5 rates unavailable.' };
  }

  const asOf = parseIsoDate(gpt55.as_of);
  const input = Number(gpt55.input_usd_per_1m_tokens);
  const output = Number(gpt55.output_usd_per_1m_tokens);

  if (!asOf || !Number.isFinite(input) || !Number.isFinite(output) || input < 0 || output < 0) {
    return { ok: false, message: 'GPT-5.5 rates invalid.' };
  }

  const ageMs = Date.now() - asOf.getTime();
  const staleMs = RATE_STALE_DAYS * 24 * 60 * 60 * 1000;
  if (ageMs < 0 || ageMs > staleMs) {
    return { ok: false, message: 'GPT-5.5 rates stale.' };
  }

  return {
    ok: true,
    gpt55: {
      asOf: gpt55.as_of,
      inputUsdPer1mTokens: input,
      outputUsdPer1mTokens: output
    }
  };
}

function renderDashboard(model) {
  const queue = model.sections.queue;
  const worker = model.sections.worker;
  const spend = model.sections.spend;
  const tokens = model.sections.tokens;
  const outcomes = model.sections.outcomes;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Coyote Claw Mission Control</title>
  <style>${css()}</style>
</head>
<body>
  <main class="shell">
    <header class="masthead">
      <div>
        <p class="eyebrow">Local read-only dashboard</p>
        <h1>Mission Control</h1>
      </div>
      <div class="meta">
        <span>Bound to 127.0.0.1</span>
        <span>Month mode: ${escapeHtml(model.monthMode)}</span>
        <span>Month starts <time data-ms="${model.monthStartMs}">${formatUtc(model.monthStartMs)}</time></span>
      </div>
    </header>

    ${model.ok ? '' : `<section class="banner">${escapeHtml(model.error)}</section>`}

    <section class="hero-grid">
      ${renderQueue(queue)}
      ${renderWorker(worker)}
    </section>

    ${renderSpend(spend)}
    ${renderTokens(tokens)}
    ${renderOutcomes(outcomes)}
  </main>
  <script>
    for (const el of document.querySelectorAll('time[data-ms]')) {
      const ms = Number(el.dataset.ms);
      if (Number.isFinite(ms) && ms > 0) {
        el.textContent = new Date(ms).toLocaleString();
      }
    }
  </script>
</body>
</html>`;
}

function renderQueue(section) {
  if (!section.ok) {
    return renderUnavailableCard('Job Queue & States', section.message);
  }

  const countRows = section.counts.map((item) => `
    <div class="stat">
      <span>${escapeHtml(item.status)}</span>
      <strong>${formatInteger(item.count)}</strong>
    </div>
  `).join('');

  const jobRows = section.recentJobs.map((job) => `
    <tr>
      <td><code>${escapeHtml(job.id)}</code></td>
      <td>${escapeHtml(job.type)}</td>
      <td>${renderStatus(job.status)}</td>
      <td class="numeric">${formatInteger(job.attempts)}</td>
      <td>${renderTime(job.createdAt)}</td>
      <td>${renderTime(job.updatedAt)}</td>
    </tr>
  `).join('');

  return `
    <section class="panel hero">
      <div class="panel-head">
        <h2>Job Queue & States</h2>
        <p>Recent jobs omit result and error payloads.</p>
      </div>
      <div class="stats">${countRows || '<p class="muted">No job statuses found.</p>'}</div>
      ${renderWarnings(section.warnings)}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Job</th>
              <th>Type</th>
              <th>Status</th>
              <th>Attempts</th>
              <th>Created</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>${jobRows || '<tr><td colspan="6" class="empty">No recent jobs.</td></tr>'}</tbody>
        </table>
      </div>
    </section>
  `;
}

function renderWorker(section) {
  if (!section.ok) {
    return renderUnavailableCard('Worker Status', section.message);
  }

  const activeText = section.active === null ? 'unknown' : (section.active ? 'yes' : 'no');
  const source = section.derived ? 'derived, not authoritative' : 'explicit worker state';

  return `
    <section class="panel hero">
      <div class="panel-head">
        <h2>Worker Status</h2>
        <p>${escapeHtml(source)}</p>
      </div>
      <div class="worker-grid">
        <div>
          <span class="label">Active?</span>
          <strong class="big">${escapeHtml(activeText)}</strong>
        </div>
        <div>
          <span class="label">Last activity</span>
          <strong>${renderTime(section.lastActivity)}</strong>
        </div>
        <div>
          <span class="label">Current in-flight job</span>
          <strong><code>${escapeHtml(section.currentJob || 'none')}</code></strong>
        </div>
      </div>
      ${renderWarnings(section.warnings)}
    </section>
  `;
}

function renderSpend(section) {
  if (!section.ok) {
    return renderUnavailableSection('Metered Spend', section.message);
  }

  const pct = Math.min(Math.max(section.percent, 0), 100);

  return `
    <section class="panel">
      <div class="panel-head">
        <h2>${escapeHtml(section.label)}</h2>
        <p>GBP 75/month ceiling applies only to Claude API marginal spend.</p>
      </div>
      <div class="spend-grid">
        <div>
          <span class="label">MTD metered spend</span>
          <strong class="big">${formatGbp(section.totalPence)}</strong>
        </div>
        <div>
          <span class="label">Ceiling</span>
          <strong>${formatGbp(section.ceilingPence)}</strong>
        </div>
        <div>
          <span class="label">Progress</span>
          <strong>${formatPercent(section.percent)}</strong>
        </div>
        <div>
          <span class="label">Level</span>
          <strong class="level ${escapeHtml(section.level)}">${escapeHtml(section.level)}</strong>
        </div>
      </div>
      <div class="meter" aria-label="Metered spend progress">
        <span class="${escapeHtml(section.level)}" style="width: ${pct.toFixed(2)}%"></span>
      </div>
      ${renderWarnings(section.warnings)}
    </section>
  `;
}

function renderTokens(section) {
  if (!section.ok) {
    return renderUnavailableSection('Token Tracking + Cost Comparison', section.message);
  }

  const rows = section.rows.map((row) => `
    <tr>
      <td><code>${escapeHtml(row.id)}</code></td>
      <td>${escapeHtml(row.type)}</td>
      <td class="numeric">${formatInteger(row.input)}</td>
      <td class="numeric">${formatInteger(row.output)}</td>
      <td class="numeric">${formatInteger(row.total)}</td>
      <td>${renderTime(row.createdAt)}</td>
    </tr>
  `).join('');

  const estimate = section.estimatedApiCostUsd === null
    ? 'rates unavailable'
    : `~${formatUsd(section.estimatedApiCostUsd)}`;
  const difference = section.differenceUsd === null
    ? 'rates unavailable'
    : renderDifference(section.differenceUsd);

  return `
    <section class="panel">
      <div class="panel-head">
        <h2>Token Tracking + Cost Comparison</h2>
        <p>Separate from the GBP Claude API ceiling.</p>
      </div>
      <div class="token-summary">
        <div>
          <span class="label">MTD input tokens</span>
          <strong>${formatInteger(section.totals.input)}</strong>
        </div>
        <div>
          <span class="label">MTD output tokens</span>
          <strong>${formatInteger(section.totals.output)}</strong>
        </div>
        <div>
          <span class="label">MTD total tokens</span>
          <strong>${formatInteger(section.totals.total)}</strong>
        </div>
      </div>
      <div class="comparison">
        <p><strong>Codex subscription:</strong> USD 200 flat-rate</p>
        <p><strong>Estimated GPT-5.5 API cost at this volume:</strong> ${escapeHtml(estimate)}</p>
        <p><strong>Difference:</strong> ${difference}</p>
      </div>
      ${renderWarnings(section.warnings)}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Job</th>
              <th>Type</th>
              <th>Input tokens</th>
              <th>Output tokens</th>
              <th>Total tokens</th>
              <th>Recorded</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="6" class="empty">No Codex token rows recorded yet.</td></tr>'}</tbody>
        </table>
      </div>
    </section>
  `;
}

function renderOutcomes(section) {
  if (!section.ok) {
    return renderUnavailableSection('Outcomes', section.message);
  }

  const rows = section.events.map((event) => `
    <tr>
      <td>${renderTime(event.createdAt)}</td>
      <td><code>${escapeHtml(event.jobId)}</code></td>
      <td>${escapeHtml(event.kind)}</td>
      <td>${escapeHtml(event.actor)}</td>
      <td>${escapeHtml(event.gate)}</td>
      <td>${escapeHtml(event.decision)}</td>
      <td>${escapeHtml(event.summary)}</td>
    </tr>
  `).join('');

  return `
    <section class="panel">
      <div class="panel-head">
        <h2>Outcomes</h2>
        <p>Recent gate trail with summarized event detail only.</p>
      </div>
      ${renderWarnings(section.warnings)}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Job</th>
              <th>Kind</th>
              <th>Actor</th>
              <th>Gate</th>
              <th>Decision</th>
              <th>Detail summary</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="7" class="empty">No recent events.</td></tr>'}</tbody>
        </table>
      </div>
    </section>
  `;
}

function renderUnavailableCard(title, message) {
  return `
    <section class="panel hero unavailable">
      <div class="panel-head">
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(message)}</p>
      </div>
    </section>
  `;
}

function renderUnavailableSection(title, message) {
  return `
    <section class="panel unavailable">
      <div class="panel-head">
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(message)}</p>
      </div>
    </section>
  `;
}

function renderWarnings(warnings) {
  if (!warnings || warnings.length === 0) {
    return '';
  }

  return `
    <ul class="warnings">
      ${warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}
    </ul>
  `;
}

function renderStatus(status) {
  const name = safeLabel(status, 'unknown');
  const active = ACTIVE_STATUSES.includes(name.toLowerCase());
  return `<span class="pill ${active ? 'active' : ''}">${escapeHtml(name)}</span>`;
}

function renderTime(ms) {
  if (!ms) {
    return '<span class="muted">unknown</span>';
  }

  return `<time data-ms="${ms}">${escapeHtml(formatUtc(ms))}</time>`;
}

function renderDifference(diff) {
  if (diff > 0) {
    return `subscription is ${escapeHtml(formatUsd(diff))} above estimated metered API`;
  }

  if (diff < 0) {
    return `subscription is ${escapeHtml(formatUsd(Math.abs(diff)))} below estimated metered API`;
  }

  return 'subscription equals estimated metered API cost';
}

function summarizeDetail(row) {
  const kind = String(row.kind || '').toLowerCase();
  const gate = String(row.gate || '').toLowerCase();
  const decision = String(row.decision || '').toLowerCase();
  const corrected = kind === 'corrected' || gate === 'corrected' || decision === 'corrected';
  const detail = parseJsonObject(row.detail);

  if (corrected) {
    if (detail && typeof detail.note === 'string' && detail.note.trim()) {
      return limitText(detail.note.trim(), 180);
    }
    return 'Correction note missing';
  }

  if (!detail) {
    return row.detail ? 'Unstructured detail omitted' : '';
  }

  for (const key of ['summary', 'note', 'reason', 'message']) {
    if (typeof detail[key] === 'string' && detail[key].trim()) {
      return limitText(detail[key].trim(), 180);
    }
  }

  const keys = Object.keys(detail).filter((key) => !looksSensitive(key));
  if (keys.length === 0) {
    return 'Detail omitted';
  }

  return `${keys.length} detail field${keys.length === 1 ? '' : 's'} omitted`;
}

function mapSystemState(rows) {
  const map = new Map();
  for (const row of rows) {
    if (typeof row.key === 'string') {
      map.set(row.key, row.value);
    }
  }
  return map;
}

function firstStateValue(state, keys) {
  for (const key of keys) {
    if (state.has(key)) {
      return state.get(key);
    }
  }
  return null;
}

function parseBooleanLike(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'active', 'online', 'running'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'inactive', 'offline', 'stopped'].includes(normalized)) {
    return false;
  }

  return null;
}

function estimateApiCost(totals, rates) {
  return (totals.input / 1000000) * rates.inputUsdPer1mTokens
    + (totals.output / 1000000) * rates.outputUsdPer1mTokens;
}

function spendLevel(percent) {
  if (percent >= 100) {
    return 'hardstop';
  }
  if (percent >= 80) {
    return 'warn80';
  }
  if (percent >= 50) {
    return 'warn50';
  }
  return 'ok';
}

function getMonthStartMs(date) {
  if (MONTH_MODE === 'UTC') {
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  }
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}

function parseIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseJsonObject(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

function looksSensitive(key) {
  return /secret|token|key|password|credential|env|payload|result|error/i.test(key);
}

function safeLabel(value, fallback) {
  if (value === null || value === undefined) {
    return fallback;
  }

  const text = String(value).trim();
  return text ? limitText(text, 80) : fallback;
}

function shortId(value) {
  if (value === null || value === undefined) {
    return '';
  }

  const text = String(value).trim();
  if (!text) {
    return '';
  }

  return text.slice(0, 8);
}

function toInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

function toMs(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : 0;
}

function limitText(value, maxLength) {
  const singleLine = String(value).replace(/\s+/g, ' ').trim();
  if (singleLine.length <= maxLength) {
    return singleLine;
  }
  return `${singleLine.slice(0, maxLength - 1)}...`;
}

function collectWarnings(items) {
  return items.filter(Boolean);
}

function unavailable(message) {
  return { ok: false, message, warnings: [] };
}

function readPort(raw) {
  const parsed = Number(raw);
  if (Number.isInteger(parsed) && parsed > 0 && parsed < 65536) {
    return parsed;
  }
  return DEFAULT_PORT;
}

function sendHtml(res, status, body) {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(body);
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(JSON.stringify(body));
}

function sendText(res, status, body) {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(body);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatUtc(ms) {
  if (!ms) {
    return 'unknown';
  }
  return new Date(ms).toISOString().replace('T', ' ').replace('.000Z', ' UTC');
}

function formatInteger(value) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(toInteger(value));
}

function formatGbp(pence) {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP'
  }).format(toInteger(pence) / 100);
}

function formatUsd(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(value));
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function css() {
  return `
    :root {
      color-scheme: light;
      --bg: #f7f8fa;
      --panel: #ffffff;
      --text: #18202a;
      --muted: #647084;
      --line: #d8dde6;
      --accent: #1769aa;
      --ok: #1d7f4c;
      --warn50: #a86500;
      --warn80: #a84700;
      --hardstop: #b42318;
      --soft: #eef4fb;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.45;
    }

    .shell {
      width: min(1440px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 28px 0 44px;
    }

    .masthead {
      display: flex;
      align-items: end;
      justify-content: space-between;
      gap: 20px;
      margin-bottom: 20px;
    }

    .eyebrow {
      margin: 0 0 4px;
      color: var(--muted);
      font-size: 13px;
      font-weight: 700;
      letter-spacing: .04em;
      text-transform: uppercase;
    }

    h1, h2 {
      margin: 0;
      line-height: 1.1;
    }

    h1 {
      font-size: 32px;
    }

    h2 {
      font-size: 20px;
    }

    .meta {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 8px;
      color: var(--muted);
      font-size: 13px;
    }

    .meta span {
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 4px 10px;
      background: #fff;
    }

    .banner {
      margin-bottom: 16px;
      padding: 12px 14px;
      border: 1px solid #f1b8b3;
      border-radius: 8px;
      color: var(--hardstop);
      background: #fff5f4;
      font-weight: 700;
    }

    .hero-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.5fr) minmax(320px, .8fr);
      gap: 16px;
      margin-bottom: 16px;
    }

    .panel {
      margin-bottom: 16px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      padding: 18px;
      box-shadow: 0 1px 2px rgba(24, 32, 42, .04);
    }

    .hero {
      margin-bottom: 0;
      min-width: 0;
    }

    .panel-head {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: start;
      margin-bottom: 14px;
    }

    .panel-head p {
      margin: 2px 0 0;
      color: var(--muted);
      font-size: 13px;
      text-align: right;
    }

    .stats,
    .spend-grid,
    .token-summary,
    .worker-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 10px;
      margin-bottom: 14px;
    }

    .stat,
    .spend-grid > div,
    .token-summary > div,
    .worker-grid > div {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--soft);
      padding: 12px;
      min-width: 0;
    }

    .stat {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    .stat span,
    .label {
      display: block;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      overflow-wrap: anywhere;
    }

    strong {
      overflow-wrap: anywhere;
    }

    .big {
      display: block;
      font-size: 28px;
      margin-top: 4px;
    }

    .table-wrap {
      overflow-x: auto;
      border: 1px solid var(--line);
      border-radius: 8px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 720px;
      font-size: 13px;
    }

    th,
    td {
      padding: 10px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      vertical-align: top;
      overflow-wrap: anywhere;
    }

    th {
      color: var(--muted);
      background: #f2f4f7;
      font-size: 12px;
      text-transform: uppercase;
    }

    tr:last-child td {
      border-bottom: 0;
    }

    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
    }

    .numeric {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }

    .muted,
    .empty {
      color: var(--muted);
    }

    .pill,
    .level {
      display: inline-block;
      border-radius: 999px;
      padding: 3px 8px;
      background: #e8edf3;
      font-size: 12px;
      font-weight: 700;
    }

    .pill.active {
      color: #0b5a35;
      background: #dcf7e8;
    }

    .level.ok,
    .meter .ok {
      color: #0b5a35;
      background: var(--ok);
    }

    .level.warn50,
    .meter .warn50 {
      color: #6f4000;
      background: var(--warn50);
    }

    .level.warn80,
    .meter .warn80 {
      color: #713000;
      background: var(--warn80);
    }

    .level.hardstop,
    .meter .hardstop {
      color: #7a130d;
      background: var(--hardstop);
    }

    .level {
      color: #fff;
    }

    .meter {
      height: 12px;
      border-radius: 999px;
      background: #e8edf3;
      overflow: hidden;
      margin: 8px 0 12px;
    }

    .meter span {
      display: block;
      height: 100%;
    }

    .comparison {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 10px;
      margin-bottom: 14px;
    }

    .comparison p {
      margin: 0;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 12px;
      background: #fbfcfe;
    }

    .warnings {
      margin: 0 0 14px;
      padding: 10px 12px 10px 28px;
      border: 1px solid #f0d19a;
      border-radius: 8px;
      color: #6f4000;
      background: #fff8eb;
      font-size: 13px;
    }

    .unavailable {
      border-color: #f0d19a;
      background: #fffdf8;
    }

    @media (max-width: 860px) {
      .shell {
        width: min(100vw - 20px, 760px);
        padding-top: 18px;
      }

      .masthead,
      .panel-head {
        display: block;
      }

      .meta {
        justify-content: flex-start;
        margin-top: 12px;
      }

      .panel-head p {
        text-align: left;
      }

      .hero-grid {
        grid-template-columns: 1fr;
      }

      table {
        min-width: 680px;
      }
    }
  `;
}

if (require.main === module) {
  main();
}

module.exports = {
  buildDashboardModel,
  summarizeDetail,
  getMonthStartMs,
  spendLevel
};
