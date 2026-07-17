/**
 * background.js — Citrix Monitor Enhanced
 *
 * No token handling needed — Director's service.svc uses cookie-based
 * session auth, which the browser attaches automatically.
 *
 * This worker's one job: relay on-demand POST requests to Director's
 * service.svc on behalf of content.js. This has to happen here rather
 * than in the content script because cross-origin fetches (the Monitor
 * page's origin vs. the regional director-*.cloud.com origin) need the
 * extension's host_permissions to bypass CORS — a content script fetch
 * is still bound by the page's own CORS rules.
 */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'DIRECTOR_POST') {
    const { directorBase, method, body } = message;

    fetch(`${directorBase}/Director/service.svc/web/${method}`, {
      method: 'POST',
      credentials: 'include', // browser attaches the Director session cookie
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => sendResponse({ ok: true, data: json }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));

    return true; // keep channel open for async response
  }

  if (message.type === 'OPEN_OPTIONS') {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return true;
  }
});

// ── Install / startup ────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get('cmeSettings', (result) => {
    if (!result.cmeSettings) {
      chrome.storage.sync.set({
        cmeSettings: {
          layoutMode: 'inline',       // 'inline' | 'floating' | 'drawer' | 'popup'
          customFields: [],            // field names to pluck from captured Director responses
          showLogonDuration: true,
          showVdaInfo: true,
          showMachineInfo: true,
          accentColor: '#00b2e3',      // Citrix blue
        },
      });
    }
  });
});
