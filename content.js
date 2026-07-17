/**
 * content.js — Citrix Monitor Enhanced
 *
 * Watches for navigation within the Monitor SPA and injects the
 * enhanced detail panel when a session or machine detail view is active.
 */

(function () {
  'use strict';

  let lastUrl = location.href;
  let panelMounted = false;
  let settings = {};

  // ── Bootstrap ──────────────────────────────────────────────────────────────

  init();

  async function init() {
    settings = await loadSettings();
    observeNavigation();
    tryMount();
  }

  function loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.sync.get('cmeSettings', (result) => {
        resolve(result.cmeSettings || {});
      });
    });
  }

  // ── SPA navigation observer ────────────────────────────────────────────────
  // Citrix Monitor is an Angular SPA — URL changes don't trigger page reloads.

  function observeNavigation() {
    // Watch for URL changes via MutationObserver on the document title
    // (reliable across Angular router transitions)
    const titleObserver = new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        panelMounted = false;
        // Small delay to let Angular finish rendering the new view
        setTimeout(tryMount, 800);
      }
    });

    titleObserver.observe(document.querySelector('title') || document.head, {
      subtree: true,
      characterData: true,
      childList: true,
    });

    // Also observe DOM mutations for the detail container appearing
    const domObserver = new MutationObserver(() => {
      if (!panelMounted) tryMount();
    });

    domObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  // ── Page detection ─────────────────────────────────────────────────────────

  function detectPageContext() {
    const url = location.href;

    // Session detail: /Sessions/{sessionKey} or ?sessionid=
    const sessionMatch =
      url.match(/[?&]sessionid=([^&]+)/i) ||
      url.match(/\/sessions\/([a-z0-9-]+)/i) ||
      url.match(/session[Kk]ey[=:]([a-z0-9-]+)/);

    // Machine detail: /Machines/{machineId} or ?machineid=
    const machineMatch =
      url.match(/[?&]machineid=([^&]+)/i) ||
      url.match(/\/machines\/([a-z0-9-]+)/i);

    // User detail: /Users/{userId}
    const userMatch =
      url.match(/[?&]userid=([^&]+)/i) ||
      url.match(/\/users\/([a-z0-9-]+)/i);

    if (sessionMatch) return { type: 'session', id: sessionMatch[1] };
    if (machineMatch) return { type: 'machine', id: machineMatch[1] };
    if (userMatch)    return { type: 'user',    id: userMatch[1] };

    // Also check for Angular route state embedded in the page
    // Monitor encodes context in aria labels and headings
    const heading = document.querySelector('h1, [data-testid="detail-title"], .details-header');
    if (heading) {
      const text = heading.textContent.trim();
      if (text) return { type: 'unknown', label: text };
    }

    return null;
  }

  // ── Panel mounting ─────────────────────────────────────────────────────────

  function tryMount() {
    if (panelMounted) return;

    const ctx = detectPageContext();
    if (!ctx) return;

    // Find a suitable anchor in the Monitor DOM to attach our panel
    const anchor = findAnchor();
    if (!anchor) return;

    panelMounted = true;
    mountPanel(anchor, ctx);
  }

  function findAnchor() {
    // Citrix Monitor detail pages use consistent container class names
    const candidates = [
      '.details-container',
      '.monitor-details',
      '[class*="details-panel"]',
      '[class*="detail-view"]',
      'main[role="main"]',
      '#content',
      '.content-area',
    ];

    for (const selector of candidates) {
      const el = document.querySelector(selector);
      if (el) return el;
    }
    return null;
  }

  function mountPanel(anchor, ctx) {
    // Remove any previously mounted panel
    document.getElementById('cme-panel-root')?.remove();

    const root = document.createElement('div');
    root.id = 'cme-panel-root';
    root.setAttribute('data-cme-layout', settings.layoutMode || 'inline');
    root.setAttribute('data-cme-context', ctx.type);

    // Apply layout wrapper class
    const layout = settings.layoutMode || 'inline';
    root.className = `cme-panel cme-layout-${layout}`;

    // Render loading skeleton
    root.innerHTML = buildLoadingSkeleton(ctx);

    // Insert based on layout mode
    switch (layout) {
      case 'floating':
        document.body.appendChild(root);
        makeDraggable(root);
        break;
      case 'drawer':
        document.body.appendChild(root);
        addDrawerToggle(root);
        break;
      case 'popup':
        // Popup layout is handled by popup.html — skip injection
        panelMounted = false;
        return;
      case 'inline':
      default:
        anchor.insertAdjacentElement('afterend', root);
        break;
    }

    // Fetch and render data
    fetchAndRender(root, ctx);
  }

  // ── Data fetching ──────────────────────────────────────────────────────────

  async function fetchAndRender(root, ctx) {
    let tokenResult;
    try {
      tokenResult = await getToken();
    } catch (e) {
      renderError(root, 'Could not retrieve session token. Make sure Citrix Monitor is open and you are logged in.', ctx);
      return;
    }

    if (tokenResult.error) {
      renderError(root, tokenResult.error, ctx);
      return;
    }

    const { token, stale } = tokenResult;

    // Derive customer ID from the current URL (cloud.com subdomain)
    const customerIdMatch = location.hostname.match(/^([^.]+)\.monitor\.cloud\.com/) ||
                            location.href.match(/customerId=([^&]+)/);
    const customerId = customerIdMatch?.[1] || '';

    const baseUrl = location.origin;

    try {
      const data = await fetchODataFields(baseUrl, customerId, token, ctx);
      renderPanel(root, ctx, data, { stale });
    } catch (e) {
      renderError(root, `OData fetch failed: ${e.message}`, ctx);
    }
  }

  function getToken() {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage({ type: 'GET_TOKEN' }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response || { error: 'No response from background' });
          }
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  async function fetchODataFields(baseUrl, customerId, token, ctx) {
    const headers = {
      'Authorization': `CWSAuth bearer="${token}"`,
      'Accept': 'application/json',
      'Citrix-CustomerId': customerId,
    };

    const results = {};

    if (ctx.type === 'session' && settings.showLogonDuration !== false) {
      results.logon = await fetchLogonData(baseUrl, ctx.id, headers);
    }

    if ((ctx.type === 'machine' || ctx.type === 'session') && settings.showVdaInfo !== false) {
      results.vda = await fetchVdaData(baseUrl, ctx.id, ctx.type, headers);
    }

    if (ctx.type === 'machine' && settings.showMachineInfo !== false) {
      results.machine = await fetchMachineData(baseUrl, ctx.id, headers);
    }

    if (settings.customFields?.length > 0) {
      results.custom = await fetchCustomFields(baseUrl, ctx, headers, settings.customFields);
    }

    return results;
  }

  async function fetchLogonData(baseUrl, sessionId, headers) {
    // Monitor OData endpoint for session logon details
    const url = `${baseUrl}/monitorodata/Sessions(${encodeURIComponent(sessionId)})?$select=LogOnStartDate,LogOnEndDate,SessionKey,ConnectionState,ClientAddress,ClientName,Protocol,SmartAccessFilters`;
    const res = await safeFetch(url, { headers });
    if (!res.ok) throw new Error(`Sessions OData: ${res.status}`);
    const json = await res.json();
    const s = json;

    const logonMs = s.LogOnStartDate && s.LogOnEndDate
      ? new Date(s.LogOnEndDate) - new Date(s.LogOnStartDate)
      : null;

    // Fetch logon duration breakdown if available
    let breakdown = null;
    try {
      const bUrl = `${baseUrl}/monitorodata/Sessions(${encodeURIComponent(sessionId)})/LogOnDurationBreakdown`;
      const bRes = await safeFetch(bUrl, { headers });
      if (bRes.ok) breakdown = await bRes.json();
    } catch (_) { /* endpoint may not exist on all versions */ }

    return {
      logonDurationMs: logonMs,
      logonStart: s.LogOnStartDate,
      logonEnd: s.LogOnEndDate,
      connectionState: s.ConnectionState,
      clientAddress: s.ClientAddress,
      clientName: s.ClientName,
      protocol: s.Protocol,
      breakdown,
    };
  }

  async function fetchVdaData(baseUrl, id, type, headers) {
    let url;
    if (type === 'session') {
      url = `${baseUrl}/monitorodata/Sessions(${encodeURIComponent(id)})/Machine?$select=Name,AgentVersion,OSType,OSVersion,IPAddress,CurrentRegistrationState,LastDeregistrationReason,LastDeregistrationTime,IsAssigned,HostedMachineName,HypervisorConnectionName`;
    } else {
      url = `${baseUrl}/monitorodata/Machines(${encodeURIComponent(id)})?$select=Name,AgentVersion,OSType,OSVersion,IPAddress,CurrentRegistrationState,LastDeregistrationReason,LastDeregistrationTime,IsAssigned,HostedMachineName,HypervisorConnectionName`;
    }
    const res = await safeFetch(url, { headers });
    if (!res.ok) return null;
    return res.json();
  }

  async function fetchMachineData(baseUrl, machineId, headers) {
    const url = `${baseUrl}/monitorodata/Machines(${encodeURIComponent(machineId)})?$select=Name,AgentVersion,OSType,OSVersion,IPAddress,Sid,IsAssigned,AssociatedUserNames,HostedMachineName,HypervisorConnectionName,CurrentRegistrationState,LastDeregistrationReason,LastDeregistrationTime,FailureDate,FaultState,Tags`;
    const res = await safeFetch(url, { headers });
    if (!res.ok) return null;
    return res.json();
  }

  async function fetchCustomFields(baseUrl, ctx, headers, customFields) {
    // Build a minimal OData query for user-defined fields
    const entityMap = { session: 'Sessions', machine: 'Machines', user: 'Users' };
    const entity = entityMap[ctx.type] || 'Sessions';
    const select = customFields.join(',');
    const url = `${baseUrl}/monitorodata/${entity}(${encodeURIComponent(ctx.id)})?$select=${encodeURIComponent(select)}`;
    try {
      const res = await safeFetch(url, { headers });
      if (!res.ok) return null;
      return res.json();
    } catch (_) { return null; }
  }

  async function safeFetch(url, options) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  function buildLoadingSkeleton(ctx) {
    return `
      <div class="cme-header">
        <span class="cme-logo">⬡</span>
        <span class="cme-title">Monitor Enhanced</span>
        <span class="cme-context-badge">${escHtml(ctx.type)}</span>
        <div class="cme-header-actions">
          <button class="cme-btn-icon" id="cme-refresh" title="Refresh">↻</button>
          <button class="cme-btn-icon" id="cme-settings" title="Settings">⚙</button>
          <button class="cme-btn-icon" id="cme-close" title="Close">✕</button>
        </div>
      </div>
      <div class="cme-body">
        <div class="cme-skeleton">
          <div class="cme-skeleton-row"></div>
          <div class="cme-skeleton-row short"></div>
          <div class="cme-skeleton-row"></div>
          <div class="cme-skeleton-row short"></div>
        </div>
      </div>`;
  }

  function renderPanel(root, ctx, data, meta) {
    const sections = [];

    if (data.logon) sections.push(buildLogonSection(data.logon));
    if (data.vda)   sections.push(buildVdaSection(data.vda));
    if (data.machine) sections.push(buildMachineSection(data.machine));
    if (data.custom)  sections.push(buildCustomSection(data.custom, settings.customFields));

    const staleWarning = meta.stale
      ? `<div class="cme-warning">⚠ Token may be expiring — reload Monitor if data fails to load.</div>`
      : '';

    root.innerHTML = `
      <div class="cme-header">
        <span class="cme-logo">⬡</span>
        <span class="cme-title">Monitor Enhanced</span>
        <span class="cme-context-badge">${escHtml(ctx.type)}</span>
        <div class="cme-header-actions">
          <button class="cme-btn-icon" id="cme-refresh" title="Refresh">↻</button>
          <button class="cme-btn-icon" id="cme-settings" title="Settings">⚙</button>
          <button class="cme-btn-icon" id="cme-close" title="Close">✕</button>
        </div>
      </div>
      ${staleWarning}
      <div class="cme-body">
        ${sections.join('')}
      </div>
      <div class="cme-footer">
        <span>Citrix Monitor Enhanced • <a href="#" id="cme-open-options">Configure fields</a></span>
      </div>`;

    bindPanelEvents(root, ctx);
  }

  function buildLogonSection(d) {
    const dur = d.logonDurationMs != null
      ? formatDuration(d.logonDurationMs)
      : '—';

    let breakdownRows = '';
    if (d.breakdown?.value?.length) {
      breakdownRows = d.breakdown.value.map(b =>
        `<div class="cme-breakdown-row">
          <span class="cme-breakdown-label">${escHtml(b.PhaseName || b.Name || 'Phase')}</span>
          <span class="cme-breakdown-bar-wrap">
            <span class="cme-breakdown-bar" style="width:${Math.min(100, (b.DurationMs / d.logonDurationMs) * 100).toFixed(1)}%"></span>
          </span>
          <span class="cme-breakdown-val">${formatDuration(b.DurationMs)}</span>
        </div>`
      ).join('');
    }

    return `
      <section class="cme-section">
        <h3 class="cme-section-title">Logon Duration</h3>
        <div class="cme-fields">
          ${field('Total Duration', dur)}
          ${field('Logon Start', formatDate(d.logonStart))}
          ${field('Logon End', formatDate(d.logonEnd))}
          ${field('Protocol', d.protocol || '—')}
          ${field('Connection State', d.connectionState || '—')}
          ${field('Client Name', d.clientName || '—')}
          ${field('Client Address', d.clientAddress || '—')}
        </div>
        ${breakdownRows ? `<div class="cme-breakdown">${breakdownRows}</div>` : ''}
      </section>`;
  }

  function buildVdaSection(d) {
    if (!d) return '';
    return `
      <section class="cme-section">
        <h3 class="cme-section-title">VDA / Agent</h3>
        <div class="cme-fields">
          ${field('Machine Name', d.Name || '—')}
          ${field('Agent Version', d.AgentVersion || '—')}
          ${field('OS Type', d.OSType || '—')}
          ${field('OS Version', d.OSVersion || '—')}
          ${field('IP Address', d.IPAddress || '—')}
          ${field('Registration State', d.CurrentRegistrationState || '—')}
          ${field('Last Deregistration', d.LastDeregistrationReason || '—')}
          ${field('Hypervisor', d.HypervisorConnectionName || '—')}
        </div>
      </section>`;
  }

  function buildMachineSection(d) {
    if (!d) return '';
    const users = Array.isArray(d.AssociatedUserNames)
      ? d.AssociatedUserNames.join(', ')
      : (d.AssociatedUserNames || '—');

    return `
      <section class="cme-section">
        <h3 class="cme-section-title">Machine Details</h3>
        <div class="cme-fields">
          ${field('Hosted Name', d.HostedMachineName || '—')}
          ${field('Assigned', d.IsAssigned ? 'Yes' : 'No')}
          ${field('Associated Users', users)}
          ${field('Fault State', d.FaultState || '—')}
          ${field('SID', d.Sid || '—')}
        </div>
      </section>`;
  }

  function buildCustomSection(d, fields) {
    if (!d || !fields?.length) return '';
    const rows = fields.map(f => field(f, d[f] != null ? String(d[f]) : '—')).join('');
    return `
      <section class="cme-section">
        <h3 class="cme-section-title">Custom Fields</h3>
        <div class="cme-fields">${rows}</div>
      </section>`;
  }

  function renderError(root, message, ctx) {
    root.innerHTML = `
      <div class="cme-header">
        <span class="cme-logo">⬡</span>
        <span class="cme-title">Monitor Enhanced</span>
        <div class="cme-header-actions">
          <button class="cme-btn-icon" id="cme-close" title="Close">✕</button>
        </div>
      </div>
      <div class="cme-body">
        <div class="cme-error">
          <span class="cme-error-icon">⚠</span>
          <p>${escHtml(message)}</p>
          <button class="cme-btn" id="cme-retry">Retry</button>
        </div>
      </div>`;

    root.querySelector('#cme-close')?.addEventListener('click', () => root.remove());
    root.querySelector('#cme-retry')?.addEventListener('click', () => {
      root.innerHTML = buildLoadingSkeleton(ctx);
      fetchAndRender(root, ctx);
    });
  }

  function bindPanelEvents(root, ctx) {
    root.querySelector('#cme-close')?.addEventListener('click', () => {
      root.remove();
      panelMounted = false;
    });

    root.querySelector('#cme-refresh')?.addEventListener('click', () => {
      root.innerHTML = buildLoadingSkeleton(ctx);
      panelMounted = true;
      fetchAndRender(root, ctx);
    });

    root.querySelector('#cme-settings')?.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' });
    });

    root.querySelector('#cme-open-options')?.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' });
    });
  }

  // ── Floating panel drag support ────────────────────────────────────────────

  function makeDraggable(el) {
    const header = el.querySelector('.cme-header');
    if (!header) return;
    let startX, startY, startLeft, startTop;

    header.style.cursor = 'move';
    header.addEventListener('mousedown', (e) => {
      startX = e.clientX;
      startY = e.clientY;
      const rect = el.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;

      const onMove = (e) => {
        el.style.left = `${startLeft + e.clientX - startX}px`;
        el.style.top  = `${startTop  + e.clientY - startY}px`;
        el.style.right = 'auto';
        el.style.bottom = 'auto';
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // ── Drawer toggle ──────────────────────────────────────────────────────────

  function addDrawerToggle(el) {
    const toggle = document.createElement('button');
    toggle.id = 'cme-drawer-toggle';
    toggle.title = 'Toggle Monitor Enhanced';
    toggle.textContent = '⬡';
    document.body.appendChild(toggle);

    toggle.addEventListener('click', () => {
      el.classList.toggle('cme-drawer-open');
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  function field(label, value) {
    return `
      <div class="cme-field">
        <span class="cme-field-label">${escHtml(label)}</span>
        <span class="cme-field-value">${escHtml(String(value))}</span>
      </div>`;
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatDuration(ms) {
    if (ms == null || isNaN(ms)) return '—';
    if (ms < 1000) return `${ms}ms`;
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
  }

  function formatDate(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString();
    } catch (_) { return iso; }
  }

})();
