/**
 * options.js — Citrix Monitor Enhanced Settings
 */

(function () {
  'use strict';

  const DEFAULTS = {
    layoutMode: 'inline',
    customFields: [],
    showLogonDuration: true,
    showVdaInfo: true,
    showMachineInfo: true,
  };

  let settings = { ...DEFAULTS };

  // ── Load ───────────────────────────────────────────────────────────────────

  chrome.storage.sync.get('cmeSettings', (result) => {
    settings = { ...DEFAULTS, ...(result.cmeSettings || {}) };
    applyToUI();
  });

  function applyToUI() {
    // Layout selection
    document.querySelectorAll('.layout-option').forEach((el) => {
      const val = el.dataset.value;
      const radio = el.querySelector('input[type="radio"]');
      if (val === settings.layoutMode) {
        radio.checked = true;
        el.classList.add('selected');
      } else {
        el.classList.remove('selected');
      }
    });

    // Toggles
    document.getElementById('toggle-logon').checked   = settings.showLogonDuration !== false;
    document.getElementById('toggle-vda').checked     = settings.showVdaInfo !== false;
    document.getElementById('toggle-machine').checked = settings.showMachineInfo !== false;

    // Custom fields
    renderCustomFields(settings.customFields || []);
  }

  // ── Layout picker ──────────────────────────────────────────────────────────

  document.querySelectorAll('.layout-option').forEach((el) => {
    el.addEventListener('click', () => {
      document.querySelectorAll('.layout-option').forEach((o) => o.classList.remove('selected'));
      el.classList.add('selected');
      el.querySelector('input').checked = true;
      settings.layoutMode = el.dataset.value;
    });
  });

  // ── Custom fields ──────────────────────────────────────────────────────────

  function renderCustomFields(fields) {
    const list = document.getElementById('custom-fields-list');
    list.innerHTML = '';

    fields.forEach((f, i) => {
      const row = document.createElement('div');
      row.className = 'custom-field-row';
      row.innerHTML = `
        <input type="text" value="${escHtml(f)}" placeholder="OData property name" data-index="${i}">
        <button class="btn-remove" data-index="${i}" title="Remove">✕</button>`;
      list.appendChild(row);
    });

    list.querySelectorAll('input').forEach((input) => {
      input.addEventListener('input', (e) => {
        const idx = parseInt(e.target.dataset.index, 10);
        settings.customFields[idx] = e.target.value.trim();
      });
    });

    list.querySelectorAll('.btn-remove').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.target.dataset.index, 10);
        settings.customFields.splice(idx, 1);
        renderCustomFields(settings.customFields);
      });
    });
  }

  document.getElementById('btn-add-field').addEventListener('click', () => {
    settings.customFields = settings.customFields || [];
    settings.customFields.push('');
    renderCustomFields(settings.customFields);
    // Focus the new input
    const inputs = document.querySelectorAll('#custom-fields-list input');
    inputs[inputs.length - 1]?.focus();
  });

  // ── Save ───────────────────────────────────────────────────────────────────

  document.getElementById('btn-save').addEventListener('click', () => {
    settings.showLogonDuration = document.getElementById('toggle-logon').checked;
    settings.showVdaInfo       = document.getElementById('toggle-vda').checked;
    settings.showMachineInfo   = document.getElementById('toggle-machine').checked;

    // Clean up blank custom fields
    settings.customFields = (settings.customFields || []).filter(f => f.trim() !== '');

    chrome.storage.sync.set({ cmeSettings: settings }, () => {
      const status = document.getElementById('save-status');
      status.classList.add('visible');
      setTimeout(() => status.classList.remove('visible'), 2500);
    });
  });

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

})();
