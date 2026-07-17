/**
 * popup.js — Citrix Monitor Enhanced toolbar popup
 */

(function () {
  'use strict';

  // Check token status
  chrome.runtime.sendMessage({ type: 'GET_TOKEN' }, (response) => {
    const dot    = document.getElementById('token-dot');
    const status = document.getElementById('token-status');

    if (!response || response.error) {
      dot.classList.add('inactive');
      status.textContent = 'No active session — open Citrix Monitor to capture token';
    } else if (response.stale) {
      dot.style.background = '#f59e0b';
      status.textContent = `Token active but may expire soon (${response.ageMinutes}m old)`;
    } else {
      status.textContent = `Session token active (${response.ageMinutes}m old)`;
    }
  });

  document.getElementById('btn-open-options').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  document.getElementById('btn-clear-token').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'CLEAR_TOKEN' }, () => {
      const status = document.getElementById('token-status');
      const dot = document.getElementById('token-dot');
      dot.classList.add('inactive');
      status.textContent = 'Token cleared — reload Citrix Monitor to re-capture';
    });
  });

})();
