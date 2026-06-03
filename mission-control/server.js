import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
const STATIC_ROOT = path.resolve(__dirname, 'static');
const DB_PATH = process.env.COYOTE_CLAW_DB || path.join(ROOT, 'data', 'librarian.db');
const RATES_PATH = path.join(ROOT, 'config', 'api-rates.json');

function startServer() {
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

  if (url.pathname.startsWith('/static/')) {
    serveStatic(url.pathname, res);
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
      refreshedAt: Date.now(),
      sections: emptySections()
    };
  }

  const db = opened.db;

  try {
    const sections = {
      kpis: getKpiSection(db, monthStartMs),
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
      refreshedAt: Date.now(),
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
    kpis: unavailable('Database unavailable'),
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
  } catch (_) {
    return { ok: false, message: 'Librarian database could not be opened read-only.' };
  }
}

function getKpiSection(db, monthStartMs) {
  const dayStartMs = getUtcDayStartMs(new Date());
  const jobsToday = safeSelect(db, `
    SELECT COUNT(*) AS count
    FROM jobs
    WHERE COALESCE(created_at, updated_at, 0) >= ?
  `, [dayStartMs]);

  const activeJobs = safeSelect(db, `
    SELECT id, status, type, updated_at, created_at
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
      'started',
      'spec',
      'build'
    )
    ORDER BY COALESCE(updated_at, created_at, 0) DESC
    LIMIT 1
  `);

  const shippedToday = safeSelect(db, `
    SELECT COUNT(*) AS count
    FROM jobs
    WHERE COALESCE(updated_at, created_at, 0) >= ?
      AND lower(status) IN ('merged', 'complete', 'completed', 'done', 'shipped')
  `, [dayStartMs]);

  const gatesPassed = safeSelect(db, `
    SELECT COUNT(*) AS count
    FROM job_events
    WHERE lower(COALESCE(decision, kind, '')) IN (
      'approved',
      'accepted',
      'passed',
      'pass',
      'merge_fired',
      'spec_approved'
    )
  `);

  const gatesRefused = safeSelect(db, `
    SELECT COUNT(*) AS count
    FROM job_events
    WHERE lower(COALESCE(decision, kind, '')) IN (
      'refused',
      'rejected',
      'failed',
      'blocked',
      'merge_refused'
    )
  `);

  const openGates = safeSelect(db, `
    SELECT COUNT(*) AS count
    FROM job_events
    WHERE lower(COALESCE(decision, kind, '')) IN (
      'pending',
      'open',
      'awaiting',
      'awaiting_tap',
      'tap_pending'
    )
  `);

  if (!jobsToday.ok && !activeJobs.ok && !gatesPassed.ok && !openGates.ok) {
    return unavailable('KPI data is unavailable.');
  }

  const activeRow = activeJobs.ok && activeJobs.rows.length > 0 ? activeJobs.rows[0] : null;
  const activeStage = activeRow ? deriveStage(activeRow) : 'idle';
  const activeJob = activeRow ? shortId(activeRow.id) : '';

  return {
    ok: true,
    jobsToday: jobsToday.ok ? toInteger(jobsToday.rows[0] && jobsToday.rows[0].count) : 0,
    shippedToday: shippedToday.ok ? toInteger(shippedToday.rows[0] && shippedToday.rows[0].count) : 0,
    activeJobs: activeRow ? 1 : 0,
    gatesPassed: gatesPassed.ok ? toInteger(gatesPassed.rows[0] && gatesPassed.rows[0].count) : 0,
    gatesRefused: gatesRefused.ok ? toInteger(gatesRefused.rows[0] && gatesRefused.rows[0].count) : 0,
    openGates: openGates.ok ? toInteger(openGates.rows[0] && openGates.rows[0].count) : 0,
    activeStage,
    activeJob,
    monthStartMs,
    warnings: collectWarnings([
      jobsToday.ok ? null : 'Jobs-today count unavailable.',
      gatesPassed.ok ? null : 'Gate pass count unavailable.',
      openGates.ok ? null : 'Open gate count unavailable.'
    ])
  };
}

function getQueueSection(db) {
  const counts = safeSelect(db, `
    SELECT status, COUNT(*) AS count
    FROM jobs
    GROUP BY status
    ORDER BY count DESC, status ASC
  `);

  const recentJobs = safeSelect(db, `
    SELECT *
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
      engine: deriveEngine(row),
      stage: deriveStage(row),
      effort: deriveEffort(row),
      ref: deriveRef(row),
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
      name: 'coder-worker',
      engine: 'unknown',
      effort: 'unknown',
      stage: parseBooleanLike(explicitActive) ? 'active' : 'idle',
      timeoutSeconds: 1800,
      warnings: collectWarnings([
        explicitActive === null ? 'Worker active flag missing.' : null,
        explicitLastActivity === null ? 'Worker heartbeat timestamp missing.' : null,
        explicitCurrentJob === null ? 'Current in-flight job missing.' : null
      ])
    };
  }

  const activeJob = safeSelect(db, `
    SELECT *
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
      'started',
      'spec',
      'build'
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
    name: 'coder-worker',
    engine: activeRow ? deriveEngine(activeRow) : 'idle',
    effort: activeRow ? deriveEffort(activeRow) : 'idle',
    stage: activeRow ? deriveStage(activeRow) : 'idle',
    timeoutSeconds: activeRow && deriveStage(activeRow) === 'spec' ? 300 : 1800,
    warnings: collectWarnings([
      explicit.ok ? null : 'No explicit worker heartbeat keys found.',
      activeJob.ok ? null : 'Active job lookup unavailable.',
      jobActivity.ok || eventActivity.ok ? null : 'Last activity unavailable.'
    ])
  };
}

