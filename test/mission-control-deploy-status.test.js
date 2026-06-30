'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const { execFileSync } = childProcess;
const fs = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const test = require('node:test');
const sqlite = require('node:sqlite');

const {
  buildDeployModel,
  deployStatusPillClass,
  renderDashboard
} = require('../mission-control/server.js');

test('buildDeployModel reports up-to-date deployed target and caps recent rows', () => {
  const servingCommit = 'aaaaaaaa11111111222222223333333344444444';
  const rows = [];
  for (let id = 1; id <= 9; id += 1) {
    rows.push({
      id,
      target_sha: id === 9 ? `  ${servingCommit}  ` : `bbbbbbbb${id}`,
      status: id === 9 ? 'success' : 'deployed',
      created_at: 1_700_000_000_000 + id,
      updated_at: 1_700_000_010_000 + id
    });
  }

  const model = buildDeployModel(rows, ` ${servingCommit} `);

  assert.equal(model.upToDate, true);
  assert.equal(model.latestStatus, 'deployed');
  assert.equal(model.latest.targetSha, servingCommit);
  assert.equal(model.recentRows.length, 8);
  assert.equal(model.recentRows[0].id, 9);
});

test('buildDeployModel keeps full-hash comparison for deployed mismatch', () => {
  const servingCommit = '12345678aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const latestTarget = '87654321bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

  const model = buildDeployModel([
    {
      id: 2,
      target_sha: latestTarget,
      status: 'deployed',
      created_at: 2,
      updated_at: 2
    }
  ], servingCommit);

  assert.equal(model.upToDate, false);
  assert.equal(model.servingSha8, '12345678');
  assert.equal(model.latestDeploySha8, '87654321');
  assert.notEqual(model.servingSha8, model.latestDeploySha8);
  assert.notEqual(model.latest.targetSha, servingCommit);
});

