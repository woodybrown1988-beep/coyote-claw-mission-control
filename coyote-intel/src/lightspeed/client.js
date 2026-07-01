'use strict';

const { setTimeout: sleep } = require('node:timers/promises');
const { MAX_SALES_PAGE_SIZE, MAX_STAFF_PAGE_SIZE } = require('./config.js');

const TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

function capPageSize(value, max) {
  const parsed = Number.parseInt(String(value || max), 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return max;
  }
  return Math.min(parsed, max);
}

function retryAfterMs(headerValue) {
  if (!headerValue) {
    return 0;
  }
  const seconds = Number(headerValue);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const date = Date.parse(headerValue);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}

function appendQuery(path, query) {
  const url = new URL(path, 'https://placeholder.local');
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  return `${url.pathname}${url.search}`;
}

class LightspeedClient {
  constructor(config, tokenManager, options = {}) {
    this.config = config;
    this.tokenManager = tokenManager;
    this.fetch = options.fetch || globalThis.fetch;
    this.sleep = options.sleep || sleep;
    if (!this.fetch) {
      throw new Error('fetch is required for Lightspeed API calls');
    }
  }

  async request(path, options = {}) {
    const url = new URL(path, this.config.apiBaseUrl).toString();
    const retryCount = options.retryCount === undefined ? this.config.retryCount : options.retryCount;
    let attempt = 0;
    let accessToken = await this.tokenManager.getAccessToken();

    while (true) {
      const response = await this.fetch(url, {
        ...options,
        headers: {
          ...(options.headers || {}),
          Authorization: `Bearer ${accessToken}`
        }
      });

      if (response.status === 401 && attempt === 0) {
        await this.tokenManager.refreshToken(this.tokenManager.readToken().refresh_token);
        accessToken = await this.tokenManager.getAccessToken();
        attempt += 1;
        continue;
      }

      if (TRANSIENT_STATUSES.has(response.status) && attempt < retryCount) {
        attempt += 1;
        const waitMs = retryAfterMs(response.headers && response.headers.get && response.headers.get('retry-after'));
        if (waitMs > 0) {
          await this.sleep(waitMs);
        }
        continue;
      }

      const text = await response.text();
      if (!response.ok) {
        const error = new Error(`Lightspeed API HTTP ${response.status}: ${text}`);
        error.status = response.status;
        error.body = text;
        throw error;
      }
      return text ? JSON.parse(text) : {};
    }
  }

  async get(path, query) {
    return this.request(appendQuery(path, query), { method: 'GET' });
  }

  async fetchSalesPage(businessLocationId, params) {
    const pageSize = capPageSize(params.pageSize || this.config.salesPageSize, MAX_SALES_PAGE_SIZE);
    return this.get(`/f/v2/business-location/${encodeURIComponent(businessLocationId)}/sales`, {
      ...params,
      pageSize
    });
  }

  async fetchSales(businessLocationId, params = {}) {
    const records = [];
    let nextPageToken = params.nextPageToken || null;
    do {
      const page = await this.fetchSalesPage(businessLocationId, { ...params, nextPageToken });
      const pageRecords = page.data || page.sales || page.items || [];
      records.push(...pageRecords);
      nextPageToken = page.nextPageToken || null;
    } while (nextPageToken);
    return records;
  }

  async fetchStaffShiftsPage(businessLocationId, params = {}) {
    const size = capPageSize(params.size || this.config.staffPageSize, MAX_STAFF_PAGE_SIZE);
    return this.get(`/staff/v1/businessLocations/${encodeURIComponent(businessLocationId)}/shift`, {
      ...params,
      size
    });
  }

  async fetchStaffShifts(businessLocationId, params = {}) {
    const records = [];
    let pageNumber = params.page || 0;
    while (true) {
      const page = await this.fetchStaffShiftsPage(businessLocationId, { ...params, page: pageNumber });
      const pageRecords = page.data || page.shifts || page.items || [];
      records.push(...pageRecords);
      const totalPages = page.totalPages || page.pageTotal || page.total_pages;
      const nextLink = page.links && (page.links.next || page.links.Next);
      if (Number.isInteger(totalPages) && pageNumber + 1 < totalPages) {
        pageNumber += 1;
      } else if (nextLink) {
        pageNumber += 1;
      } else {
        break;
      }
    }
    return records;
  }
}

module.exports = {
  LightspeedClient,
  appendQuery,
  capPageSize,
  retryAfterMs
};
