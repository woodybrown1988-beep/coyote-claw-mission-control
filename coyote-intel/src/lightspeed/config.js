'use strict';

const path = require('node:path');

const TRIAL_API_BASE_URL = 'https://api.trial.lsk.lightspeed.app';
const PRODUCTION_API_BASE_URL = 'https://api.lsk.lightspeed.app';
const DEFAULT_OUTPUT_DIR = 'coyote-intel/output/lightspeed-kseries';
const MAX_SALES_PAGE_SIZE = 100;
const MAX_STAFF_PAGE_SIZE = 1000;

function isTruthy(value) {
  return ['1', 'true', 'yes', 'y', 'on'].includes(String(value || '').trim().toLowerCase());
}

function parseList(value, name) {
  if (!value || !String(value).trim()) {
    throw new Error(`${name} is required`);
  }
  return String(value)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseInteger(value, name, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new Error(`${name} is required`);
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  }
  return parsed;
}

function resolveRepoPath(value, rootDir) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  return path.isAbsolute(raw) ? raw : path.resolve(rootDir, raw);
}

function loadConfig(env = process.env, options = {}) {
  const rootDir = options.rootDir || path.resolve(__dirname, '../../..');
  const lightspeedEnv = String(env.LIGHTSPEED_KSERIES_ENV || '').trim();
  if (!['trial', 'production'].includes(lightspeedEnv)) {
    throw new Error('LIGHTSPEED_KSERIES_ENV must be trial or production');
  }

  const required = [
    'LIGHTSPEED_KSERIES_CLIENT_ID',
    'LIGHTSPEED_KSERIES_CLIENT_SECRET',
    'LIGHTSPEED_KSERIES_REDIRECT_URI',
    'LIGHTSPEED_KSERIES_SCOPES',
    'LIGHTSPEED_KSERIES_TOKEN_STORE_PATH',
    'LIGHTSPEED_KSERIES_STATE_STORE_PATH',
    'LIGHTSPEED_KSERIES_LOCATION_IDS',
    'LIGHTSPEED_KSERIES_LOOKBACK_DAYS'
  ];
  for (const name of required) {
    if (!env[name] || !String(env[name]).trim()) {
      throw new Error(`${name} is required`);
    }
  }

  const scopes = parseList(env.LIGHTSPEED_KSERIES_SCOPES, 'LIGHTSPEED_KSERIES_SCOPES');
  const locationIds = parseList(env.LIGHTSPEED_KSERIES_LOCATION_IDS, 'LIGHTSPEED_KSERIES_LOCATION_IDS');
  const outputDir = resolveRepoPath(env.LIGHTSPEED_KSERIES_OUTPUT_DIR || DEFAULT_OUTPUT_DIR, rootDir);
  const salesPageSize = Math.min(
    parseInteger(env.LIGHTSPEED_KSERIES_SALES_PAGE_SIZE || '100', 'LIGHTSPEED_KSERIES_SALES_PAGE_SIZE', { min: 1, max: MAX_SALES_PAGE_SIZE }),
    MAX_SALES_PAGE_SIZE
  );
  const staffPageSize = Math.min(
    parseInteger(env.LIGHTSPEED_KSERIES_STAFF_PAGE_SIZE || '100', 'LIGHTSPEED_KSERIES_STAFF_PAGE_SIZE', { min: 1, max: MAX_STAFF_PAGE_SIZE }),
    MAX_STAFF_PAGE_SIZE
  );

  return {
    env: lightspeedEnv,
    enabled: isTruthy(env.LIGHTSPEED_KSERIES_ENABLED),
    parallelRun: isTruthy(env.LIGHTSPEED_KSERIES_PARALLEL_RUN),
    clientId: String(env.LIGHTSPEED_KSERIES_CLIENT_ID),
    clientSecret: String(env.LIGHTSPEED_KSERIES_CLIENT_SECRET),
    redirectUri: String(env.LIGHTSPEED_KSERIES_REDIRECT_URI),
    scopes,
    tokenStorePath: resolveRepoPath(env.LIGHTSPEED_KSERIES_TOKEN_STORE_PATH, rootDir),
    stateStorePath: resolveRepoPath(env.LIGHTSPEED_KSERIES_STATE_STORE_PATH, rootDir),
    outputDir,
    locationIds,
    lookbackDays: parseInteger(env.LIGHTSPEED_KSERIES_LOOKBACK_DAYS, 'LIGHTSPEED_KSERIES_LOOKBACK_DAYS', { min: 0, max: 365 }),
    apiBaseUrl: lightspeedEnv === 'trial' ? TRIAL_API_BASE_URL : PRODUCTION_API_BASE_URL,
    authUrl: String(env.LIGHTSPEED_KSERIES_AUTH_URL || '').trim(),
    tokenUrl: String(env.LIGHTSPEED_KSERIES_TOKEN_URL || '').trim(),
    salesPageSize,
    staffPageSize,
    retryCount: parseInteger(env.LIGHTSPEED_KSERIES_RETRY_COUNT || '2', 'LIGHTSPEED_KSERIES_RETRY_COUNT', { min: 0, max: 8 })
  };
}

function assertConnectorEnabled(config) {
  if (!config || !config.enabled) {
    throw new Error('LIGHTSPEED_KSERIES_ENABLED is not truthy; refusing to call Lightspeed.');
  }
}

module.exports = {
  DEFAULT_OUTPUT_DIR,
  MAX_SALES_PAGE_SIZE,
  MAX_STAFF_PAGE_SIZE,
  PRODUCTION_API_BASE_URL,
  TRIAL_API_BASE_URL,
  assertConnectorEnabled,
  isTruthy,
  loadConfig,
  parseList,
  parseInteger
};
