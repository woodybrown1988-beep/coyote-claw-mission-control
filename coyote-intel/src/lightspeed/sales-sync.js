'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { normalizeSales, salesStableKey } = require('./normalize.js');
const { ensureDir } = require('./state-store.js');

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_SALES_RANGE_DAYS = 365;

function isoDateTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`Invalid ISO timestamp: ${value}`);
  }
  return date.toISOString();
}

function addDaysIso(value, days) {
  return new Date(Date.parse(value) + days * DAY_MS).toISOString();
}

function chunkDateRange(from, to, maxDays = MAX_SALES_RANGE_DAYS) {
  const chunks = [];
  let cursor = isoDateTime(from);
  const end = isoDateTime(to);
  while (Date.parse(cursor) < Date.parse(end)) {
    const chunkEnd = new Date(Math.min(Date.parse(addDaysIso(cursor, maxDays)), Date.parse(end))).toISOString();
    chunks.push({ from: cursor, to: chunkEnd });
    cursor = chunkEnd;
  }
  return chunks;
}

function outputPath(outputDir, kind, locationId, from, to) {
  const safeFrom = from.replace(/[:.]/g, '-');
  const safeTo = to.replace(/[:.]/g, '-');
  return path.join(outputDir, kind, `location-${locationId}-${safeFrom}-${safeTo}.jsonl`);
}

function readJsonl(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

function writeJsonl(filePath, records) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, records.map((record) => JSON.stringify(record)).join('\n') + (records.length ? '\n' : ''));
  return filePath;
}

function writeJsonlUpsert(filePath, records, keyFn) {
  const byKey = new Map();
  for (const record of readJsonl(filePath)) {
    byKey.set(keyFn(record), record);
  }
  for (const record of records) {
    byKey.set(keyFn(record), record);
  }
  return writeJsonl(filePath, Array.from(byKey.values()).sort((a, b) => String(keyFn(a)).localeCompare(String(keyFn(b)))));
}

function resolveSyncWindow(config, stateStore, locationId, options = {}) {
  const to = isoDateTime(options.to || new Date().toISOString());
  if (options.from) {
    return { from: isoDateTime(options.from), to };
  }
  const cursor = stateStore.getSalesCursor(locationId);
  if (cursor) {
    return { from: addDaysIso(cursor, -config.lookbackDays), to };
  }
  return { from: addDaysIso(to, -config.lookbackDays), to };
}

async function syncSales({ client, config, stateStore, from, to }) {
  const results = [];
  for (const locationId of config.locationIds) {
    const window = resolveSyncWindow(config, stateStore, locationId, { from, to });
    const chunks = chunkDateRange(window.from, window.to);
    for (const chunk of chunks) {
      const rawRecords = await client.fetchSales(locationId, {
        from: chunk.from,
        to: chunk.to,
        pageSize: config.salesPageSize
      });
      const rawPath = outputPath(config.outputDir, 'raw/sales', locationId, chunk.from, chunk.to);
      writeJsonl(rawPath, rawRecords);
      const normalized = normalizeSales(rawRecords, {
        businessLocationId: locationId,
        businessTimezone: config.businessTimezoneByLocation && config.businessTimezoneByLocation[locationId]
      });
      const normalizedPath = outputPath(config.outputDir, 'normalized/sales', locationId, chunk.from, chunk.to);
      writeJsonlUpsert(normalizedPath, normalized, (record) => record.stable_key || salesStableKey(record));
      results.push({ locationId, from: chunk.from, to: chunk.to, rawPath, normalizedPath, rawCount: rawRecords.length, normalizedCount: normalized.length });
    }
    stateStore.setSalesCursor(locationId, window.to);
  }
  return results;
}

module.exports = {
  MAX_SALES_RANGE_DAYS,
  chunkDateRange,
  outputPath,
  readJsonl,
  resolveSyncWindow,
  syncSales,
  writeJsonl,
  writeJsonlUpsert
};
