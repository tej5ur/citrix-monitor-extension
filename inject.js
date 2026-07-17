/**
 * inject.js — Citrix Monitor Enhanced
 *
 * Runs in the page's MAIN world (real window context, not the isolated
 * content-script sandbox) so it can wrap window.fetch and see the exact
 * calls Citrix Director's own UI makes to its service.svc backend.
 *
 * We don't invent our own API calls here — we observe the request body
 * (which carries siteId/sessionId/userId/machineId) and the response body
 * of calls Director already makes, then hand both to content.js via
 * window.postMessage. This works regardless of which regional Director
 * domain a given tenant uses (director-aps-s-b.cloud.com, director-us-*,
 * etc.) since we never hardcode it — we read it from the observed request.
 */

(function () {
  'use strict';

  const DIRECTOR_PATTERN = /\/Director\/service\.svc\/web\/([A-Za-z]+)/;
  const originalFetch = window.fetch;

  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : input?.url || '';
    const match = url.match(DIRECTOR_PATTERN);

    // Not a Director API call — pass through untouched
    if (!match) return originalFetch.apply(this, arguments);

    const method = match[1];
    let requestBody = null;
    try {
      const rawBody = init?.body ?? (typeof input !== 'string' ? await input.clone().text() : null);
      if (rawBody) requestBody = JSON.parse(rawBody);
    } catch (_) { /* body wasn't JSON or wasn't readable — ignore */ }

    const response = await originalFetch.apply(this, arguments);

    // Clone so Director's own code still gets an unconsumed response stream
    response
      .clone()
      .json()
      .then((responseBody) => {
        window.postMessage(
          {
            source: 'CME_INJECT',
            method,
            url,
            origin: new URL(url).origin,
            request: requestBody,
            response: responseBody,
            capturedAt: Date.now(),
          },
          '*'
        );
      })
      .catch(() => { /* non-JSON response — not something we care about */ });

    return response;
  };
})();
