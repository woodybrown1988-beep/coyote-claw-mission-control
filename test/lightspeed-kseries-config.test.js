'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { assertConnectorEnabled, isTruthy, loadConfig } = require('../coyote-intel/src/lightspeed/config.js');

function baseEnv(overrides = {}) {
  return {
    LIGHTSPEED_KSERIES_ENV: 'trial',
    LIGHTSPEED_KSERIES_CLIENT_ID: 'client-id',
    LIGHTSPEED_KSERIES_CLIENT_SECRET: 'client-secret',
    LIGHTSPEED_KSERIES_REDIRECT_URI: 'https://example.test/callback',
    LIGHTSPEED_KSERIES_SCOPES: 'financial-api,items,offline_access',
    LIGHTSPEED_KSERIES_TOKEN_STORE_PATH: 'tmp/token.json',
    LIGHTSPEED_KSERIES_STATE_STORE_PATH: 'tmp/state.json',
    LIGHTSPEED_KSERIES_OUTPUT_DIR: 'tmp/output',
    LIGHTSPEED_KSERIES_LOCATION_IDS: 'loc-1, loc-2',
    LIGHTSPEED_KSERIES_LOOKBACK_DAYS: '7',
    ...overrides
  };
}

test('loadConfig parses env, booleans, scopes, locations, and capped page size', () => {
  const config = loadConfig(baseEnv({
    LIGHTSPEED_KSERIES_ENABLED: 'yes',
    LIGHTSPEED_KSERIES_PARALLEL_RUN: 'true',
    LIGHTSPEED_KSERIES_SALES_PAGE_SIZE: '100'
  }), { rootDir: '/repo' });

  assert.equal(config.enabled, true);
  assert.equal(config.parallelRun, true);
  assert.deepEqual(config.scopes, ['financial-api', 'items', 'offline_access']);
  assert.deepEqual(config.locationIds, ['loc-1', 'loc-2']);
  assert.equal(config.lookbackDays, 7);
  assert.equal(config.apiBaseUrl, 'https://api.trial.lsk.lightspeed.app');
  assert.equal(config.salesPageSize, 100);
  assert.equal(config.outputDir, '/repo/tmp/output');
});

test('loadConfig rejects invalid env and missing required values', () => {
  assert.throws(() => loadConfig(baseEnv({ LIGHTSPEED_KSERIES_ENV: 'sandbox' })), /trial or production/);
  assert.throws(() => loadConfig(baseEnv({ LIGHTSPEED_KSERIES_CLIENT_SECRET: '' })), /CLIENT_SECRET is required/);
  assert.throws(() => loadConfig(baseEnv({ LIGHTSPEED_KSERIES_LOOKBACK_DAYS: '-1' })), /LOOKBACK_DAYS/);
});

test('assertConnectorEnabled fails closed when feature flag is falsey', () => {
  assert.equal(isTruthy('on'), true);
  assert.equal(isTruthy('0'), false);
  assert.throws(() => assertConnectorEnabled(loadConfig(baseEnv(), { rootDir: '/repo' })), /LIGHTSPEED_KSERIES_ENABLED/);
  assert.doesNotThrow(() => assertConnectorEnabled(loadConfig(baseEnv({ LIGHTSPEED_KSERIES_ENABLED: 'true' }), { rootDir: '/repo' })));
});
