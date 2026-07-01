'use strict';

const fs = require('node:fs');
const path = require('node:path');

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return fallback;
    }
    throw error;
  }
}

function writeJsonFile(filePath, data) {
  ensureDir(filePath);
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(tmp, filePath);
}

class JsonStateStore {
  constructor(filePath) {
    this.filePath = filePath;
  }

  read() {
    const state = readJsonFile(this.filePath, {});
    state.locations = state.locations || {};
    return state;
  }

  write(state) {
    writeJsonFile(this.filePath, state);
  }

  getLocation(locationId) {
    const state = this.read();
    return state.locations[String(locationId)] || {};
  }

  updateLocation(locationId, patch) {
    const state = this.read();
    const key = String(locationId);
    state.locations[key] = { ...(state.locations[key] || {}), ...patch };
    writeJsonFile(this.filePath, state);
    return state.locations[key];
  }

  getSalesCursor(locationId) {
    return this.getLocation(locationId).salesCursor || null;
  }

  setSalesCursor(locationId, cursor) {
    return this.updateLocation(locationId, { salesCursor: cursor });
  }

  getLabourCursor(locationId) {
    return this.getLocation(locationId).labourCursor || null;
  }

  setLabourCursor(locationId, cursor) {
    return this.updateLocation(locationId, { labourCursor: cursor });
  }

  setEarliestSupportedDate(locationId, date) {
    return this.updateLocation(locationId, { earliestSupportedDate: date });
  }

  getEarliestSupportedDate(locationId) {
    return this.getLocation(locationId).earliestSupportedDate || null;
  }
}

module.exports = {
  JsonStateStore,
  ensureDir,
  readJsonFile,
  writeJsonFile
};
