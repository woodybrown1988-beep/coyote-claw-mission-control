'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { homedir, tmpdir } = require('node:os');
const path = require('node:path');
const test = require('node:test');
const sqlite = require('node:sqlite');

const {
  buildHaltModel,
  renderDashboard
} = require('../mission-control/server.js');

test('buildHaltModel reports flag-file halt source', () => {
  assert.deepEqual(buildHaltModel(true, '0'), {
    halted: true,
    source: 'flag-file'
  });
});

test('buildHaltModel reports paused halt source for string one', () => {
  assert.deepEqual(buildHaltModel(false, '1'), {
    halted: true,
    source: 'paused'
  });
});

test('buildHaltModel reports combined halt source', () => {
  assert.deepEqual(buildHaltModel(true, '1'), {
    halted: true,
    source: 'flag-file+paused'
  });
});

test('buildHaltModel reports clear state without a false source', () => {
  assert.deepEqual(buildHaltModel(false, '0'), { halted: false });
  assert.deepEqual(buildHaltModel(false, null), { halted: false });
  assert.deepEqual(buildHaltModel(false, undefined), { halted: false });
});

test('renderDashboard shows a halt banner for flag-file halt', () => {
  const html = renderDashboard(dashboardModel({
    halted: true,
    source: 'flag-file'
  }));

  assert.match(html, /<section class="banner fade">HALTED/);
  assert.match(html, />HALTED · flag-file</);
});

test('renderDashboard shows a halt banner for paused halt', () => {
  const html = renderDashboard(dashboardModel({
    halted: true,
    source: 'paused'
  }));

  assert.match(html, /<section class="banner fade">HALTED/);
  assert.match(html, />HALTED · paused</);
});

test('renderDashboard shows the combined halt source', () => {
  const html = renderDashboard(dashboardModel({
    halted: true,
    source: 'flag-file+paused'
  }));

  assert.match(html, />HALTED · flag-file\+paused</);
});

test('renderDashboard clear state has no halt banner', () => {
  const html = renderDashboard(dashboardModel({ halted: false }));

  assert.doesNotMatch(html, /HALTED/);
  assert.doesNotMatch(html, /<section class="banner\b/);
});

test('buildDashboardModel reads the env halt path and does not mutate halt state', () => {
  const { dbPath, dir } = createDashboardDb();
  const haltPath = path.join(dir, 'HALT');
  const seen = [];
  let mutated = false;

  withPatchedFs({
    existsSync(target) {
      seen.push(String(target));
      return String(target) === haltPath || String(target) === dbPath;
    },
    unlinkSync() {
      mutated = true;
      throw new Error('halt state must not be unlinked');
    },
    rmSync() {
      mutated = true;
      throw new Error('halt state must not be removed');
    },
    writeFileSync() {
      mutated = true;
      throw new Error('halt state must not be written');
    }
  }, () => {
    withFreshServer({
      COYOTE_CLAW_DB: dbPath,
      COYOTE_HALT_FILE: haltPath
    }, ({ buildDashboardModel }) => {
      const model = buildDashboardModel();

      assert.deepEqual(model.halt, {
        halted: true,
        source: 'flag-file'
      });
    });
  });

  assert.ok(seen.includes(haltPath));
  assert.equal(mutated, false);
});

test('buildDashboardModel reads the default halt path when env is unset', () => {
  const expectedHaltPath = path.join(homedir(), '.coyote-claw', 'HALT');
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'mc-halt-default-'));
  const missingDbPath = path.join(dir, 'missing.db');
  const seen = [];

  withPatchedFs({
    existsSync(target) {
      seen.push(String(target));
      return false;
    }
  }, () => {
    withFreshServer({
      COYOTE_CLAW_DB: missingDbPath,
      COYOTE_HALT_FILE: undefined
    }, ({ buildDashboardModel }) => {
      const model = buildDashboardModel();

      assert.deepEqual(model.halt, { halted: false });
    });
  });

  assert.ok(seen.includes(expectedHaltPath));
});

test('buildDashboardModel treats DB unavailable as not paused when flag is absent', () => {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'mc-halt-no-db-'));
  const missingDbPath = path.join(dir, 'missing.db');
  const haltPath = path.join(dir, 'HALT');

  withPatchedFs({
    existsSync() {
      return false;
    }
  }, () => {
    withFreshServer({
      COYOTE_CLAW_DB: missingDbPath,
      COYOTE_HALT_FILE: haltPath
    }, ({ buildDashboardModel }) => {
      const model = buildDashboardModel();

      assert.equal(model.ok, false);
      assert.deepEqual(model.halt, { halted: false });
    });
  });
});

test('buildDashboardModel reads paused from system_state as a halt source', () => {
  const { dbPath, dir } = createDashboardDb('1');
  const haltPath = path.join(dir, 'HALT');

  withPatchedFs({
    existsSync(target) {
      return String(target) === dbPath;
    }
  }, () => {
    withFreshServer({
      COYOTE_CLAW_DB: dbPath,
      COYOTE_HALT_FILE: haltPath
    }, ({ buildDashboardModel }) => {
      const model = buildDashboardModel();

      assert.equal(model.ok, true);
      assert.deepEqual(model.halt, {
        halted: true,
        source: 'paused'
      });
    });
  });
});

test('buildDashboardModel fails safe to flag-file halt when existsSync throws', () => {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'mc-halt-throw-'));
  const missingDbPath = path.join(dir, 'missing.db');
  const haltPath = path.join(dir, 'HALT');

  withPatchedFs({
    existsSync(target) {
      if (String(target) === haltPath) {
        throw new Error('stat failed');
      }
      return false;
    }
  }, () => {
    withFreshServer({
      COYOTE_CLAW_DB: missingDbPath,
      COYOTE_HALT_FILE: haltPath
    }, ({ buildDashboardModel, renderDashboard }) => {
      const model = buildDashboardModel();
      const html = renderDashboard(model);

      assert.deepEqual(model.halt, {
        halted: true,
        source: 'flag-file'
      });
      assert.match(html, /<section class="banner fade">HALTED/);
      assert.match(html, /flag-file/);
    });
  });
});

function dashboardModel(halt) {
  const unavailable = { ok: false, message: 'unavailable for halt render test', warnings: [] };

  return {
    ok: true,
    halt,
    refreshedAt: 1_700_000_000_000,
    sections: {
      kpis: unavailable,
      queue: unavailable,
      worker: unavailable,
      spend: unavailable,
      tokens: unavailable,
      outcomes: unavailable
    }
  };
}

function createDashboardDb(pausedValue) {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'mc-halt-db-'));
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

    if (pausedValue !== undefined) {
      db.prepare('INSERT INTO system_state (key, value, updated_at) VALUES (?, ?, ?)')
        .run('paused', pausedValue, Date.now());
    }
  } finally {
    db.close();
  }

  return { dbPath, dir };
}

function withPatchedFs(methods, fn) {
  const originals = {};
  for (const [name, replacement] of Object.entries(methods)) {
    originals[name] = fs[name];
    fs[name] = replacement;
  }

  try {
    return fn();
  } finally {
    for (const [name, original] of Object.entries(originals)) {
      fs[name] = original;
    }
  }
}

function withFreshServer(env, fn) {
  const modulePath = require.resolve('../mission-control/server.js');
  const keys = ['COYOTE_CLAW_DB', 'COYOTE_HALT_FILE'];
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
