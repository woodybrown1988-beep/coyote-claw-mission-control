'use strict';

// This module is deliberately pure: it turns a validated browser action into the only stock CLI
// argv shapes Mission Control is permitted to invoke. It performs no I/O and never builds a shell
// command string.

const ORDINARY_ID = /^[A-Za-z0-9._-]{1,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const KINDS = new Set(['full', 'spot']);
const WASTE_UNITS = new Set(['base', 'count', 'portion']);
const WASTE_REASONS = new Set(['prep', 'spoiled', 'dropped', 'over-made', 'returned', 'other']);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasFields(value, required, optional) {
  if (!isRecord(value)) return false;
  const permitted = new Set(required.concat(optional || []));
  const keys = Object.keys(value);
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
    && keys.every((key) => permitted.has(key));
}

function validDate(value) {
  if (typeof value !== 'string' || !DATE.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function validOrdinaryId(value) {
  return typeof value === 'string' && ORDINARY_ID.test(value);
}

function validUuid(value) {
  return typeof value === 'string' && UUID.test(value);
}

function validBy(value) {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= 64
    && value.trim() === value
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

function validPositive(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function validTarget(value) {
  if (typeof value !== 'string') return false;
  return value.startsWith('sku:')
    ? validOrdinaryId(value.slice(4))
    : validOrdinaryId(value);
}

function validNote(value) {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= 200
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

const STOCK_OPERATIONS = Object.freeze({
  'count-open'(args, by) {
    if (!hasFields(args, ['businessDate', 'kind'])) return null;
    if (!validDate(args.businessDate) || !KINDS.has(args.kind)) return null;
    return ['count-open', args.businessDate, args.kind, '--by', by];
  },
  'count-set'(args, by) {
    if (!hasFields(args, ['countId', 'ingredientId', 'location', 'countUnits'])) return null;
    if (!validUuid(args.countId)
        || !validOrdinaryId(args.ingredientId)
        || !validOrdinaryId(args.location)
        || (args.countUnits !== null && !validPositive(args.countUnits))) return null;
    const quantity = args.countUnits === null ? 'blank' : String(args.countUnits);
    return ['count-set', args.countId, args.ingredientId, args.location, quantity, '--by', by];
  },
  'count-close'(args, by) {
    if (!hasFields(args, ['countId']) || !validUuid(args.countId)) return null;
    return ['count-close', args.countId, '--by', by];
  },
  waste(args, by) {
    if (!hasFields(args, ['target', 'qty', 'unit', 'reason'], ['note'])) return null;
    if (!validTarget(args.target)
        || !validPositive(args.qty)
        || !WASTE_UNITS.has(args.unit)
        || !WASTE_REASONS.has(args.reason)
        || (Object.prototype.hasOwnProperty.call(args, 'note') && !validNote(args.note))) return null;
    const argv = ['waste', args.target, String(args.qty), args.unit, args.reason];
    if (Object.prototype.hasOwnProperty.call(args, 'note')) argv.push('--note', args.note);
    argv.push('--by', by);
    return argv;
  },
  'waste-void'(args, by) {
    if (!hasFields(args, ['id']) || !validUuid(args.id)) return null;
    return ['waste-void', args.id, '--by', by];
  },
});

function buildStockArgv(input, allowlist = STOCK_OPERATIONS) {
  if (!hasFields(input, ['op', 'args', 'by'])) return { error: 'expected only op, args and by' };
  if (typeof input.op !== 'string'
      || !allowlist
      || typeof allowlist !== 'object'
      || !Object.prototype.hasOwnProperty.call(allowlist, input.op)
      || typeof allowlist[input.op] !== 'function') {
    return { error: 'unknown operation' };
  }
  if (!validBy(input.by)) return { error: 'invalid by' };
  const argv = allowlist[input.op](input.args, input.by);
  return argv ? { argv } : { error: 'invalid arguments' };
}

module.exports = { buildStockArgv };
