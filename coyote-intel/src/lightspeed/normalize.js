'use strict';

const crypto = require('node:crypto');

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashRecord(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

function firstPresent(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return null;
}

function asNumber(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asArray(value) {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function salesStableKey(row) {
  const preferred = [
    row.business_id,
    row.business_location_id,
    row.account_reference,
    row.line_id,
    row.payment_uuid
  ].filter(Boolean);
  if (preferred.length >= 3) {
    return preferred.join('|');
  }
  return [
    row.business_id,
    row.business_location_id,
    row.account_fisc_id,
    row.receipt_id,
    row.external_reference,
    row.raw_record_hash
  ].filter(Boolean).join('|');
}

function labourStableKey(row) {
  return [row.business_location_id, row.shift_uuid].filter(Boolean).join('|');
}

function normalizeSalesRecord(sale, context = {}) {
  const account = sale.account || sale;
  const lines = asArray(sale.lines || sale.saleLines || sale.orderLines || sale.items);
  const payments = asArray(sale.payments || sale.paymentLines);
  const lineList = lines.length ? lines : [null];
  const paymentList = payments.length ? payments : [null];
  const rows = [];

  for (const line of lineList) {
    for (const payment of paymentList) {
      const row = {
        source_system: 'lightspeed-kseries',
        business_id: firstPresent(context.businessId, sale.businessId, sale.business_id),
        business_location_id: firstPresent(context.businessLocationId, sale.businessLocationId, sale.business_location_id),
        business_timezone: firstPresent(context.businessTimezone, sale.businessTimezone, sale.timezone),
        account_reference: firstPresent(account.accountReference, account.account_reference, account.reference, sale.id),
        account_fisc_id: firstPresent(account.fiscId, account.fisc_id),
        receipt_id: firstPresent(account.receiptId, account.receipt_id),
        sale_type: firstPresent(sale.saleType, sale.sale_type, sale.type),
        cancelled: Boolean(firstPresent(sale.cancelled, sale.isCancelled, false)),
        time_opened: firstPresent(sale.timeOpened, sale.time_opened, sale.openedAt),
        time_closed: firstPresent(sale.timeClosed, sale.time_closed, sale.closedAt),
        line_id: firstPresent(line && line.lineId, line && line.line_id, line && line.id),
        parent_line_id: firstPresent(line && line.parentLineId, line && line.parent_line_id),
        sku: firstPresent(line && line.sku, line && line.itemSku, line && line.item_id),
        item_name: firstPresent(line && line.itemName, line && line.item_name, line && line.name),
        quantity: asNumber(firstPresent(line && line.quantity, line && line.qty)),
        gross_amount: asNumber(firstPresent(line && line.grossAmount, line && line.gross_amount, line && line.gross)),
        net_amount: asNumber(firstPresent(line && line.netAmount, line && line.net_amount, line && line.net)),
        tax_amount: asNumber(firstPresent(line && line.taxAmount, line && line.tax_amount, line && line.tax)),
        discount_amount: asNumber(firstPresent(line && line.discountAmount, line && line.discount_amount, line && line.discount)),
        accounting_group_id: firstPresent(line && line.accountingGroupId, line && line.accounting_group_id),
        category_ids: asArray(firstPresent(line && line.categoryIds, line && line.category_ids)),
        revenue_center_id: firstPresent(account.revenueCenterId, account.revenue_center_id, sale.revenueCenterId),
        staff_id: firstPresent(line && line.staffId, account.staffId, sale.staffId, sale.staff_id),
        device_id: firstPresent(account.deviceId, sale.deviceId, sale.device_id),
        void_reason: firstPresent(line && line.voidReason, sale.voidReason, sale.void_reason),
        payment_uuid: firstPresent(payment && payment.uuid, payment && payment.paymentUuid, payment && payment.id),
        payment_fisc_id: firstPresent(payment && payment.fiscId, payment && payment.fisc_id),
        payment_method_id: firstPresent(payment && payment.methodId, payment && payment.paymentMethodId, payment && payment.payment_method_id),
        payment_method_code: firstPresent(payment && payment.methodCode, payment && payment.paymentMethodCode, payment && payment.payment_method_code),
        payment_amount: asNumber(firstPresent(payment && payment.amount, payment && payment.paymentAmount, payment && payment.payment_amount)),
        tip_amount: asNumber(firstPresent(payment && payment.tipAmount, payment && payment.tip_amount, sale.tipAmount)),
        external_reference: firstPresent(account.externalReference, account.external_reference, sale.externalReference),
        refund_initial_account_id: firstPresent(account.refundInitialAccountId, account.refund_initial_account_id),
        refund_previous_account_id: firstPresent(account.refundPreviousAccountId, account.refund_previous_account_id),
        raw_record_hash: hashRecord(sale)
      };
      rows.push({ ...row, stable_key: salesStableKey(row) });
    }
  }

  return rows;
}

function normalizeSales(records, context = {}) {
  return asArray(records).flatMap((record) => normalizeSalesRecord(record, context));
}

function eventTimestamp(event) {
  return firstPresent(event && event.dateInUTC, event && event.timestamp, event && event.time, event && event.createdAt);
}

function latestEventByType(events, type) {
  return events
    .filter((event) => String(firstPresent(event.type, event.eventType, event.name)).toUpperCase() === type)
    .sort((a, b) => Date.parse(eventTimestamp(b) || 0) - Date.parse(eventTimestamp(a) || 0))[0] || null;
}

function normalizeLabourShift(shift, context = {}) {
  const events = asArray(shift.events);
  const clockIn = latestEventByType(events, 'CLOCK_IN');
  const clockOut = latestEventByType(events, 'CLOCK_OUT');
  const staff = shift.staff || context.staffById && context.staffById[shift.staffId] || {};
  const row = {
    source_system: 'lightspeed-kseries',
    business_id: firstPresent(context.businessId, shift.businessId, shift.business_id),
    business_location_id: firstPresent(context.businessLocationId, shift.businessLocationId, shift.business_location_id),
    shift_uuid: firstPresent(shift.uuid, shift.shiftUuid, shift.id),
    staff_id: firstPresent(shift.staffId, shift.staff_id, staff.id),
    device_id: firstPresent(shift.deviceId, shift.device_id),
    declared_cash_tips: asNumber(firstPresent(shift.declaredCashTips, shift.declared_cash_tips)),
    last_updated_utc: firstPresent(shift.modifiedAt, shift.updatedAt, shift.lastUpdatedUTC, eventTimestamp(clockOut), eventTimestamp(clockIn)),
    clock_in_timestamp: eventTimestamp(clockIn),
    clock_out_timestamp: eventTimestamp(clockOut),
    event_uuids: events.map((event) => firstPresent(event.uuid, event.id)).filter(Boolean),
    staff_active: firstPresent(staff.active, staff.isActive, null),
    staff_name: firstPresent(staff.name, staff.displayName, staff.fullName),
    staff_email: firstPresent(staff.email),
    roles: asArray(firstPresent(staff.roles, staff.groups)),
    raw_record_hash: hashRecord(shift)
  };
  return { ...row, stable_key: labourStableKey(row) };
}

function normalizeLabour(records, context = {}) {
  return asArray(records).map((record) => normalizeLabourShift(record, context));
}

module.exports = {
  asNumber,
  businessDate,
  hashRecord,
  labourStableKey,
  normalizeLabour,
  normalizeLabourShift,
  normalizeSales,
  normalizeSalesRecord,
  salesStableKey,
  stableStringify
};

function businessDate(timestamp, timezone = 'UTC') {
  if (!timestamp) {
    return 'unknown';
  }
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) {
    return 'unknown';
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}
