# Citrix Monitor Enhanced

A Chrome/Edge extension that surfaces additional OData fields in Citrix DaaS Monitor that aren't shown by default — logon duration breakdown, VDA/agent info, machine details, and any custom OData fields you configure.

## What it adds

| Field Group | Fields |
|---|---|
| **Logon Duration** | Total duration, logon start/end, per-phase breakdown bar chart, protocol, client name/address |
| **VDA / Agent** | Agent version, OS type & version, IP, registration state, last deregistration reason, hypervisor |
| **Machine Details** | Hosted machine name, assigned users, fault state, SID |
| **Custom Fields** | Any OData property you name in Settings |

## How it works

The extension **reuses your existing Citrix Monitor session** — no API keys needed. It intercepts the bearer token already present in the Monitor tab's outgoing requests and uses it to make additional OData calls to the Monitor API, then injects the results into the page.

## Installing (unpacked / developer mode)

1. Open `chrome://extensions` (or `edge://extensions`)
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `citrix-monitor-ext` folder
5. Navigate to `https://monitor.cloud.com` and open any session or machine detail page

## Layout modes

Choose in Settings (click the ⬡ toolbar icon → Settings):

| Mode | Description |
|---|---|
| **Inline** | Injected below Monitor's existing detail cards — fits naturally in the page |
| **Floating** | Draggable overlay panel — stays visible while you scroll |
| **Side Drawer** | Slides in from the right edge, toggled by a button on the screen edge |
| **Popup** | Data appears in the toolbar popup when you click the extension icon |

## Adding custom OData fields

In Settings, add the exact OData property name (e.g. `SmartAccessFilters`, `ApplicationNames`, `Tags`). The extension will query these against the Session, Machine, or User entity depending on which page you're on.

Reference: `https://developer-docs.citrix.com/en-us/citrix-daas/sdk-api/monitor-service-odata-api`

## Token lifecycle

- The bearer token is captured when Monitor makes its first API call after you load the page
- Stored in `chrome.storage.session` (cleared when the browser closes — never persisted to disk)
- The popup icon shows token status and age
- If the token expires (~60 min), reload the Monitor tab to re-capture

## File structure

```
citrix-monitor-ext/
├── manifest.json      # MV3 extension manifest
├── background.js      # Token interceptor (service worker)
├── content.js         # DOM observer + OData fetcher + panel renderer
├── styles.css         # Panel styles (all 4 layout modes)
├── popup.html/.js     # Toolbar popup (status + settings shortcut)
├── options.html/.js   # Settings page (layout picker, field toggles, custom fields)
└── icons/             # Extension icons (add your own 16/48/128px PNGs)
```

## Security notes

- **Minimal permissions**: only `storage` and host access to `*.cloud.com` and `*.citrixworkspacesapi.net`
- **No remote code**: all scripts are bundled, no CDN or eval usage
- **Token never leaves the browser**: OData calls go directly from your browser to Citrix, not through any proxy
- **Session storage only**: token is wiped on browser close
