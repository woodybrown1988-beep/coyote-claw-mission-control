'use strict';

const { readJsonFile, writeJsonFile } = require('./state-store.js');

const EXPIRY_SKEW_SECONDS = 60;

function redactSecrets(value) {
  return String(value || '')
    .replace(/(client_secret=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/(refresh_token=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/(access_token=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/Basic\s+[A-Za-z0-9._~+/-]+=*/gi, 'Basic [REDACTED]');
}

function expiresAtFromTokenResponse(body, nowMs = Date.now()) {
  const expiresIn = Number(body && body.expires_in);
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new Error('Token response missing positive expires_in');
  }
  return new Date(nowMs + expiresIn * 1000).toISOString();
}

function isTokenExpired(token, nowMs = Date.now()) {
  if (!token || !token.access_token || !token.expires_at) {
    return true;
  }
  const expiresAt = Date.parse(token.expires_at);
  if (!Number.isFinite(expiresAt)) {
    return true;
  }
  return expiresAt <= nowMs + EXPIRY_SKEW_SECONDS * 1000;
}

class OAuthTokenManager {
  constructor(config, options = {}) {
    this.config = config;
    this.fetch = options.fetch || globalThis.fetch;
    if (!this.fetch) {
      throw new Error('fetch is required for OAuth token calls');
    }
  }

  readToken() {
    return readJsonFile(this.config.tokenStorePath, {});
  }

  writeToken(token) {
    writeJsonFile(this.config.tokenStorePath, token);
    return token;
  }

  buildAuthUrl(state) {
    if (!this.config.authUrl) {
      throw new Error('LIGHTSPEED_KSERIES_AUTH_URL must be set to the Lightspeed-issued authorization URL');
    }
    const url = new URL(this.config.authUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('redirect_uri', this.config.redirectUri);
    url.searchParams.set('scope', this.config.scopes.join(' '));
    if (state) {
      url.searchParams.set('state', state);
    }
    return url.toString();
  }

  async exchangeCode(code, nowMs = Date.now()) {
    return this.tokenRequest(new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.redirectUri
    }), nowMs);
  }

  async getAccessToken(nowMs = Date.now()) {
    const token = this.readToken();
    if (!isTokenExpired(token, nowMs)) {
      return token.access_token;
    }
    const refreshed = await this.refreshToken(token.refresh_token, nowMs);
    return refreshed.access_token;
  }

  async refreshToken(refreshToken, nowMs = Date.now()) {
    if (!refreshToken) {
      throw new Error('No refresh token is available');
    }
    return this.tokenRequest(new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    }), nowMs);
  }

  async tokenRequest(body, nowMs) {
    if (!this.config.tokenUrl) {
      throw new Error('LIGHTSPEED_KSERIES_TOKEN_URL must be set to the Lightspeed-issued token URL');
    }
    const basic = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64');
    let response;
    try {
      response = await this.fetch(this.config.tokenUrl, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body
      });
    } catch (error) {
      throw new Error(redactSecrets(`Token request failed: ${error.message}`));
    }
    const text = await response.text();
    if (!response.ok) {
      throw new Error(redactSecrets(`Token request failed with HTTP ${response.status}: ${text}`));
    }
    const parsed = text ? JSON.parse(text) : {};
    const token = {
      access_token: parsed.access_token,
      refresh_token: parsed.refresh_token,
      token_type: parsed.token_type || 'Bearer',
      scope: parsed.scope,
      expires_at: expiresAtFromTokenResponse(parsed, nowMs)
    };
    if (!token.access_token || !token.refresh_token) {
      throw new Error('Token response missing access_token or rotated refresh_token');
    }
    return this.writeToken(token);
  }
}

module.exports = {
  EXPIRY_SKEW_SECONDS,
  OAuthTokenManager,
  expiresAtFromTokenResponse,
  isTokenExpired,
  redactSecrets
};
