/**
 * content.js — Citrix Monitor Enhanced
 *
 * Listens for calls that inject.js observed Director's own UI making
 * (via window.postMessage), extracts context IDs (siteId/sessionId/
 * userId/machineId) and response data from them, and renders an
 * enhanced panel using that data. Falls back to an on-demand POST
 * (relayed through background.js) only for fields not already covered
 * by traffic Director's UI naturally generates.
 */

(function () {
  'use strict';

  let settings = {};
  let panelMounted = false;

  // Latest known identifiers for whatever session/machine is on screen
  const ctx = {
    directorBase: null,
    siteId: null,
    sessionId: null,
    userId: null,
    machineId: null,
  };

  // Raw captured responses, keyed by Director method name
  const captured = {};

  init();

  async function init() {
    settings = await loadSettings();
    window.addEventListener('message', handleInjectedMessage);
  }

  function loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.sync.get('cmeSettings', (result) => {
        resolve(result.cmeSettings || {});
      });
    });
  }

  // ── Ingest snooped Director traffic ──────────────────────────────────────

  function handleInjectedMessage(event) {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.source !== 'CME_INJECT') return;

    // Update known context from whatever this call's request body carried
    const req = msg.request || {};
    if (req.siteId) ctx.siteId = req.siteId;
    if (req.sessionId) ctx.sessionId = req.sessionId;
    if (req.userId) ctx.userId = req.userId;
    if (req.machineId) ctx.machineId = req.machineId;
    ctx.directorBase = msg.origin;

    // Stash the response so we can render from it directly — no need to
    // re-request data Director's own UI already fetched for us.
    captured[msg.method] = msg.response;

    // Any of these methods appearing means there's fresh detail data to show
    const RELEVANT = [
      'GetUserLogonDurationData',
      'GetMachineCompleteData',
      'GetMachineDynamicData',
      'GetMachineTroubleshootingData',
      'GetSessionData',
    ];
    if (RELEVANT.includes(msg.method)) {
      scheduleRender();
    }
  }

  let renderTimer = null;
  function scheduleRender() {
    // Debounce — several Director calls often land within the same burst
    clearTimeout(renderTimer);
    renderTimer = setTimeout(mountOrUpdatePanel, 400);
  }

  // ── Panel mounting ─────────────────────────────────────────────────────────

  function mountOrUpdatePanel() {
    const layout = settings.layoutMode || 'inline';
    let root = document.getElementById('cme-panel-root');

    if (!root) {
      root = document.createElement('div');
      root.id = 'cme-panel-root';
      root.className = `cme-panel cme-layout-${layout}`;

      if (layout === 'popup') return; // rendered via toolbar popup instead

      if (layout === 'floating' || layout === 'drawer') {
        document.body.appendChild(root);
        if (layout === 'floating') makeDraggable(root);
        if (layout === 'drawer') addDrawerToggle(root);
      } else {
        const anchor = findAnchor();
        if (!anchor) {
          document.body.appendChild(root); // fall back rather than silently drop
        } else {
          anchor.insertAdjacentElement('afterend', root);
        }
      }
      panelMounted = true;
    }

    renderPanel(root);
  }

  function findAnchor() {
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

  // ── Rendering ──────────────────────────────────────────────────────────────

  function renderPanel(root) {
    const sections = [];

    const logon = captured['GetUserLogonDurationData'];
    if (logon && settings.showLogonDuration !== false) {
      sections.push(buildLogonSection(unwrap(logon, 'GetUserLogonDurationDataResult')));
    }

    const machine = captured['GetMachineCompleteData'];
    if (machine && (settings.showVdaInfo !== false || settings.showMachineInfo !== false)) {
      const m = unwrap(machine, 'GetMachineCompleteDataResult');
      if (settings.showVdaInfo !== false) sections.push(buildVdaSection(m));
      if (settings.showMachineInfo !== false) sections.push(buildMachineSection(m));
    }

    if (settings.customFields?.length) {
      sections.push(buildCustomSection());
    }

    if (!sections.length) {
      root.innerHTML = buildWaitingState();
      bindPanelEvents(root);
      return;
    }

    root.innerHTML = `
      <div class="cme-header">
        <span class="cme-logo">⬡</span>
        <span class="cme-title">Monitor Enhanced</span>
        <div class="cme-header-actions">
          <button class="cme-btn-icon" id="cme-refresh" title="Refresh from Director">↻</button>
          <button class="cme-btn-icon" id="cme-settings" title="Settings">⚙</button>
          <button class="cme-btn-icon" id="cme-close" title="Close">✕</button>
        </div>
      </div>
      <div class="cme-body">${sections.join('')}</div>
      <div class="cme-footer">
        <span>Citrix Monitor Enhanced • <a href="#" id="cme-open-options">Configure fields</a></span>
      </div>`;

    bindPanelEvents(root);
  }

  function buildWaitingState() {
    return `
      <div class="cme-header">
        <span class="cme-logo">⬡</span>
        <span class="cme-title">Monitor Enhanced</span>
        <div class="cme-header-actions">
          <button class="cme-btn-icon" id="cme-close" title="Close">✕</button>
        </div>
      </div>
      <div class="cme-body">
        <div class="cme-error">
          <p>Waiting for session/machine data — open a session or machine detail view in Director to populate this panel.</p>
        </div>
      </div>`;
  }

  function unwrap(obj, resultKey) {
    return obj?.[resultKey] || obj;
  }

  function buildLogonSection(d) {
    const dur = d.LogonDurationInMS != null ? formatDuration(d.LogonDurationInMS) : '—';
    const userAvgMs = d.AverageLogonDurationForUserInMS;
    const dgAvgMs = d.AverageLogonDurationForDeliveryGroupInMS;
    const userAvg = userAvgMs != null ? formatDuration(userAvgMs) : null;
    const dgAvg = dgAvgMs != null ? formatDuration(dgAvgMs) : null;

    const breakdown = d.LogonDurationBreakdownInMS;
    let breakdownRows = '';
    if (breakdown && typeof breakdown === 'object') {
      const total = d.LogonDurationInMS || Object.values(breakdown).reduce((a, b) => a + b, 0);
      breakdownRows = Object.entries(breakdown)
        .filter(([, ms]) => ms > 0)
        .sort(([, a], [, b]) => b - a)
        .map(([phase, ms]) => `
          <div class="cme-breakdown-row">
            <span class="cme-breakdown-label">${escHtml(splitCamelCase(phase))}</span>
            <span class="cme-breakdown-bar-wrap">
              <span class="cme-breakdown-bar" style="width:${Math.min(100, (ms / total) * 100).toFixed(1)}%"></span>
            </span>
            <span class="cme-breakdown-val">${formatDuration(ms)}</span>
          </div>`)
        .join('');
    }

    return `
      <section class="cme-section">
        <h3 class="cme-section-title">Logon Duration</h3>
        <div class="cme-fields">
          ${field('Total Duration', dur)}
          ${field('Logon Time', formatDate(d.LogonTime))}
          ${userAvg ? field("User's Average", userAvg) : ''}
          ${dgAvg ? field('Delivery Group Average', dgAvg) : ''}
        </div>
        ${breakdownRows ? `<div class="cme-breakdown">${breakdownRows}</div>` : ''}
      </section>`;
  }

  function buildVdaSection(d) {
    return `
      <section class="cme-section">
        <h3 class="cme-section-title">VDA / Agent</h3>
        <div class="cme-fields">
          ${field('Hosted Machine Name', d.HostedMachineName || '—')}
          ${field('Agent Version', d.AgentVersion || '—')}
          ${field('OS Type', d.OSType || '—')}
          ${field('IP Address', d.IPAddress || '—')}
          ${field('Registration State', d.RegistrationState || '—')}
          ${field('Power State', d.PowerState || '—')}
          ${field('In Maintenance Mode', d.InMaintenanceMode ? 'Yes' : 'No')}
          ${field('Hypervisor', d.HypervisorConnectionName || '—')}
          ${field('Hosting Server', d.HostingServerName || '—')}
        </div>
      </section>`;
  }

  function buildMachineSection(d) {
    return `
      <section class="cme-section">
        <h3 class="cme-section-title">Machine Details</h3>
        <div class="cme-fields">
          ${field('Catalog', d.CatalogName || '—')}
          ${field('Desktop Kind', d.Desktopkind || d.DesktopKind || '—')}
          ${field('Zone', d.ZoneName || '—')}
          ${field('Organizational Unit', d.OrganizationalUnit || '—')}
          ${field('Last Upgrade State', d.LastUpgradeState || '—')}
          ${field('Last Upgrade Date', formatDate(d.LastUpgradeStateChangeDate))}
          ${field('Remote PC', d.RemotePC ? 'Yes' : 'No')}
        </div>
      </section>`;
  }

  function buildCustomSection() {
    // Search every captured response for each requested field name
    const rows = settings.customFields
      .filter(Boolean)
      .map((fieldName) => {
        let value;
        for (const resp of Object.values(captured)) {
          const unwrapped = resp && typeof resp === 'object'
            ? (Object.values(resp)[0]?.[fieldName] !== undefined ? Object.values(resp)[0] : resp)
            : resp;
          if (unwrapped && unwrapped[fieldName] !== undefined) {
            value = unwrapped[fieldName];
            break;
          }
        }
        return field(fieldName, value != null ? String(value) : 'not found in captured data');
      })
      .join('');

    return `
      <section class="cme-section">
        <h3 class="cme-section-title">Custom Fields</h3>
        <div class="cme-fields">${rows}</div>
      </section>`;
  }

  // ── Manual refresh (relayed through background for CORS/cookie reasons) ────

  function refreshFromDirector() {
    if (!ctx.directorBase || !ctx.siteId) {
      return Promise.reject(new Error('No context captured yet — open a session/machine in Director first.'));
    }

    const calls = [];

    if (ctx.sessionId && ctx.userId) {
      calls.push(
        directorPost('GetUserLogonDurationData', {
          siteId: ctx.siteId,
          sessionId: ctx.sessionId,
          userId: ctx.userId,
        }).then((data) => { captured['GetUserLogonDurationData'] = data; })
      );
    }

    if (ctx.machineId) {
      calls.push(
        directorPost('GetMachineCompleteData', {
          siteId: ctx.siteId,
          machineId: ctx.machineId,
        }).then((data) => { captured['GetMachineCompleteData'] = data; })
      );
    }

    return Promise.all(calls);
  }

  function directorPost(method, body) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: 'DIRECTOR_POST', directorBase: ctx.directorBase, method, body },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (!response?.ok) {
            reject(new Error(response?.error || 'Unknown error'));
          } else {
            resolve(response.data);
          }
        }
      );
    });
  }

  // ── Panel chrome (drag / drawer / events) ───────────────────────────────────

  function bindPanelEvents(root) {
    root.querySelector('#cme-close')?.addEventListener('click', () => {
      root.remove();
      panelMounted = false;
    });

    root.querySelector('#cme-refresh')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.textContent = '⟳';
      try {
        await refreshFromDirector();
        renderPanel(root);
      } catch (err) {
        const body = root.querySelector('.cme-body');
        if (body) body.insertAdjacentHTML('afterbegin', `<div class="cme-warning">⚠ ${escHtml(err.message)}</div>`);
      } finally {
        btn.textContent = '↻';
      }
    });

    root.querySelector('#cme-settings')?.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' });
    });

    root.querySelector('#cme-open-options')?.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' });
    });
  }

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
        el.style.top = `${startTop + e.clientY - startY}px`;
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

  function addDrawerToggle(el) {
    if (document.getElementById('cme-drawer-toggle')) return;
    const toggle = document.createElement('button');
    toggle.id = 'cme-drawer-toggle';
    toggle.title = 'Toggle Monitor Enhanced';
    toggle.textContent = '⬡';
    document.body.appendChild(toggle);
    toggle.addEventListener('click', () => el.classList.toggle('cme-drawer-open'));
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

  function splitCamelCase(str) {
    return str.replace(/([a-z])([A-Z])/g, '$1 $2');
  }

  function formatDuration(ms) {
    if (ms == null || isNaN(ms)) return '—';
    if (ms < 1000) return `${ms}ms`;
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
  }

  function formatDate(epochMsOrIso) {
    if (!epochMsOrIso) return '—';
    try {
      return new Date(epochMsOrIso).toLocaleString();
    } catch (_) {
      return String(epochMsOrIso);
    }
  }

})();
