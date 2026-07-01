'use strict';

const fs = require('node:fs');
const { businessDate, salesStableKey } = require('./normalize.js');
const { readJsonl, writeJsonl } = require('./sales-sync.js');

const TOTAL_FIELDS = ['gross_amount', 'net_amount', 'tax_amount', 'discount_amount', 'payment_amount', 'tip_amount'];

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) {
    return [];
  }
  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] || '']));
  });
}

function splitCsvLine(line) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      cells.push(cell);
      cell = '';
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}

function readOperatorRecords(filePath) {
  if (filePath.endsWith('.jsonl')) {
    return readJsonl(filePath);
  }
  const text = fs.readFileSync(filePath, 'utf8');
  if (filePath.endsWith('.json')) {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : parsed.records || [];
  }
  if (filePath.endsWith('.csv')) {
    return parseCsv(text);
  }
  throw new Error(`Unsupported reconciliation input: ${filePath}`);
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function stableKey(record) {
  return record.stable_key || record.file_drop_key || salesStableKey(record);
}

function businessWeek(dateString) {
  if (!dateString || dateString === 'unknown') {
    return 'unknown';
  }
  const date = new Date(`${dateString}T00:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date.toISOString().slice(0, 10);
}

function summarize(records, timezoneByLocation = {}) {
  const summary = {};
  for (const record of records) {
    const location = record.business_location_id || record.location_id || 'unknown';
    const day = businessDate(record.time_closed || record.business_day || record.date, timezoneByLocation[location] || record.business_timezone || 'UTC');
    const week = businessWeek(day);
    const key = `${location}|${day}|${week}`;
    summary[key] = summary[key] || {
      business_location_id: location,
      business_day: day,
      business_week_start: week,
      record_count: 0,
      totals: Object.fromEntries(TOTAL_FIELDS.map((field) => [field, 0]))
    };
    summary[key].record_count += 1;
    for (const field of TOTAL_FIELDS) {
      summary[key].totals[field] += toNumber(record[field]);
    }
  }
  return Object.values(summary).sort((a, b) => `${a.business_location_id}|${a.business_day}`.localeCompare(`${b.business_location_id}|${b.business_day}`));
}

function diffRecords(apiRecords, fileDropRecords, options = {}) {
  const epsilon = options.materialityEpsilon === undefined ? 0.01 : options.materialityEpsilon;
  const apiByKey = new Map(apiRecords.map((record) => [stableKey(record), record]));
  const dropByKey = new Map(fileDropRecords.map((record) => [stableKey(record), record]));
  const missingInApi = [];
  const missingInFileDrop = [];
  const changedRecords = [];

  for (const [key, drop] of dropByKey.entries()) {
    const api = apiByKey.get(key);
    if (!api) {
      missingInApi.push({ stable_key: key, file_drop_record: drop });
      continue;
    }
    const changedFields = [];
    for (const field of TOTAL_FIELDS) {
      const delta = toNumber(api[field]) - toNumber(drop[field]);
      if (Math.abs(delta) > epsilon) {
        changedFields.push({ field, api: toNumber(api[field]), file_drop: toNumber(drop[field]), delta });
      }
    }
    if (changedFields.length) {
      changedRecords.push({
        stable_key: key,
        changed_fields: changedFields,
        material_difference_explanation: options.materialDifferenceExplanation || 'operator review required'
      });
    }
  }

  for (const [key, api] of apiByKey.entries()) {
    if (!dropByKey.has(key)) {
      missingInFileDrop.push({ stable_key: key, api_record: api });
    }
  }

  return { missingInApi, missingInFileDrop, changedRecords };
}

function reconcileRecords(apiRecords, fileDropRecords, options = {}) {
  const diff = diffRecords(apiRecords, fileDropRecords, options);
  return {
    generated_at: new Date(options.generatedAt || Date.now()).toISOString(),
    input: {
      api_record_count: apiRecords.length,
      file_drop_record_count: fileDropRecords.length
    },
    counts_by_location_business_day_week: {
      api: summarize(apiRecords, options.timezoneByLocation),
      file_drop: summarize(fileDropRecords, options.timezoneByLocation)
    },
    totals_compared: TOTAL_FIELDS,
    missing_in_api: diff.missingInApi,
    missing_in_file_drop: diff.missingInFileDrop,
    changed_records: diff.changedRecords,
    material_difference_explanations: diff.changedRecords.map((record) => ({
      stable_key: record.stable_key,
      explanation: record.material_difference_explanation
    }))
  };
}

function reconcileFiles({ apiPath, fileDropPaths, reportPath, options = {} }) {
  if (!fileDropPaths || fileDropPaths.length < 2) {
    throw new Error('At least two recent weekly file-drop paths are required for reconciliation.');
  }
  const apiRecords = readOperatorRecords(apiPath);
  const fileDropRecords = fileDropPaths.flatMap(readOperatorRecords);
  const report = reconcileRecords(apiRecords, fileDropRecords, options);
  if (reportPath) {
    writeJsonl(reportPath, [report]);
  }
  return report;
}

module.exports = {
  TOTAL_FIELDS,
  businessWeek,
  diffRecords,
  parseCsv,
  readOperatorRecords,
  reconcileFiles,
  reconcileRecords,
  splitCsvLine,
  summarize
};
