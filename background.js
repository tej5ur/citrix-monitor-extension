/**
 * background.js — Citrix Monitor Enhanced
 *
 * Intercepts outgoing requests to Citrix DaaS APIs to capture the
 * bearer token already present in the active Monitor session.
 * The token is stored in chrome.storage.session (ephemeral — cleared
 * when the browser closes) and shared with content scripts on demand.
 */

const CITRIX_API_PATTERNS = [
  /https:\/\/[^/]+\.cloud\.com\/monitorodata/,
  /https:\/\/[^/]+\.cloud\.com\/cvad\/manage/,
  /https:\/\/[^/]+\.citrixworkspacesapi\.net/,
];

// ── Token capture via declarativeNetRequest observer ────────────────────────
// We use webRequest-style header inspection via the background listener.
// MV3 doesn't have blocking webRequest, but we CAN observe request headers
// by listening to the onSendHeaders event (requires host_permissions).

chrome.webRequest
  ? attachWebRequestListener()
  : console.warn('[CME] webRequest API unavailable — using fallback token entry');

function attachWebRequestListener() {
  chrome.webRequest.onSendHeaders.addListener(
    (details) => {
      const authHeader = details.requestHeaders?.find(
        (h) => h.name.toLowerCase() === 'authorization'
      );
      if (authHeader?.value?.startsWith('CWSAuth bearer=') ||
          authHeader?.value?.startsWith('Bearer ')) {
        const token = authHeader.value
          .replace('CWSAuth bearer=', '')
          .replace('Bearer ', '')
          .replace(/^"|"$/g, ''); // strip surrounding quotes if present

        chrome.storage.session.set({
          citrixToken: token,
          tokenCapturedAt: Date.now(),
        });
      }
    },
    {
      urls: [
        'https://*.cloud.com/*',
        'https://*.citrixworkspacesapi.net/*',
        'http://localhost:8484/*',
      ],
    },
    ['requestHeaders']
  );
}

// ── Message handler ──────────────────────────────────────────────────────────
// Content scripts request the token + customer ID via message passing.

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_TOKEN') {
    chrome.storage.session.get(['citrixToken', 'tokenCapturedAt'], (result) => {
      if (!result.citrixToken) {
        sendResponse({ error: 'No token captured yet. Make sure you are logged in to Citrix Monitor.' });
        return;
      }

      // Warn if token is older than 55 minutes (Citrix tokens typically last 60 min)
      const ageMinutes = (Date.now() - (result.tokenCapturedAt || 0)) / 60000;
      sendResponse({
        token: result.citrixToken,
        stale: ageMinutes > 55,
        ageMinutes: Math.round(ageMinutes),
      });
    });
    return true; // keep channel open for async response
  }

  if (message.type === 'CLEAR_TOKEN') {
    chrome.storage.session.remove(['citrixToken', 'tokenCapturedAt']);
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === 'OPEN_OPTIONS') {
    // Content scripts can't call openOptionsPage directly — proxy it here
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return true;
  }
});

// ── Install / startup ────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  // Set defaults
  chrome.storage.sync.get('cmeSettings', (result) => {
    if (!result.cmeSettings) {
      chrome.storage.sync.set({
        cmeSettings: {
          layoutMode: 'inline',       // 'inline' | 'floating' | 'drawer' | 'popup'
          customFields: [],            // user-defined OData field paths
          showLogonDuration: true,
          showVdaInfo: true,
          showMachineInfo: true,
          accentColor: '#00b2e3',      // Citrix blue
        },
      });
    }
  });
});