test('buildDeployModel does not compare only sha8 values', () => {
  const model = buildDeployModel([
    {
      id: 2,
      target_sha: '12345678bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      status: 'deployed',
      created_at: 2,
      updated_at: 2
    }
  ], '12345678aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

  assert.equal(model.servingSha8, '12345678');
  assert.equal(model.latestDeploySha8, '12345678');
  assert.equal(model.upToDate, false);
});

test('buildDeployModel preserves broken latest status and never treats it as up to date', () => {
  const commit = 'cccccccc11111111222222223333333344444444';
  const model = buildDeployModel([
    {
      id: 4,
      target_sha: commit,
      status: ' broken ',
      created_at: 4,
      updated_at: 4
    }
  ], commit);

  assert.equal(model.upToDate, false);
  assert.equal(model.latestStatus, 'broken');
});

test('rolled_back normalization is danger and never deployed or success', () => {
  const commit = 'dddddddd11111111222222223333333344444444';
  const model = buildDeployModel([
    {
      id: 5,
      target_sha: commit,
      status: 'rolled-back',
      created_at: 5,
      updated_at: 5
    }
  ], commit);

  assert.equal(model.upToDate, false);
  assert.equal(model.latestStatus, 'rolled_back');
  assert.equal(deployStatusPillClass('rolled back'), 'deploy-status-pill deploy-status-pill--danger');
  assert.notEqual(model.latestStatus, 'deployed');
  assert.doesNotMatch(deployStatusPillClass('rolled-back'), /success/);
});

test('deployStatusPillClass maps deploy-only status classes', () => {
  assert.equal(deployStatusPillClass('deployed'), 'deploy-status-pill deploy-status-pill--success');
  assert.equal(deployStatusPillClass('pending'), 'deploy-status-pill deploy-status-pill--pending');
  assert.equal(deployStatusPillClass('deploying'), 'deploy-status-pill deploy-status-pill--active');
  assert.equal(deployStatusPillClass('broken'), 'deploy-status-pill deploy-status-pill--danger');
  assert.equal(deployStatusPillClass('rolled_back'), 'deploy-status-pill deploy-status-pill--danger');
  assert.equal(deployStatusPillClass('unsupported'), 'deploy-status-pill deploy-status-pill--muted');
});

test('buildDeployModel detects pending and deploying rows with target sha8 values', () => {
  const model = buildDeployModel([
    {
      id: 3,
      target_sha: 'eeeeeeee11111111222222223333333344444444',
      status: 'pending',
      created_at: 3,
      updated_at: 3
    },
    {
      id: 2,
      target_sha: 'ffffffff11111111222222223333333344444444',
      status: 'deploying',
      created_at: 2,
      updated_at: 2
    },
    {
      id: 1,
      target_sha: '9999999911111111222222223333333344444444',
      status: 'deployed',
      created_at: 1,
      updated_at: 1
    }
  ], '9999999911111111222222223333333344444444');

  assert.deepEqual(model.pendingRows.map((row) => row.status), ['pending', 'deploying']);
  assert.deepEqual(model.pendingRows.map((row) => row.targetSha8), ['eeeeeeee', 'ffffffff']);
});

test('buildDeployModel returns empty deploy state for empty or non-array rows', () => {
  assert.deepEqual(buildDeployModel(null, 'abc123').pendingRows, []);

  const model = buildDeployModel([], 'abc123');
  assert.equal(model.upToDate, false);
  assert.equal(model.empty, true);
  assert.equal(model.latest, null);
  assert.equal(model.latestStatus, 'none');
  assert.deepEqual(model.pendingRows, []);
  assert.deepEqual(model.recentRows, []);
});

test('renderDashboard shows UP TO DATE for current deployed target', () => {
  const commit = 'aaaaaaaa11111111222222223333333344444444';
  const html = bodyHtml(renderDashboard(dashboardModel(buildDeployModel([
    deployRow(1, commit, 'deployed')
  ], commit))));

  assert.match(html, />UP TO DATE</);
});

test('renderDashboard shows deployed mismatch without up-to-date status', () => {
  const servingCommit = '12345678aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const latestTarget = '87654321bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const model = buildDeployModel([
    deployRow(2, latestTarget, 'deployed')
  ], servingCommit);
  const html = deployPanelHtml(bodyHtml(renderDashboard(dashboardModel(model))));

  assert.equal(model.latestStatus, 'deployed');
  assert.match(html, /12345678/);
  assert.match(html, /87654321/);
  assert.match(html, />DEPLOYED</);
  assert.doesNotMatch(html, /UP TO DATE/);
});

test('renderDashboard shows broken latest deploy as danger without deployed success treatment', () => {
  const commit = 'bbbbbbbb11111111222222223333333344444444';
  const html = bodyHtml(renderDashboard(dashboardModel(buildDeployModel([
    deployRow(2, commit, 'broken')
  ], commit))));

  assert.match(html, />BROKEN</);
  assert.match(html, /<span class="deploy-status-pill deploy-status-pill--danger">BROKEN<\/span>/);
  assert.doesNotMatch(html, /<span class="deploy-status-pill deploy-status-pill--success">/);
  assert.doesNotMatch(html, />DEPLOYED</);
});

test('renderDashboard shows rolled_back latest deploy as danger without deployed success treatment', () => {
  const commit = 'cccccccc11111111222222223333333344444444';
  const html = bodyHtml(renderDashboard(dashboardModel(buildDeployModel([
    deployRow(3, commit, 'rolled back')
  ], commit))));

  assert.match(html, />ROLLED BACK</);
  assert.match(html, /<span class="deploy-status-pill deploy-status-pill--danger">ROLLED BACK<\/span>/);
  assert.doesNotMatch(html, /<span class="deploy-status-pill deploy-status-pill--success">/);
  assert.doesNotMatch(html, />DEPLOYED</);
});

test('renderDashboard surfaces pending and deploying rows above recent history', () => {
  const html = bodyHtml(renderDashboard(dashboardModel(buildDeployModel([
    deployRow(3, '11111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'pending'),
    deployRow(2, '22222222aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'deploying'),
    deployRow(1, '33333333aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'deployed')
  ], '33333333aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'))));

  assert.match(html, /deploy-pending/);
  assert.match(html, /11111111/);
  assert.match(html, /22222222/);
  assert.ok(html.indexOf('deploy-pending') < html.indexOf('deploy-history'));
});

test('renderDashboard caps recent deploy history and omits raw sensitive detail fields', () => {
  const rows = [];
  for (let id = 1; id <= 10; id += 1) {
    rows.push({
      ...deployRow(id, `${String(id).padStart(8, '0')}aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`, 'deployed'),
      nonce_hash: `nonce-secret-${id}`,
      detail: `raw-detail-${id}`,
      detail_json: `{"token":"raw-token-${id}"}`,
      pre_sha: `pre-sha-${id}`
    });
  }

  const html = bodyHtml(renderDashboard(dashboardModel(buildDeployModel(rows, '00000010aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'))));

  for (let id = 10; id >= 3; id -= 1) {
    assert.match(html, new RegExp(String(id).padStart(8, '0')));
  }
  assert.doesNotMatch(html, /00000002/);
  assert.doesNotMatch(html, /00000001/);
  assert.equal((html.match(/<time data-ms=/g) || []).length, 8);
  assert.ok((html.match(/deploy-status-pill/g) || []).length >= 8);
  assert.doesNotMatch(html, /nonce-secret/);
  assert.doesNotMatch(html, /raw-detail/);
  assert.doesNotMatch(html, /raw-token/);
  assert.doesNotMatch(html, /pre-sha/);
});

test('missing deploys table renders unavailable panel without throwing', () => {
  const { dbPath, dir } = createDashboardDb({ withDeploys: false });

  withFreshServer({
    COYOTE_CLAW_DB: dbPath,
    COYOTE_HALT_FILE: path.join(dir, 'HALT')
  }, ({ buildDashboardModel, renderDashboard: freshRenderDashboard }) => {
    let html;
    assert.doesNotThrow(() => {
      html = freshRenderDashboard(buildDashboardModel());
    });

    assert.match(html, /<h2>Deploy Status<\/h2><span class="count">unavailable<\/span>/);
    assert.match(html, /class="panel fade unavailable"/);
  });
});

test('buildDashboardModel renders UP TO DATE for deployed row targeting real HEAD', () => {
  const head = gitHeadFromExecFileSync();
  const { dbPath, dir } = createDashboardDb({ withDeploys: true });
  const db = new sqlite.DatabaseSync(dbPath);

  try {
    db.prepare(`
      INSERT INTO deploys (id, target_sha, pre_sha, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(1, head, 'previous-sha-not-rendered', 'deployed', 1_700_000_000_001, 1_700_000_010_001);
  } finally {
    db.close();
  }

  withSandboxFriendlyExecFileSync(() => {
    withFreshServer({
      COYOTE_CLAW_DB: dbPath,
      COYOTE_HALT_FILE: path.join(dir, 'HALT'),
      COYOTE_MC_COMMIT: undefined
    }, ({ buildDashboardModel, renderDashboard: freshRenderDashboard }) => {
      const html = deployPanelHtml(bodyHtml(freshRenderDashboard(buildDashboardModel())));

      assert.match(html, />UP TO DATE</);
    });
  });
});

test('zero deploy rows render empty state without throwing', () => {
  let html;
  assert.doesNotThrow(() => {
    html = renderDashboard(dashboardModel(buildDeployModel([], 'abc123')));
  });

  assert.match(html, /No deploys recorded yet\./);
});

function deployRow(id, targetSha, status) {
  return {
    id,
    target_sha: targetSha,
    pre_sha: 'previous-sha-not-rendered',
    status,
    created_at: 1_700_000_000_000 + id,
    updated_at: 1_700_000_010_000 + id
  };
}

function dashboardModel(deploy) {
  const unavailable = { ok: false, message: 'unavailable for deploy render test', warnings: [] };

  return {
    ok: true,
    halt: { halted: false },
    refreshedAt: 1_700_000_000_000,
    sections: {
      kpis: unavailable,
      queue: unavailable,
      worker: unavailable,
      spend: unavailable,
      tokens: unavailable,
      outcomes: unavailable,
      deploy: {
        ok: true,
        warnings: [],
        ...deploy
      }
    }
  };
}

function bodyHtml(html) {
  return html.replace(/<style>[\s\S]*?<\/style>/, '');
}

function deployPanelHtml(html) {
  const match = html.match(/<section class="panel fade deploy-panel">[\s\S]*?<\/section>/);
  return match ? match[0] : '';
}

function gitHeadFromExecFileSync() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD']).toString().trim();
  } catch (error) {
    if (error && error.code === 'EPERM' && error.stdout) {
      return String(error.stdout).trim();
    }
    throw error;
  }
}

function withSandboxFriendlyExecFileSync(fn) {
  const original = childProcess.execFileSync;

  childProcess.execFileSync = (...args) => {
    try {
      return original(...args);
    } catch (error) {
      if (error && error.code === 'EPERM' && error.stdout) {
        const options = args[2];
        return options && options.encoding ? String(error.stdout) : Buffer.from(String(error.stdout));
      }
      throw error;
    }
  };

  try {
    return fn();
  } finally {
    childProcess.execFileSync = original;
  }
}

function createDashboardDb({ withDeploys }) {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'mc-deploy-db-'));
  const dbPath = path.join(dir, 'librarian.db');
  const db = new sqlite.DatabaseSync(dbPath);

  try {
    db.exec(`
      CREATE TABLE system_state (
        key TEXT,
        value TEXT,
        updated_at INTEGER
      );
      CREATE TABLE jobs (
        id TEXT PRIMARY KEY,
        status TEXT,
        type TEXT,
        stage TEXT,
        phase TEXT,
        gate TEXT,
        effort TEXT,
        reasoning_effort TEXT,
        model_reasoning_effort TEXT,
        priority TEXT,
        engine TEXT,
        worker_engine TEXT,
        model_provider TEXT,
        provider TEXT,
        model TEXT,
        result TEXT,
        branch TEXT,
        ref TEXT,
        pr TEXT,
        pr_number TEXT,
        pull_request TEXT,
        pull_request_url TEXT,
        sha TEXT,
        commit_sha TEXT,
        head_sha TEXT,
        attempts INTEGER,
        updated_at INTEGER,
        created_at INTEGER
      );
      CREATE TABLE job_events (
        job_id TEXT,
        kind TEXT,
        actor TEXT,
        gate TEXT,
        decision TEXT,
        detail TEXT,
        created_at INTEGER
      );
      CREATE TABLE worker_heartbeat (
        owner_id TEXT,
        last_beat_at INTEGER,
        phase TEXT,
        job_id TEXT,
        worker_name TEXT
      );
      CREATE TABLE spend_log (
        job_id TEXT,
        cost_pence INTEGER,
        note TEXT,
        created_at INTEGER
      );
      CREATE TABLE job_token_usage (
        job_id TEXT,
        engine TEXT,
        input_tokens INTEGER,
        output_tokens INTEGER,
        total_tokens INTEGER,
        created_at INTEGER
      );
    `);

    if (withDeploys) {
      db.exec(`
        CREATE TABLE deploys (
          id INTEGER,
          target_sha TEXT,
          pre_sha TEXT,
          status TEXT,
          created_at INTEGER,
          updated_at INTEGER
        );
      `);
    }
  } finally {
    db.close();
  }

  return { dbPath, dir };
}

function withFreshServer(env, fn) {
  const modulePath = require.resolve('../mission-control/server.js');
  const keys = ['COYOTE_CLAW_DB', 'COYOTE_HALT_FILE', 'COYOTE_MC_COMMIT'];
  const previous = {};

  for (const key of keys) {
    previous[key] = process.env[key];
    if (Object.prototype.hasOwnProperty.call(env, key)) {
      if (env[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = env[key];
      }
    }
  }

  delete require.cache[modulePath];

  try {
    return fn(require('../mission-control/server.js'));
  } finally {
    delete require.cache[modulePath];
    for (const key of keys) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }
  }
}
