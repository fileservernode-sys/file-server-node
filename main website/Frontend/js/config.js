/**
 * ZdexCloud Global Frontend Configuration
 * Authoritative Environment & Endpoint Definition
 */
(function(window) {
  'use strict';

  const host = typeof window !== 'undefined' ? window.location.hostname : '';
  const protocol = typeof window !== 'undefined' ? window.location.protocol : '';
  const isLocal = host === 'localhost' || host === '127.0.0.1' || protocol === 'file:' || !host;

  const API_BASE_URL = isLocal
    ? 'http://localhost:4000/api/v1'
    : 'https://api.zdexcloud.com/api/v1';

  const GATEWAY_WS_URL = isLocal
    ? 'ws://localhost:4001'
    : 'wss://gateway.zdexcloud.com';

  const BASE_DOMAIN = isLocal ? 'localhost' : 'zdexcloud.com';

  // Export on window for both legacy and standard consumers
  window.API_BASE_URL = API_BASE_URL;
  window.WS_URL = GATEWAY_WS_URL;
  window.GATEWAY_WS_URL = GATEWAY_WS_URL;

  window.CONFIG = {
    API_BASE_URL: API_BASE_URL,
    WS_URL: GATEWAY_WS_URL,
    GATEWAY_WS_URL: GATEWAY_WS_URL,
    BASE_DOMAIN: BASE_DOMAIN,
    APP_NAME: 'ZdexCloud'
  };
})(typeof window !== 'undefined' ? window : this);
