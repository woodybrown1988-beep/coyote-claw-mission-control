'use strict';

const { normalizeLabour, labourStableKey } = require('./normalize.js');
const { outputPath, writeJsonl, writeJsonlUpsert } = require('./sales-sync.js');

function limitationResult(locationId, reason, detail) {
  return {
    type: 'lightspeed_staff_api_limitation',
    locationId,
    reason,
    detail: detail || null,
    fallback: 'Use the existing wage/labour-cost file drop until an approved source is supplied.'
  };
}

async function syncLabour({ client, config, stateStore, from, to }) {
  const results = [];
  if (!config.scopes.includes('staff-api')) {
    for (const locationId of config.locationIds) {
      const limitation = limitationResult(locationId, 'staff-api scope is not configured');
      const path = outputPath(config.outputDir, 'limitations/labour', locationId, from || 'incremental', to || 'now');
      writeJsonl(path, [limitation]);
      results.push({ ...limitation, limitationPath: path });
    }
    return results;
  }

  for (const locationId of config.locationIds) {
    try {
      const rawRecords = await client.fetchStaffShifts(locationId, {
        dateInUTCFrom: from,
        dateInUTCTo: to,
        size: config.staffPageSize
      });
      const rawPath = outputPath(config.outputDir, 'raw/labour', locationId, from || 'incremental', to || 'now');
      writeJsonl(rawPath, rawRecords);
      const normalized = normalizeLabour(rawRecords, { businessLocationId: locationId });
      const normalizedPath = outputPath(config.outputDir, 'normalized/labour', locationId, from || 'incremental', to || 'now');
      writeJsonlUpsert(normalizedPath, normalized, (record) => record.stable_key || labourStableKey(record));
      if (to) {
        stateStore.setLabourCursor(locationId, to);
      }
      results.push({ locationId, rawPath, normalizedPath, rawCount: rawRecords.length, normalizedCount: normalized.length });
    } catch (error) {
      if (error && (error.status === 401 || error.status === 403)) {
        const limitation = limitationResult(locationId, 'staff-api authorization failed', { status: error.status, body: error.body || null });
        const path = outputPath(config.outputDir, 'limitations/labour', locationId, from || 'incremental', to || 'now');
        writeJsonl(path, [limitation]);
        results.push({ ...limitation, limitationPath: path });
        continue;
      }
      throw error;
    }
  }
  return results;
}

module.exports = {
  limitationResult,
  syncLabour
};
