'use strict';

const { chunkDateRange, outputPath, writeJsonl, writeJsonlUpsert } = require('./sales-sync.js');
const { normalizeSales, salesStableKey } = require('./normalize.js');

function dedupeRecords(records, keyFn) {
  const byKey = new Map();
  for (const record of records) {
    byKey.set(keyFn(record), record);
  }
  return Array.from(byKey.values()).sort((a, b) => String(keyFn(a)).localeCompare(String(keyFn(b))));
}

function extractEarliestSupportedDate(error) {
  const text = `${error && error.message || ''}\n${error && error.body || ''}`;
  const match = text.match(/earliest[^0-9]*(\d{4}-\d{2}-\d{2})/i) || text.match(/from[^0-9]*(\d{4}-\d{2}-\d{2})/i);
  return match ? match[1] : null;
}

async function runBackfill({ client, config, stateStore, from, to }) {
  const results = [];
  for (const locationId of config.locationIds) {
    for (const chunk of chunkDateRange(from, to)) {
      try {
        const rawRecords = await client.fetchSales(locationId, {
          from: chunk.from,
          to: chunk.to,
          pageSize: config.salesPageSize
        });
        const rawPath = outputPath(config.outputDir, 'raw/backfill-sales', locationId, chunk.from, chunk.to);
        writeJsonl(rawPath, rawRecords);
        const normalized = dedupeRecords(
          normalizeSales(rawRecords, { businessLocationId: locationId }),
          (record) => record.stable_key || salesStableKey(record)
        );
        const normalizedPath = outputPath(config.outputDir, 'normalized/backfill-sales', locationId, chunk.from, chunk.to);
        writeJsonlUpsert(normalizedPath, normalized, (record) => record.stable_key || salesStableKey(record));
        results.push({ locationId, from: chunk.from, to: chunk.to, rawPath, normalizedPath, rawCount: rawRecords.length, normalizedCount: normalized.length });
      } catch (error) {
        if (error && error.status === 400) {
          const earliest = extractEarliestSupportedDate(error);
          if (earliest) {
            stateStore.setEarliestSupportedDate(locationId, earliest);
            results.push({ locationId, from: chunk.from, to: chunk.to, skipped: true, earliestSupportedDate: earliest });
            continue;
          }
        }
        throw error;
      }
    }
  }
  return results;
}

module.exports = {
  dedupeRecords,
  extractEarliestSupportedDate,
  runBackfill
};
