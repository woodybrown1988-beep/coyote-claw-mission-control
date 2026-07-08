'use strict';
// /claw is the ENGINE ROOM console — READ-ONLY by design. It shows agent state; EVERY action stays a
// Telegram tap. A console action button (data-op / data-log-action / a POST form / an /api/ fetch) would
// cross the nonce trust boundary. This is the tripwire: no page under the /claw workspace may emit a write
// affordance, and the registry must keep /claw = the console pages only, flagged read-only.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const SHARED = require('../mission-control/ui/shared.js');

const CLAW_DIR = path.join(__dirname, '..', 'mission-control', 'ui', 'pages', 'claw');
const clawFiles = fs.readdirSync(CLAW_DIR).filter((f) => f.endsWith('.js'));

test('registry: /claw = console pages only, flagged read-only, all under /claw/*', () => {
  const claw = SHARED.WORKSPACES.find((w) => w.key === 'claw');
  assert.ok(claw, 'claw workspace exists');
  assert.equal(claw.readOnly, true, 'claw is flagged read-only');
  const keys = claw.groups.flatMap((g) => g.items.map((i) => i.key)).sort();
  assert.deepEqual(keys, ['agents', 'health'], 'claw = agents + health (job states / spend / gates live inside them)');
  for (const g of claw.groups) for (const it of g.items) assert.match(it.route, /^\/claw\//, `${it.key} routes under /claw`);
});

test('NO /claw page source emits a write affordance (would cross the nonce trust boundary)', () => {
  // A console button/POST/fetch is the forbidden thing. Read-only surfaces link OUT to Telegram instead.
  const writeAffordance = /data-op=|data-log-action|method\s*=\s*["']?\s*post|fetch\s*\(|\/api\//i;
  assert.ok(clawFiles.length >= 2, 'agents + health present');
  for (const f of clawFiles) {
    const src = fs.readFileSync(path.join(CLAW_DIR, f), 'utf8');
    assert.doesNotMatch(src, writeAffordance, `${f}: /claw is read-only — no action button; actions are Telegram taps`);
  }
});