function getSpendSection(db, monthStartMs) {
  const ceiling = getMonthlyCeilingPence(db);
  const spendRows = safeSelect(db, `
    SELECT sl.cost_pence, COALESCE(sl.note, '') AS note, COALESCE(j.type, '') AS type
    FROM spend_log sl
    LEFT JOIN jobs j ON j.id = sl.job_id
    WHERE sl.created_at >= ?
  `, [monthStartMs]);

  if (!spendRows.ok) {
    return unavailable('Claude-metered spend cannot be read. Spend rows must identify Claude API usage by note or job type.');
  }

  const lines = summarizeSpendLines(spendRows.rows);
  const totalPence = lines.routerPence + lines.workerPence;
  const percent = ceiling > 0 ? (totalPence / ceiling) * 100 : 0;

  return {
    ok: true,
    label: 'Metered spend (Claude API)',
    totalPence,
    routerPence: lines.routerPence,
    workerPence: lines.workerPence,
    codexExcludedPence: lines.codexPence,
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
      summary: summarizeDetail(row),
      correction: summarizeCorrection(row),
      tone: eventTone(row)
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
  const kpis = model.sections.kpis;
  const queue = model.sections.queue;
  const worker = model.sections.worker;
  const spend = model.sections.spend;
  const tokens = model.sections.tokens;
  const outcomes = model.sections.outcomes;
  const renderedAt = Date.now();

  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Coyote Claw · Mission Control</title>
  <link rel="icon" type="image/svg+xml" href="/static/brand/claw.svg">
  <link rel="apple-touch-icon" href="/static/brand/claw-mark.png">
  <style>${css()}</style>
</head>
<body>
  ${renderHeader(model, worker)}
  ${model.ok ? '' : `<section class="banner fade">${escapeHtml(model.error)}</section>`}
  ${renderKpis(kpis, spend)}
  <div class="grid">
    <div class="stack">
      ${renderQueue(queue, renderedAt)}
      ${renderOutcomes(outcomes)}
    </div>
    <div class="stack">
      ${renderWorker(worker)}
      ${renderSpend(spend)}
      ${renderTokens(tokens)}
    </div>
  </div>
  <footer class="fade">COYOTE CLAW · MISSION CONTROL v1.1 · READ-ONLY · LOOPBACK · ${escapeHtml(HOST)}:${DEFAULT_PORT}</footer>
  <script>
    for (const el of document.querySelectorAll('time[data-ms]')) {
      const ms = Number(el.dataset.ms);
      if (Number.isFinite(ms) && ms > 0) {
        el.textContent = new Date(ms).toLocaleString();
      }
    }
    window.setTimeout(() => window.location.reload(), 30000);
  </script>
</body>
</html>`;
}

function renderHeader(model, worker) {
  const workerLive = worker.ok && worker.active === true;
  const workerLabel = worker.ok && worker.active === false ? 'IDLE' : (workerLive ? 'LIVE' : 'UNKNOWN');
  return `
    <header class="fade">
      <span class="mark">${renderClawSvg(46, 46, 'Coyote Claw')}</span>
      <span class="wordmark">
        <span class="t">Coyote Claw</span>
        <span class="s">Mission Control</span>
      </span>
      <div class="sys">
        <div class="sysitem"><span class="k">Daemon</span><span class="v"><span class="seal">SEALED ×4</span></span></div>
        <div class="sysitem"><span class="k">Worker</span><span class="v">${workerLive ? '<span class="pulse"></span>' : ''}${escapeHtml(workerLabel)}</span></div>
        <div class="sysitem"><span class="k">Refreshed</span><span class="v mono">${escapeHtml(formatClock(model.refreshedAt))}</span></div>
      </div>
    </header>
  `;
}

function renderKpis(section, spend) {
  const jobsToday = section.ok ? section.jobsToday : 0;
  const shippedToday = section.ok ? section.shippedToday : 0;
  const activeJobs = section.ok ? section.activeJobs : 0;
  const gatesPassed = section.ok ? section.gatesPassed : 0;
  const gatesRefused = section.ok ? section.gatesRefused : 0;
  const openGates = section.ok ? section.openGates : 0;
  const activeStage = section.ok ? section.activeStage : 'idle';
  const activeJob = section.ok ? section.activeJob : '';
  const gateTotal = gatesPassed + gatesRefused;
  const spendText = spend.ok ? formatGbp(spend.totalPence) : 'unavailable';
  const spendSub = spend.ok ? `of ${formatGbp(spend.ceilingPence)} cap · Codex excl.` : 'spend table unavailable';
  const active = activeStage !== 'idle' && activeStage !== 'unknown';

  return `
    <section class="kpis">
      <div class="kpi good fade"><span class="lab">Jobs Today</span><span class="val">${formatInteger(jobsToday)}</span><span class="sub g">${formatInteger(shippedToday)} shipped · ${formatInteger(activeJobs)} in flight</span></div>
      <div class="kpi good fade"><span class="lab">Gates Passed</span><span class="val">${formatInteger(gatesPassed)}/${formatInteger(gateTotal || gatesPassed)}</span><span class="sub">+ ${formatInteger(gatesRefused)} refused</span></div>
      <div class="kpi fade"><span class="lab">Metered Spend</span><span class="val">${escapeHtml(spendText)}</span><span class="sub">${escapeHtml(spendSub)}</span></div>
      <div class="kpi fade"><span class="lab">Open Gates</span><span class="val">${formatInteger(openGates)}</span><span class="sub">${openGates === 0 ? 'no taps pending' : 'tap review pending'}</span></div>
      <div class="kpi ${active ? 'live' : ''} fade"><span class="lab">Active Stage</span><span class="val stage-val">${active ? '<span class="pulse"></span>' : ''}${escapeHtml(activeStage.toUpperCase())}</span><span class="sub">${activeJob ? `job #${escapeHtml(activeJob)} · timeout ceiling only` : 'no active job'}</span></div>
    </section>
  `;
}

function renderQueue(section, renderedAt) {
  if (!section.ok) {
    return renderUnavailablePanel('Job Queue', section.message);
  }

  const jobRows = section.recentJobs.map((job) => `
    <tr>
      <td class="id">#${escapeHtml(job.id || 'unknown')}</td>
      <td class="age mono">${escapeHtml(formatJobAge(job.createdAt, renderedAt))}</td>
      <td class="title">${escapeHtml(job.type)}</td>
      <td>${renderStatusPill(job.status)}</td>
      <td class="eng">${escapeHtml(job.engine)}</td>
      <td class="mono stage ${escapeHtml(statusPillClass(job.status, job.stage))}">${escapeHtml(formatStage(job.stage, job.effort))}</td>
      <td class="ref">${escapeHtml(job.ref || '—')}</td>
    </tr>
  `).join('');

  return `
    <section class="panel fade">
      <div class="phead"><h2>Job Queue</h2><span class="count">${formatInteger(section.recentJobs.length)} shown</span></div>
      ${renderWarnings(section.warnings)}
      <div class="pbody table-wrap">
        <table>
          <thead><tr><th>ID</th><th>Age</th><th>Job</th><th>State</th><th>Engine</th><th>Stage</th><th>Ref</th></tr></thead>
          <tbody>${jobRows || '<tr><td colspan="7" class="empty-row">No recent jobs.</td></tr>'}</tbody>
        </table>
      </div>
    </section>
  `;
}

function renderWorker(section) {
  if (!section.ok) {
    return renderUnavailablePanel('Workers', section.message);
  }

  const active = section.active === true;
  const stage = section.stage || (active ? 'active' : 'idle');

  return `
    <section class="panel fade">
      <div class="phead"><h2>Workers</h2><span class="count">${active ? '1 active' : 'idle'}</span></div>
      <div class="heroes">
        <div class="hero ${active ? 'active' : ''}">
          <div class="row1">${active ? '<span class="pulse"></span>' : ''}<span class="name">${escapeHtml(section.name || 'coder-worker')}</span>${renderStatusPill(stage)}</div>
          <div class="meta">
            <div class="m"><span class="mk">Job</span><span class="mv">${section.currentJob ? `#${escapeHtml(section.currentJob)}` : 'none'}</span></div>
            <div class="m"><span class="mk">Engine</span><span class="mv">${escapeHtml(section.engine || 'unknown')}</span></div>
            <div class="m"><span class="mk">Effort</span><span class="mv">${escapeHtml(section.effort || 'unknown')}</span></div>
            <div class="m"><span class="mk">Timeout</span><span class="mv">ceiling ${escapeHtml(formatTimeout(section.timeoutSeconds))}</span></div>
            <div class="m"><span class="mk">Last Activity</span><span class="mv">${escapeHtml(formatClock(section.lastActivity))}</span></div>
          </div>
          <div class="bar" aria-label="Worker stage indicator"><i style="width:${stageProgressPercent(stage)}%"></i></div>
        </div>
      </div>
      ${renderWarnings(section.warnings)}
    </section>
  `;
}

function renderSpend(section) {
  if (!section.ok) {
    return renderUnavailablePanel('Metered Spend', section.message);
  }

  const pct = Math.min(Math.max(section.percent, 0), 100);
  const remaining = Math.max(section.ceilingPence - section.totalPence, 0);

  return `
    <section class="panel fade">
      <div class="phead"><h2>Metered Spend</h2><span class="count">£ only</span></div>
      <div class="spend">
        <div class="line"><span class="l">Router · Claude metered</span><span class="r">${formatGbp(section.routerPence)}</span></div>
        <div class="line"><span class="l">Worker · Claude builds</span><span class="r">${formatGbp(section.workerPence)}</span></div>
        <div class="line excl"><span class="l">Codex builds · OAuth</span><span class="r">excluded</span></div>
        <div class="tot"><span class="l">Total metered</span><span class="r">${formatGbp(section.totalPence)}</span></div>
        <div>
          <div class="cap" aria-label="Metered spend cap usage"><i class="${escapeHtml(section.level)}" style="width:${pct.toFixed(2)}%"></i></div>
          <p class="note" style="margin-top:.4rem">${formatGbp(remaining)} remaining of ${formatGbp(section.ceilingPence)} router cap. Codex draws shared ChatGPT quota — no £-ledger entry, deliberately excluded so spend isn't overstated.</p>
        </div>
      </div>
      ${renderWarnings(section.warnings)}
    </section>
  `;
}

function renderTokens(section) {
  if (!section.ok) {
    return renderUnavailablePanel('Token Usage', section.message);
  }

  if (section.rows.length === 0) {
    return `
      <section class="panel fade">
        <div class="phead"><h2>Token Usage</h2><span class="count">job_token_usage</span></div>
        <div class="empty">
          <span class="glyph">${renderTokenGlyph()}</span>
          <span class="h">Awaiting first instrumented job</span>
          <span class="p">Panel built to the job_token_usage contract. Capture lands with worker token-instrumentation — cached-input 90%-off accounted, output-weighted so API cost isn't overstated.</span>
        </div>
        ${renderWarnings(section.warnings)}
      </section>
    `;
  }

  const rows = section.rows.map((row) => `
    <tr>
      <td class="id">#${escapeHtml(row.id)}</td>
      <td class="title">${escapeHtml(row.type)}</td>
      <td class="mono">${formatInteger(row.input)}</td>
      <td class="mono">${formatInteger(row.output)}</td>
      <td class="mono">${formatInteger(row.total)}</td>
    </tr>
  `).join('');

  const estimate = section.estimatedApiCostUsd === null
    ? 'rates unavailable'
    : `~${formatUsd(section.estimatedApiCostUsd)}`;
  const difference = section.differenceUsd === null
    ? 'rates unavailable'
    : renderDifference(section.differenceUsd);

  return `
    <section class="panel fade">
      <div class="phead"><h2>Token Usage</h2><span class="count">job_token_usage</span></div>
      <div class="token-live">
        <div><span class="mk">Input</span><span class="mv">${formatInteger(section.totals.input)}</span></div>
        <div><span class="mk">Output</span><span class="mv">${formatInteger(section.totals.output)}</span></div>
        <div><span class="mk">Total</span><span class="mv">${formatInteger(section.totals.total)}</span></div>
      </div>
      <p class="note token-note">Codex subscription: USD 200 flat-rate. Estimated GPT-5.5 API cost at this volume: ${escapeHtml(estimate)}. ${difference}</p>
      ${renderWarnings(section.warnings)}
      <div class="pbody table-wrap">
        <table>
          <thead>
            <tr>
              <th>Job</th>
              <th>Type</th>
              <th>Input tokens</th>
              <th>Output tokens</th>
              <th>Total tokens</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>
  `;
}

function renderOutcomes(section) {
  if (!section.ok) {
    return renderUnavailablePanel('Outcomes · Gate Trail', section.message);
  }

  const events = section.events.map((event) => `
    <div class="ev ${escapeHtml(event.tone)}">
      <span class="ts">${escapeHtml(formatEventTime(event.createdAt))}</span>
      <span class="dot"></span>
      <div class="body">
        <div class="m">job <b>#${escapeHtml(event.jobId || 'unknown')}</b> ${escapeHtml(event.kind || event.decision || 'event')} — ${escapeHtml(event.summary || 'no detail')}</div>
        ${event.correction ? `<div class="corr">correction: ${escapeHtml(event.correction)}</div>` : ''}
      </div>
    </div>
  `).join('');

  return `
    <section class="panel fade">
      <div class="phead"><h2>Outcomes · Gate Trail</h2><span class="count">learning signal</span></div>
      ${renderWarnings(section.warnings)}
      <div class="events">${events || '<div class="empty-row">No recent events.</div>'}</div>
    </section>
  `;
}

function renderUnavailablePanel(title, message) {
  return `
    <section class="panel fade unavailable">
      <div class="phead"><h2>${escapeHtml(title)}</h2><span class="count">unavailable</span></div>
      <p class="note unavailable-note">${escapeHtml(message)}</p>
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

function renderStatusPill(status) {
  const name = safeLabel(status, 'unknown');
  return `<span class="pill ${escapeHtml(statusPillClass(name, name))}">${escapeHtml(name)}</span>`;
}

function renderTime(ms) {
  if (!ms) {
    return '<span class="muted">unknown</span>';
  }

  return `<time data-ms="${ms}">${escapeHtml(formatUtc(ms))}</time>`;
}

function renderClawSvg(width, height, label) {
  return `<svg width="${width}" height="${height}" viewBox="0 0 100 100" aria-label="${escapeHtml(label)}">
      <g fill="#8A9AB5">
        <polygon points="20,40 26,49 20,58 14,49"/>
        <polygon points="38,28 45,38 38,48 31,38"/>
        <polygon points="62,28 69,38 62,48 55,38"/>
        <polygon points="80,40 86,49 80,58 74,49"/>
        <polygon points="30,62 50,55 70,62 63,86 50,80 37,86"/>
      </g>
    </svg>`;
}

function renderTokenGlyph() {
  return `<svg width="56" height="56" viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="44" fill="none" stroke="#3D4A63" stroke-width="2" stroke-dasharray="5 6"/>
      <g fill="#3D4A63">
        <polygon points="20,40 26,49 20,58 14,49"/><polygon points="38,28 45,38 38,48 31,38"/>
        <polygon points="62,28 69,38 62,48 55,38"/><polygon points="80,40 86,49 80,58 74,49"/>
        <polygon points="30,62 50,55 70,62 63,86 50,80 37,86"/>
      </g>
    </svg>`;
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

function summarizeSpendLines(rows) {
  const lines = {
    routerPence: 0,
    workerPence: 0,
    codexPence: 0
  };

  for (const row of rows) {
    const cost = toInteger(row.cost_pence);
    const text = `${row.note || ''} ${row.type || ''}`.toLowerCase();
    if (text.includes('codex')) {
      lines.codexPence += cost;
      continue;
    }
    if (!text.includes('claude')) {
      continue;
    }
    if (text.includes('router')) {
      lines.routerPence += cost;
    } else {
      lines.workerPence += cost;
    }
  }

  return lines;
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

function summarizeCorrection(row) {
  if (!isRefusedEvent(row)) {
    return '';
  }

  const detail = parseJsonObject(row.detail);
  if (detail) {
    for (const key of ['correction', 'correction_text', 'corrective_action', 'next_step', 'hint']) {
      if (typeof detail[key] === 'string' && detail[key].trim()) {
        return limitText(detail[key].trim(), 180);
      }
    }
  }

  return 'tap the newest coder-bot message; nonce is single-use';
}

function eventTone(row) {
  if (isRefusedEvent(row)) {
    return 'bad';
  }
  const text = `${row.kind || ''} ${row.gate || ''} ${row.decision || ''}`.toLowerCase();
  if (/approved|accepted|passed|merged|complete|fired/.test(text)) {
    return 'ok';
  }
  return 'info';
}

function isRefusedEvent(row) {
  const text = `${row.kind || ''} ${row.gate || ''} ${row.decision || ''}`.toLowerCase();
  return /refused|rejected|failed|blocked|denied/.test(text);
}

function deriveEngine(row) {
  const value = firstPresent(row, ['engine', 'worker_engine', 'model_provider', 'provider', 'model']);
  if (value) {
    return safeLabel(value, 'unknown');
  }

  const text = `${row.type || ''} ${row.status || ''}`.toLowerCase();
  if (text.includes('codex') || text.includes('gpt')) {
    return 'codex';
  }
  if (text.includes('claude') || text.includes('sonnet')) {
    return 'claude';
  }
  return 'unknown';
}

function deriveStage(row) {
  const value = firstPresent(row, ['stage', 'phase', 'gate', 'status']);
  const normalized = safeLabel(value, 'unknown').toLowerCase().replace(/[_\s]+/g, '-');
  if (normalized.includes('spec')) {
    return 'spec';
  }
  if (normalized.includes('build') || normalized.includes('active') || normalized.includes('running') || normalized.includes('progress') || normalized.includes('executing')) {
    return 'build';
  }
  if (normalized.includes('merged') || normalized.includes('complete') || normalized.includes('done') || normalized.includes('shipped')) {
    return 'done';
  }
  if (normalized.includes('refused') || normalized.includes('failed') || normalized.includes('rejected')) {
    return 'gate';
  }
  if (normalized.includes('queued') || normalized.includes('pending')) {
    return 'queued';
  }
  return normalized || 'unknown';
}

function deriveEffort(row) {
  return safeLabel(firstPresent(row, ['effort', 'reasoning_effort', 'model_reasoning_effort', 'priority']), 'unknown').toLowerCase();
}

function deriveRef(row) {
  return safeLabel(firstPresent(row, [
    'branch',
    'ref',
    'pr',
    'pr_number',
    'pull_request',
    'pull_request_url',
    'sha',
    'commit_sha',
    'head_sha'
  ]), '—');
}

function firstPresent(row, keys) {
  for (const key of keys) {
    if (row && row[key] !== null && row[key] !== undefined && String(row[key]).trim()) {
      return row[key];
    }
  }
  return '';
}

function statusPillClass(status, stage) {
  const text = `${status || ''} ${stage || ''}`.toLowerCase();
  if (/merged|complete|completed|done|shipped|approved|passed/.test(text)) {
    return 'p-merged';
  }
  if (/refused|failed|rejected|blocked|denied|gate/.test(text)) {
    return 'p-refused';
  }
  if (/spec|build|active|running|progress|executing|started/.test(text)) {
    return 'p-build';
  }
  return 'p-queued';
}

function formatStage(stage, effort) {
  const cleanStage = safeLabel(stage, 'unknown');
  const cleanEffort = safeLabel(effort, '');
  if (!cleanEffort || cleanEffort === 'unknown') {
    return cleanStage;
  }
  return `${cleanStage} · ${cleanEffort}`;
}

function stageProgressPercent(stage) {
  const normalized = String(stage || '').toLowerCase();
  if (normalized === 'spec') {
    return 32;
  }
  if (normalized === 'build' || normalized === 'active') {
    return 64;
  }
  if (normalized === 'done') {
    return 100;
  }
  return 0;
}

function formatTimeout(seconds) {
  const total = toInteger(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

function formatClock(ms) {
  if (!ms) {
    return 'unknown';
  }
  const date = new Date(ms);
  return [
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
    String(date.getSeconds()).padStart(2, '0')
  ].join(':');
}

function formatEventTime(ms) {
  if (!ms) {
    return '--:--';
  }
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatJobAge(createdAt, renderedAt) {
  const createdMs = toMs(createdAt);
  const nowMs = toMs(renderedAt);
  if (!createdMs || !nowMs || createdMs > nowMs) {
    return '-';
  }

  const ageMs = nowMs - createdMs;
  const minuteMs = 60 * 1000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;
  const olderCutoffMs = 30 * dayMs;

  if (ageMs < hourMs) {
    return `${Math.floor(ageMs / minuteMs)}m`;
  }
  if (ageMs < dayMs) {
    return `${Math.floor(ageMs / hourMs)}h`;
  }
  if (ageMs < olderCutoffMs) {
    return `${Math.floor(ageMs / dayMs)}d`;
  }
  return formatUtc(createdMs);
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

function getUtcDayStartMs(date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
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

function serveStatic(urlPath, res) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch (_) {
    sendText(res, 400, 'Bad request');
    return;
  }

  const relative = decoded.replace(/^\/static\/?/, '');
  if (!relative || relative.includes('\0')) {
    sendText(res, 404, 'Not found');
    return;
  }

  const filePath = path.resolve(STATIC_ROOT, relative);
  if (filePath !== STATIC_ROOT && !filePath.startsWith(`${STATIC_ROOT}${path.sep}`)) {
    sendText(res, 404, 'Not found');
    return;
  }

  const contentType = staticContentType(path.extname(filePath).toLowerCase());
  if (!contentType) {
    sendText(res, 404, 'Not found');
    return;
  }

  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      sendText(res, 404, 'Not found');
      return;
    }

    fs.readFile(filePath, (readError, data) => {
      if (readError) {
        sendText(res, 404, 'Not found');
        return;
      }

      res.writeHead(200, {
        'content-type': contentType,
        'cache-control': 'public, max-age=3600',
        'x-content-type-options': 'nosniff'
      });
      res.end(data);
    });
  });
}

function staticContentType(extension) {
  switch (extension) {
    case '.woff2':
      return 'font/woff2';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    default:
      return '';
  }
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
    @font-face{font-family:'Oswald';font-style:normal;font-weight:400;font-display:swap;src:url('/static/fonts/oswald-latin-400-normal.woff2') format('woff2')}
    @font-face{font-family:'Oswald';font-style:normal;font-weight:500;font-display:swap;src:url('/static/fonts/oswald-latin-500-normal.woff2') format('woff2')}
    @font-face{font-family:'Oswald';font-style:normal;font-weight:700;font-display:swap;src:url('/static/fonts/oswald-latin-700-normal.woff2') format('woff2')}
    @font-face{font-family:'Barlow';font-style:normal;font-weight:300;font-display:swap;src:url('/static/fonts/barlow-latin-300-normal.woff2') format('woff2')}
    @font-face{font-family:'Barlow';font-style:normal;font-weight:400;font-display:swap;src:url('/static/fonts/barlow-latin-400-normal.woff2') format('woff2')}
    @font-face{font-family:'Barlow';font-style:normal;font-weight:500;font-display:swap;src:url('/static/fonts/barlow-latin-500-normal.woff2') format('woff2')}
    @font-face{font-family:'Barlow';font-style:normal;font-weight:700;font-display:swap;src:url('/static/fonts/barlow-latin-700-normal.woff2') format('woff2')}
    @font-face{font-family:'JetBrains Mono';font-style:normal;font-weight:400;font-display:swap;src:url('/static/fonts/jetbrains-mono-latin-400-normal.woff2') format('woff2')}
    @font-face{font-family:'JetBrains Mono';font-style:normal;font-weight:500;font-display:swap;src:url('/static/fonts/jetbrains-mono-latin-500-normal.woff2') format('woff2')}
    @font-face{font-family:'JetBrains Mono';font-style:normal;font-weight:700;font-display:swap;src:url('/static/fonts/jetbrains-mono-latin-700-normal.woff2') format('woff2')}
    :root{
      --void:#070B14; --navy:#0C1322; --panel:#121C30; --elevated:#1A2740;
      --line:rgba(120,150,200,.10); --line-strong:rgba(120,150,200,.18);
      --steel:#5B6B86; --ash:#8A9AB5; --mist:#C9D3E3; --bright:#EAF0FA;
      --amber:#F5A623; --amber-glow:rgba(245,166,35,.14);
      --green:#34D399; --green-dim:rgba(52,211,153,.12);
      --red:#F2555A; --red-dim:rgba(242,85,90,.12);
      --idle:#3D4A63;
      --display:'Oswald','Barlow Condensed',sans-serif;
      --body:'Barlow','DM Sans',sans-serif;
      --mono:'JetBrains Mono','IBM Plex Mono',monospace;
      --xs:.75rem; --sm:.875rem; --base:1rem; --lg:1.25rem; --xl:1.5rem; --2xl:2rem;
    }
    *{box-sizing:border-box;margin:0;padding:0}
    body{
      background:var(--void); color:var(--mist); font-family:var(--body);
      font-size:var(--base); line-height:1.45; padding:1.25rem 1.5rem 3rem;
      -webkit-font-smoothing:antialiased;
    }
    body::before{content:'';position:fixed;inset:0;opacity:.035;pointer-events:none;z-index:9999;
      background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");}
    .mono{font-family:var(--mono);font-variant-numeric:tabular-nums}
    .fade{opacity:0;transform:translateY(10px);animation:rev .4s ease-out forwards}
    @keyframes rev{to{opacity:1;transform:none}}
    .fade:nth-child(1){animation-delay:.04s}.fade:nth-child(2){animation-delay:.09s}
    .fade:nth-child(3){animation-delay:.14s}.fade:nth-child(4){animation-delay:.19s}
    .fade:nth-child(5){animation-delay:.24s}
    header{display:flex;align-items:center;gap:1rem;padding-bottom:1.1rem;border-bottom:1px solid var(--line-strong);margin-bottom:1.4rem}
    .mark{flex:0 0 auto}
    .wordmark{display:flex;flex-direction:column;line-height:1}
    .wordmark .t{font-family:var(--display);font-weight:700;font-size:var(--lg);letter-spacing:.18em;color:var(--bright);text-transform:uppercase}
    .wordmark .s{font-family:var(--mono);font-size:var(--xs);color:var(--steel);letter-spacing:.22em;margin-top:.35rem;text-transform:uppercase}
    .sys{margin-left:auto;display:flex;gap:1.4rem;align-items:center}
    .sysitem{display:flex;flex-direction:column;align-items:flex-end;gap:.2rem}
    .sysitem .k{font-family:var(--mono);font-size:.62rem;letter-spacing:.16em;color:var(--steel);text-transform:uppercase}
    .sysitem .v{font-family:var(--mono);font-size:var(--sm);color:var(--mist)}
    .pulse{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--amber);box-shadow:0 0 0 0 var(--amber-glow);animation:pl 1.8s ease-out infinite;margin-right:.4rem;vertical-align:middle}
    @keyframes pl{0%{box-shadow:0 0 0 0 rgba(245,166,35,.5)}70%{box-shadow:0 0 0 9px rgba(245,166,35,0)}100%{box-shadow:0 0 0 0 rgba(245,166,35,0)}}
    .seal{font-family:var(--mono);font-size:var(--xs);color:var(--green);border:1px solid var(--green-dim);background:var(--green-dim);padding:.2rem .5rem;border-radius:4px;letter-spacing:.08em}
    .banner{margin-bottom:1rem;border:1px solid var(--red-dim);background:var(--red-dim);color:var(--red);border-radius:8px;padding:.75rem 1rem;font-family:var(--mono);font-size:var(--xs)}
    .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:.75rem;margin-bottom:1.4rem}
    .kpi{background:rgba(255,255,255,.025);border:1px solid var(--line);border-left:3px solid var(--steel);border-radius:8px;padding:.85rem 1rem;display:flex;flex-direction:column;gap:.3rem}
    .kpi.live{border-left-color:var(--amber)}
    .kpi.good{border-left-color:var(--green)}
    .kpi .lab{font-family:var(--display);font-size:var(--xs);font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--steel)}
    .kpi .val{font-family:var(--mono);font-size:var(--2xl);font-weight:700;color:var(--bright);line-height:1}
    .kpi .stage-val{font-size:1.3rem}
    .kpi .sub{font-family:var(--mono);font-size:var(--xs);color:var(--ash)}
    .kpi .sub.g{color:var(--green)}
    .grid{display:grid;grid-template-columns:1.8fr 1fr;gap:1rem;align-items:start}
    @media(max-width:980px){.grid{grid-template-columns:1fr}}
    .panel{background:var(--navy);border:1px solid var(--line);border-radius:10px;overflow:hidden}
    .phead{display:flex;align-items:center;gap:.6rem;padding:.8rem 1.1rem;border-bottom:1px solid var(--line)}
    .phead h2{font-family:var(--display);font-weight:700;font-size:var(--sm);letter-spacing:.12em;text-transform:uppercase;color:var(--mist)}
    .phead .count{margin-left:auto;font-family:var(--mono);font-size:var(--xs);color:var(--steel)}
    .pbody{padding:.4rem 0}
    .stack{display:flex;flex-direction:column;gap:1rem}
    .heroes{display:grid;grid-template-columns:1fr;gap:.7rem;padding:.9rem 1.1rem}
    .hero{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:.9rem 1rem;display:flex;flex-direction:column;gap:.55rem}
    .hero.active{border-color:var(--amber-glow);box-shadow:inset 3px 0 0 var(--amber)}
    .hero .row1{display:flex;align-items:center;gap:.6rem}
    .hero .row1 .pill{margin-left:auto}
    .hero .name{font-family:var(--display);font-weight:700;letter-spacing:.06em;color:var(--bright);text-transform:uppercase;font-size:var(--sm)}
    .hero .meta,.token-live{display:flex;gap:1.2rem;flex-wrap:wrap}
    .hero .meta .m,.token-live>div{display:flex;flex-direction:column;gap:.15rem}
    .hero .meta .mk,.token-live .mk{font-family:var(--mono);font-size:.6rem;letter-spacing:.14em;color:var(--steel);text-transform:uppercase}
    .hero .meta .mv,.token-live .mv{font-family:var(--mono);font-size:var(--sm);color:var(--mist)}
    .bar{height:5px;border-radius:3px;background:rgba(255,255,255,.06);overflow:hidden}
    .bar>i{display:block;height:100%;background:var(--amber)}
    .pill{font-family:var(--mono);font-size:.66rem;font-weight:500;letter-spacing:.06em;padding:.18rem .5rem;border-radius:4px;text-transform:uppercase;white-space:nowrap}
    .p-build{color:var(--amber);background:var(--amber-glow)}
    .p-merged{color:var(--green);background:var(--green-dim)}
    .p-refused{color:var(--red);background:var(--red-dim)}
    .p-queued{color:var(--ash);background:rgba(120,150,200,.08)}
    table{width:100%;border-collapse:collapse}
    th{font-family:var(--display);font-size:.68rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--steel);text-align:left;padding:.6rem 1.1rem;border-bottom:1px solid var(--line)}
    td{padding:.62rem 1.1rem;border-bottom:1px solid rgba(120,150,200,.05);font-size:var(--sm);color:var(--mist);vertical-align:middle}
    tr:last-child td{border-bottom:none}
    tbody tr:hover{background:rgba(255,255,255,.018)}
    td.id,td.age,td.eng,td.ref{font-family:var(--mono);font-size:var(--xs)}
    td.id{color:var(--ash)}
    td.age{color:var(--steel);white-space:nowrap}
    td.eng{color:var(--steel)}
    td.ref{color:var(--ash)}
    .title{color:var(--bright)}
    .stage.p-build{background:transparent}.stage.p-merged{background:transparent}.stage.p-refused{background:transparent}.stage.p-queued{background:transparent}
    .spend{padding:.9rem 1.1rem;display:flex;flex-direction:column;gap:.7rem}
    .spend .line{display:flex;align-items:center;justify-content:space-between;gap:1rem;font-size:var(--sm)}
    .spend .line .l{color:var(--ash)}
    .spend .line .r{font-family:var(--mono);color:var(--mist)}
    .spend .line.excl .l,.spend .line.excl .r{color:var(--steel)}
    .spend .tot{border-top:1px solid var(--line);padding-top:.7rem;display:flex;justify-content:space-between;gap:1rem}
    .spend .tot .l{font-family:var(--display);font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--mist);font-size:var(--sm)}
    .spend .tot .r{font-family:var(--mono);font-weight:700;color:var(--bright);font-size:var(--lg)}
    .cap{height:6px;border-radius:3px;background:rgba(255,255,255,.06);overflow:hidden;margin-top:.2rem}
    .cap>i{display:block;height:100%;background:var(--green)}
    .cap>i.warn50{background:var(--amber)}.cap>i.warn80,.cap>i.hardstop{background:var(--red)}
    .note{font-family:var(--mono);font-size:var(--xs);color:var(--steel);line-height:1.5}
    .token-live{padding:.9rem 1.1rem;border-bottom:1px solid var(--line)}
    .token-note{padding:.8rem 1.1rem;border-bottom:1px solid var(--line)}
    .empty{padding:2.2rem 1.1rem;display:flex;flex-direction:column;align-items:center;gap:.9rem;text-align:center}
    .empty .glyph{opacity:.35}
    .empty .h{font-family:var(--display);font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--ash);font-size:var(--sm)}
    .empty .p{font-family:var(--mono);font-size:var(--xs);color:var(--steel);max-width:32ch;line-height:1.6}
    .events{padding:.5rem 0}
    .ev{display:grid;grid-template-columns:54px 18px 1fr;gap:.6rem;padding:.55rem 1.1rem;border-bottom:1px solid rgba(120,150,200,.05);align-items:start}
    .ev:last-child{border-bottom:none}
    .ev .ts{font-family:var(--mono);font-size:var(--xs);color:var(--steel)}
    .ev .dot{width:8px;height:8px;border-radius:50%;margin-top:.35rem}
    .ev.ok .dot{background:var(--green)} .ev.bad .dot{background:var(--red)} .ev.info .dot{background:var(--amber)}
    .ev .body .m{font-size:var(--sm);color:var(--mist)}
    .ev .body .m b{font-family:var(--mono);font-size:var(--xs);color:var(--ash);font-weight:400}
    .ev .body .corr{font-family:var(--mono);font-size:var(--xs);color:var(--amber);margin-top:.25rem;padding-left:.6rem;border-left:2px solid var(--amber-glow)}
    .warnings{margin:.75rem 1.1rem;padding:.65rem .8rem .65rem 1.4rem;border:1px solid var(--amber-glow);border-radius:8px;color:var(--amber);background:rgba(245,166,35,.06);font-family:var(--mono);font-size:var(--xs)}
    .unavailable{border-color:var(--amber-glow)}
    .unavailable-note{padding:.9rem 1.1rem}
    .empty-row{padding:.9rem 1.1rem;color:var(--steel);font-family:var(--mono);font-size:var(--xs)}
    footer{margin-top:2rem;font-family:var(--mono);font-size:var(--xs);color:var(--steel);text-align:center;letter-spacing:.08em}
    @media(max-width:720px){
      body{padding:1rem}
      header{align-items:flex-start;flex-wrap:wrap}
      .sys{width:100%;margin-left:0;justify-content:space-between;gap:.75rem}
      .sysitem{align-items:flex-start}
      table{min-width:680px}
      .table-wrap{overflow-x:auto}
    }
  `;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}

export {
  buildDashboardModel,
  formatJobAge,
  renderDashboard,
  getMonthStartMs,
  spendLevel,
  startServer,
  summarizeDetail
};
