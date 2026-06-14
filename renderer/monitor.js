'use strict';

/* ══ State ═══════════════════════════════════════════════════════════════════ */
const state = {
  ipMap: new Map(),
  selectedIp: null,
  whoisCache: new Map(),
  filterText: '',
  filterType: 'all',
  tracerouteRunning: false,
  currentTracerouteIp: null,
  monitorWidth: parseInt(localStorage.getItem('monitor-width')) || 420,
  sidebarHidden: localStorage.getItem('monitor-hidden') === 'true',
  activeTab: 'whois',
  monitoredAsns: new Set(), // ASN yang didaftarkan user untuk monitoring
};

/* ══ Load Monitored ASNs (untuk badge identifikasi CDN) ═════════════════════ */
async function loadMonitoredAsns() {
  try {
    const asns = await settingsAPI.getMonitoredAsns();
    state.monitoredAsns = new Set(asns || []);
    console.log(`[BGP] Monitoring ${state.monitoredAsns.size} ASNs`);
  } catch (e) {
    console.warn('[BGP] Failed to load monitored ASNs:', e);
    state.monitoredAsns = new Set();
  }
}

loadMonitoredAsns();

/* ══ DOM Refs ════════════════════════════════════════════════════════════════ */
const $ = (id) => document.getElementById(id);

const urlInput        = $('url-input');
const urlLockIcon     = $('url-lock-icon');
const loadingBar      = $('url-loading-indicator');
const btnBack         = $('btn-back');
const btnForward      = $('btn-forward');
const btnRefresh      = $('btn-refresh');
const btnDevtools     = $('btn-devtools');
const ipCountText     = $('ip-count-text');
const placeholder     = $('browser-placeholder');

const filterInput     = $('filter-input');
const filterType      = $('filter-type');
const btnClear        = $('btn-clear');
const btnExport       = $('btn-export');
const ipTable         = $('ip-table');
const ipTableBody     = $('ip-table-body');
const ipListEmpty     = $('ip-list-empty');
const statTotalVal    = $('stat-total-val');
const statV4Val       = $('stat-v4-val');
const statV6Val       = $('stat-v6-val');
const statCdnVal      = $('stat-cdn-val');

const detailPanel     = $('detail-panel');
const detailSelectedIp= $('detail-selected-ip');
const detailCloseBtn  = $('detail-close-btn');

// Detail tabs
const tabWhois        = $('tab-whois');
const tabTraceroute   = $('tab-traceroute');
const tabDns          = $('tab-dns');
const tabPing         = $('tab-ping');

// Tab panes
const paneWhois       = $('tab-pane-whois');
const paneTraceroute  = $('tab-pane-traceroute');
const paneDns         = $('tab-pane-dns');
const panePing        = $('tab-pane-ping');

const whoisLoading    = $('whois-loading');
const whoisFields     = $('whois-fields');
const btnStartTrace   = $('btn-start-trace');
const btnStopTrace    = $('btn-stop-trace');
const traceStatus     = $('trace-status');
const tracerouteBody  = $('traceroute-body');

const monitorPanel      = $('monitor-panel');
const resizer           = $('resizer');
const btnToggleSidebar  = $('btn-toggle-sidebar');

// Settings
const btnSettings     = $('btn-settings');

// DNS
const btnDnsCheck     = $('btn-dns-check');
const dnsModal        = $('dns-modal');
const dnsModalClose   = $('dns-modal-close');

/* ══ Toolbar / Navigation ════════════════════════════════════════════════════ */
urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const url = urlInput.value.trim();
    if (url) {
      electronAPI.navigate(url);
      clearIpList();
      placeholder.classList.add('hidden');
    }
  }
  if (e.key === 'Escape') urlInput.blur();
});

urlInput.addEventListener('focus', () => urlInput.select());

btnBack.addEventListener('click', () => electronAPI.goBack());
btnForward.addEventListener('click', () => electronAPI.goForward());
btnRefresh.addEventListener('click', () => {
  const isLoading = loadingBar.classList.contains('active');
  if (isLoading) { electronAPI.stop(); }
  else { electronAPI.refresh(); clearIpList(); }
});

btnDevtools.addEventListener('click', () => electronAPI.openDevTools());

// Settings button
btnSettings.addEventListener('click', () => {
  if (window.settingsAPI && settingsAPI.openSettings) {
    settingsAPI.openSettings();
  }
});

// DNS Modal
btnDnsCheck.addEventListener('click', () => {
  dnsModal.classList.remove('hidden');
  $('dns-modal-domain').focus();
});
dnsModalClose.addEventListener('click', () => {
  dnsModal.classList.add('hidden');
});
dnsModal.addEventListener('click', (e) => {
  if (e.target === dnsModal) dnsModal.classList.add('hidden');
});
$('dns-modal-run').addEventListener('click', () => {
  const domain = $('dns-modal-domain').value.trim();
  const type = $('dns-modal-type').value;
  if (domain) {
    loadDnsPropagationModal(domain, type);
  }
});
$('dns-modal-domain').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('dns-modal-run').click();
});

async function loadDnsPropagationModal(domain, type) {
  const resultsEl = $('dns-modal-results');
  const consensusEl = $('dns-modal-consensus');
  resultsEl.innerHTML = '<div class="detail-loading"><div class="spinner"></div><span>Checking DNS propagation…</span></div>';
  consensusEl.innerHTML = '';

  try {
    const data = await electronAPI.dnsPropagation(domain, type);
    if (data.error) {
      resultsEl.innerHTML = `<div class="bgp-error">${data.error}</div>`;
      return;
    }
    if (window.renderDnsResults) {
      window.renderDnsResults(data, resultsEl, consensusEl);
    }
  } catch (err) {
    resultsEl.innerHTML = `<div class="bgp-error">${err.message}</div>`;
  }
}

// Sidebar Toggle Logic
function toggleSidebar() {
  state.sidebarHidden = !state.sidebarHidden;
  localStorage.setItem('monitor-hidden', state.sidebarHidden);
  applySidebarState();
}

function applySidebarState() {
  if (state.sidebarHidden) {
    monitorPanel.classList.add('collapsed');
    resizer.classList.add('hidden');
    btnToggleSidebar.classList.remove('active');
    electronAPI.updateMonitorWidth(0);
  } else {
    monitorPanel.classList.remove('collapsed');
    resizer.classList.remove('hidden');
    btnToggleSidebar.classList.add('active');
    monitorPanel.style.width = `${state.monitorWidth}px`;
    electronAPI.updateMonitorWidth(state.monitorWidth);
  }
}

btnToggleSidebar.addEventListener('click', toggleSidebar);

// Resizing Logic — fix: menggunakan startResize/endResize yang benar di preload
let isResizing = false;

resizer.addEventListener('mousedown', (e) => {
  isResizing = true;
  resizer.classList.add('dragging');
  monitorPanel.classList.add('dragging');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  electronAPI.startResize();
  e.preventDefault();
});

window.addEventListener('mousemove', (e) => {
  if (!isResizing) return;
  const newWidth = window.innerWidth - e.clientX;
  const minWidth = 250;
  const maxWidth = Math.max(minWidth, window.innerWidth - 300);
  const constrainedWidth = Math.max(minWidth, Math.min(newWidth, maxWidth));
  state.monitorWidth = constrainedWidth;
  monitorPanel.style.width = `${constrainedWidth}px`;
  electronAPI.updateMonitorWidth(constrainedWidth);
});

window.addEventListener('mouseup', () => {
  if (isResizing) {
    isResizing = false;
    resizer.classList.remove('dragging');
    monitorPanel.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    localStorage.setItem('monitor-width', state.monitorWidth);
    electronAPI.endResize();
  }
});

// Initial application of sidebar state
applySidebarState();

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.altKey && e.key === 'ArrowLeft') electronAPI.goBack();
  if (e.altKey && e.key === 'ArrowRight') electronAPI.goForward();
  if (e.key === 'F5') { electronAPI.refresh(); clearIpList(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
    urlInput.focus(); urlInput.select();
    e.preventDefault();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
    toggleSidebar();
    e.preventDefault();
  }
});

/* ══ Electron Events ═════════════════════════════════════════════════════════ */
// fix: onNavigated (sebelumnya onBrowserNavigated di preload lama)
electronAPI.onNavigated(({ url }) => {
  if (url && url !== 'about:blank') {
    urlInput.value = url;
    const isHttps = url.startsWith('https://');
    urlLockIcon.style.color = isHttps ? '#10B981' : '#EF4444';
    placeholder.classList.add('hidden');
  }
});

electronAPI.onPageTitle(({ title }) => {
  document.title = title ? `${title} — CDN Diagnostic` : 'CDN Diagnostic Browser';
});

electronAPI.onPageLoading(({ loading }) => {
  if (loading) {
    loadingBar.classList.add('active');
    btnRefresh.title = 'Stop (F5)';
  } else {
    loadingBar.classList.remove('active');
    btnRefresh.title = 'Refresh (F5)';
  }
});

/* ══ IP Capture ══════════════════════════════════════════════════════════════ */
electronAPI.onRequestCaptured((data) => {
  const { ip, domain, isIPv6, resourceType } = data;

  let entry;
  if (state.ipMap.has(ip)) {
    entry = state.ipMap.get(ip);
    entry.requestCount++;
    entry.resourceType = resourceType;
  } else {
    entry = {
      ip,
      domain,
      isIPv6,
      resourceType,
      requestCount: 1,
      firstSeen: Date.now(),
      whois: null,
      cdnBrand: null,
      lastActivityTime: null,
      lastResourceType: null,
    };
    state.ipMap.set(ip, entry);

    // Fetch WHOIS asynchronously untuk identifikasi ASN/CDN
    electronAPI.whoisLookup(ip).then((whoisData) => {
      entry.whois = whoisData;
      // Tandai sebagai CDN jika ASN-nya ada di daftar monitoring atau dikenal sebagai CDN
      entry.cdnBrand = resolveCdnBrand(whoisData);
      // Update row CDN badge — hanya jika row sudah ada di DOM
      const safeId = ip.replace(/[:.]/g, '_');
      const rowExists = document.getElementById(`row-${safeId}`);
      if (rowExists) {
        updateRowCdn(ip, entry.cdnBrand, whoisData);
      }
      updateStats();
    });

    appendIpRow(entry);
  }

  markTrafficActive(ip, resourceType);
  updateStats();
  updateIpCounter();
});

/* ══ CDN Brand Resolution ════════════════════════════════════════════════════ */
// Hardcoded minimal set untuk identifikasi CDN + monitored ASNs user
const KNOWN_CDN = {
  'AS13335':  { label: 'Cloudflare',      color: '#F38020', bg: 'rgba(243,128,32,0.15)' },
  'AS209242': { label: 'Cloudflare',      color: '#F38020', bg: 'rgba(243,128,32,0.15)' },
  'AS20940':  { label: 'Akamai',          color: '#009BDE', bg: 'rgba(0,155,222,0.15)' },
  'AS16625':  { label: 'Akamai',          color: '#009BDE', bg: 'rgba(0,155,222,0.15)' },
  'AS54113':  { label: 'Fastly',          color: '#FF282D', bg: 'rgba(255,40,45,0.15)' },
  'AS15169':  { label: 'Google/GGC',      color: '#4285F4', bg: 'rgba(66,133,244,0.15)' },
  'AS396982': { label: 'Google Cloud',    color: '#4285F4', bg: 'rgba(66,133,244,0.15)' },
  'AS19527':  { label: 'Google',          color: '#4285F4', bg: 'rgba(66,133,244,0.15)' },
  'AS32934':  { label: 'Meta/Facebook',   color: '#1877F2', bg: 'rgba(24,119,242,0.15)' },
  'AS8075':   { label: 'Microsoft/Azure', color: '#00A4EF', bg: 'rgba(0,164,239,0.15)' },
  'AS16509':  { label: 'AWS CloudFront',  color: '#FF9900', bg: 'rgba(255,153,0,0.15)' },
  'AS14618':  { label: 'AWS',             color: '#FF9900', bg: 'rgba(255,153,0,0.15)' },
  'AS45102':  { label: 'Alibaba Cloud',   color: '#FF6A00', bg: 'rgba(255,106,0,0.15)' },
  'AS60068':  { label: 'CDN77',           color: '#00A859', bg: 'rgba(0,168,89,0.15)' },
  'AS7713':   { label: 'Telkom ID',       color: '#E44D26', bg: 'rgba(228,77,38,0.15)' },
  'AS17995':  { label: 'Telkom ID',       color: '#E44D26', bg: 'rgba(228,77,38,0.15)' },
  'AS17451':  { label: 'Biznet',          color: '#00B140', bg: 'rgba(0,177,64,0.15)' },
  'AS23693':  { label: 'XL Axiata',       color: '#0058A3', bg: 'rgba(0,88,163,0.15)' },
  'AS4761':   { label: 'Indosat',         color: '#FFD700', bg: 'rgba(255,215,0,0.15)' },
  'AS22822':  { label: 'Limelight/Edgio', color: '#7B2D8E', bg: 'rgba(123,45,142,0.15)' },
  'AS139327': { label: 'EdgeNext',        color: '#00C9DB', bg: 'rgba(0,201,219,0.15)' },
};

function resolveCdnBrand(whoisData) {
  if (!whoisData?.asn || whoisData.asn === '—') return null;
  const asn = whoisData.asn;

  // 1. Cek known CDN list
  if (KNOWN_CDN[asn]) return KNOWN_CDN[asn];

  // 2. Cek daftar monitoring user — tampilkan sebagai "Monitored ASN"
  if (state.monitoredAsns.has(asn)) {
    return { label: asn, color: '#A78BFA', bg: 'rgba(167,139,250,0.15)' };
  }

  return null;
}

/* ══ Render IP Row ═══════════════════════════════════════════════════════════ */
function getResourceTypeInfo(resourceType) {
  let icon = '📦';
  let label = 'Other';
  let typeClass = 'other';
  
  if (resourceType === 'media') {
    icon = '🎥'; label = 'Video / Buffering'; typeClass = 'media';
  } else if (resourceType === 'image') {
    icon = '🖼️'; label = 'Image'; typeClass = 'image';
  } else if (['xmlhttprequest', 'xhr', 'fetch', 'websocket', 'ping'].includes(resourceType)) {
    icon = '⚡'; label = 'API / Data'; typeClass = 'api';
  } else if (resourceType === 'script') {
    icon = '⚙️'; label = 'Script'; typeClass = 'script';
  } else if (resourceType === 'stylesheet') {
    icon = '🎨'; label = 'CSS / Style'; typeClass = 'stylesheet';
  } else if (resourceType === 'font') {
    icon = '🔤'; label = 'Font'; typeClass = 'font';
  } else if (['mainFrame', 'subFrame', 'document'].includes(resourceType)) {
    icon = '📄'; label = 'HTML / Page'; typeClass = 'page';
  }
  return { icon, label, typeClass };
}

function markTrafficActive(ip, resourceType) {
  const safeId = ip.replace(/[:.]/g, '_');
  const tr = document.getElementById(`row-${safeId}`);
  const trafficTag = document.getElementById(`traffic-tag-${safeId}`);
  const countEl = document.getElementById(`req-count-${safeId}`);
  const entry = state.ipMap.get(ip);
  if (!entry) return;

  entry.lastActivityTime = Date.now();
  entry.lastResourceType = resourceType;

  if (countEl) {
    countEl.textContent = `(${entry.requestCount} reqs)`;
  }

  if (trafficTag) {
    const info = getResourceTypeInfo(resourceType);
    trafficTag.className = 'ip-traffic-tag active ' + info.typeClass;
    trafficTag.innerHTML = `<span class="traffic-pulse-dot"></span> ${info.icon} ${info.label}`;
  }

  if (tr) {
    tr.classList.add('active-traffic');
  }
}

// Background loop to clear active traffic styling after 2 seconds of inactivity
setInterval(() => {
  const now = Date.now();
  const activeThreshold = 2000;
  
  state.ipMap.forEach((entry, ip) => {
    if (entry.lastActivityTime && now - entry.lastActivityTime > activeThreshold) {
      const safeId = ip.replace(/[:.]/g, '_');
      const tr = document.getElementById(`row-${safeId}`);
      const trafficTag = document.getElementById(`traffic-tag-${safeId}`);
      
      if (tr) tr.classList.remove('active-traffic');
      
      if (trafficTag && trafficTag.classList.contains('active')) {
        trafficTag.classList.remove('active');
        const info = getResourceTypeInfo(entry.lastResourceType);
        let shortLabel = info.label;
        if (entry.lastResourceType === 'media') shortLabel = 'Video';
        else if (['mainFrame', 'subFrame', 'document'].includes(entry.lastResourceType)) shortLabel = 'HTML';
        else if (['xmlhttprequest', 'xhr', 'fetch'].includes(entry.lastResourceType)) shortLabel = 'API';
        else if (entry.lastResourceType === 'stylesheet') shortLabel = 'Style';
        trafficTag.innerHTML = `${info.icon} ${shortLabel}`;
      }
    }
  });
}, 500);

function appendIpRow(entry) {
  // Guard: jangan duplikat row yang sudah ada
  const safeId = entry.ip.replace(/[:.]/g, '_');
  if (document.getElementById(`row-${safeId}`)) return;

  ipListEmpty.classList.add('hidden');
  ipTable.classList.add('visible');

  const { ip, domain, isIPv6, requestCount } = entry;
  if (!passesFilter(entry)) return;

  const tr = document.createElement('tr');
  tr.className = 'ip-row';
  tr.dataset.ip = ip;
  tr.id = `row-${safeId}`;

  // SVG icons for action buttons
  const whoisIcon = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6"/><path d="M8 5v3"/><circle cx="8" cy="10.5" r="0.5" fill="currentColor"/></svg>';
  const traceIcon = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 12h3l2-4 2 4 2-8 3 4h2"/></svg>';
  const pingIcon = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 8h3l2-4 2 8 2-4h3"/></svg>';

  tr.innerHTML = `
    <td>
      <span class="ip-type-badge ${isIPv6 ? 'badge-v6' : 'badge-v4'}">${isIPv6 ? 'v6' : 'v4'}</span>
    </td>
    <td>
      <span class="ip-domain" title="${domain}">${domain}</span>
      <div style="display: flex; flex-wrap: wrap; gap: 4px; align-items: center; margin-top: 3px;">
        <span class="ip-cdn-tag" id="cdn-tag-${safeId}"></span>
        <span class="ip-traffic-tag" id="traffic-tag-${safeId}"></span>
      </div>
    </td>
    <td>
      <span class="ip-addr ${isIPv6 ? 'v6' : 'v4'}" title="${ip}">${ip}</span>
      <span class="ip-req-count" id="req-count-${safeId}">(${requestCount} reqs)</span>
    </td>
    <td>
      <div class="row-action-btns">
        <button class="action-mini-btn" data-ip="${ip}" data-action="whois" title="WHOIS Lookup">${whoisIcon}</button>
        <button class="action-mini-btn" data-ip="${ip}" data-action="traceroute" title="Traceroute">${traceIcon}</button>
        <button class="action-mini-btn" data-ip="${ip}" data-action="ping" title="Ping Monitor">${pingIcon}</button>
      </div>
    </td>`;

  tr.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (btn) {
      e.stopPropagation();
      openDetail(btn.dataset.ip, btn.dataset.action);
    } else {
      openDetail(ip, 'whois');
    }
  });

  ipTableBody.appendChild(tr);

  if (entry.whois || entry.cdnBrand) {
    updateRowCdn(ip, entry.cdnBrand, entry.whois);
  }

  const now = Date.now();
  if (entry.lastActivityTime && now - entry.lastActivityTime < 2000) {
    markTrafficActive(ip, entry.lastResourceType);
  } else if (entry.lastResourceType) {
    const trafficTag = document.getElementById(`traffic-tag-${safeId}`);
    if (trafficTag) {
      const info = getResourceTypeInfo(entry.lastResourceType);
      let shortLabel = info.label;
      if (entry.lastResourceType === 'media') shortLabel = 'Video';
      else if (['mainFrame', 'subFrame', 'document'].includes(entry.lastResourceType)) shortLabel = 'HTML';
      else if (['xmlhttprequest', 'xhr', 'fetch'].includes(entry.lastResourceType)) shortLabel = 'API';
      else if (entry.lastResourceType === 'stylesheet') shortLabel = 'Style';
      trafficTag.innerHTML = `${info.icon} ${shortLabel}`;
    }
  }
}

function updateRowCdn(ip, cdnBrand, whoisData) {
  const safeId = ip.replace(/[:.]/g, '_');
  const cdnTagEl = document.getElementById(`cdn-tag-${safeId}`);
  if (!cdnTagEl) return;

  if (cdnBrand) {
    cdnTagEl.textContent = cdnBrand.label;
    cdnTagEl.style.color = cdnBrand.color;
    cdnTagEl.style.background = cdnBrand.bg;
    cdnTagEl.style.display = 'inline-block';
  } else if (whoisData?.asn && whoisData.asn !== '—') {
    cdnTagEl.textContent = whoisData.asn;
    cdnTagEl.style.color = '#94A3B8';
    cdnTagEl.style.background = 'rgba(148,163,184,0.1)';
    cdnTagEl.style.display = 'inline-block';
  } else {
    cdnTagEl.style.display = 'none';
  }
}

/* ══ Stats ═══════════════════════════════════════════════════════════════════ */
function updateStats() {
  const all = [...state.ipMap.values()];
  const v4Count = all.filter(e => !e.isIPv6).length;
  const v6Count = all.filter(e => e.isIPv6).length;
  const cdnCount = all.filter(e => e.cdnBrand).length;

  statTotalVal.textContent = all.length;
  statV4Val.textContent = v4Count;
  statV6Val.textContent = v6Count;
  statCdnVal.textContent = cdnCount;
}

function updateIpCounter() {
  ipCountText.textContent = `${state.ipMap.size} IPs`;
}

/* ══ Filter ══════════════════════════════════════════════════════════════════ */
filterInput.addEventListener('input', () => {
  state.filterText = filterInput.value.toLowerCase().trim();
  rebuildTable();
});

filterType.addEventListener('change', () => {
  state.filterType = filterType.value;
  rebuildTable();
});

function passesFilter(entry) {
  const { filterText, filterType } = state;
  if (filterText && !entry.domain.toLowerCase().includes(filterText) && !entry.ip.includes(filterText)) {
    return false;
  }
  if (filterType === 'ipv4' && entry.isIPv6) return false;
  if (filterType === 'ipv6' && !entry.isIPv6) return false;
  if (filterType === 'cdn' && !entry.cdnBrand) return false;
  return true;
}

function rebuildTable() {
  ipTableBody.innerHTML = '';
  const entries = [...state.ipMap.values()].filter(passesFilter);

  if (entries.length === 0 && state.ipMap.size > 0) {
    ipListEmpty.querySelector('p').textContent = 'No IPs match the current filter.';
    ipListEmpty.classList.remove('hidden');
    ipTable.classList.remove('visible');
  } else if (entries.length === 0) {
    ipListEmpty.querySelector('p').textContent = 'Browse any website to see\nreal-time IP addresses here';
    ipListEmpty.classList.remove('hidden');
    ipTable.classList.remove('visible');
  } else {
    ipListEmpty.classList.add('hidden');
    ipTable.classList.add('visible');
    entries.forEach(appendIpRow);
  }

  if (state.selectedIp) {
    const row = document.getElementById(`row-${state.selectedIp.replace(/[:.]/g, '_')}`);
    if (row) row.classList.add('selected');
  }
}

/* ══ Clear & Export ══════════════════════════════════════════════════════════ */
function clearIpList() {
  state.ipMap.clear();
  state.selectedIp = null;
  ipTableBody.innerHTML = '';
  ipTable.classList.remove('visible');
  ipListEmpty.classList.remove('hidden');
  ipListEmpty.querySelector('p').textContent = 'Browse any website to see\nreal-time IP addresses here';
  detailPanel.classList.remove('open');
  updateStats();
  updateIpCounter();
}

btnClear.addEventListener('click', clearIpList);

btnExport.addEventListener('click', () => {
  const data = [...state.ipMap.values()].map(e => ({
    ip: e.ip,
    domain: e.domain,
    ipVersion: e.isIPv6 ? 6 : 4,
    cdn: e.cdnBrand?.label || null,
    asn: e.whois?.asn || null,
    org: e.whois?.org || null,
    country: e.whois?.country || null,
    requestCount: e.requestCount,
    firstSeen: new Date(e.firstSeen).toISOString(),
  }));

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cdn-ips-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

/* ══ Detail Panel ════════════════════════════════════════════════════════════ */
function openDetail(ip, action) {
  if (state.selectedIp) {
    const prev = document.getElementById(`row-${state.selectedIp.replace(/[:.]/g, '_')}`);
    if (prev) prev.classList.remove('selected');
  }

  state.selectedIp = ip;
  const row = document.getElementById(`row-${ip.replace(/[:.]/g, '_')}`);
  if (row) row.classList.add('selected');

  detailSelectedIp.textContent = ip;
  detailPanel.classList.add('open');

  // Set ping target
  const pingTarget = $('ping-target-input');
  if (pingTarget) pingTarget.value = ip;

  // Set DNS domain from the entry
  const entry = state.ipMap.get(ip);
  if (entry) {
    const dnsDomain = $('dns-domain-input');
    if (dnsDomain && entry.domain) {
      dnsDomain.value = entry.domain;
    }
  }

  // Activate appropriate tab
  const tabMap = {
    'whois': 'whois',
    'traceroute': 'traceroute',
    'dns': 'dns',
    'ping': 'ping'
  };
  switchDetailTab(tabMap[action] || 'whois');

  // Load content
  if (action === 'whois') {
    loadWhois(ip);
  }
}

function switchDetailTab(tab) {
  state.activeTab = tab;

  // Deactivate all tabs
  [tabWhois, tabTraceroute, tabDns, tabPing].forEach(t => t?.classList.remove('active'));
  [paneWhois, paneTraceroute, paneDns, panePing].forEach(p => p?.classList.remove('active'));

  // Activate selected
  const tabEl = { whois: tabWhois, traceroute: tabTraceroute, dns: tabDns, ping: tabPing }[tab];
  const paneEl = { whois: paneWhois, traceroute: paneTraceroute, dns: paneDns, ping: panePing }[tab];
  if (tabEl) tabEl.classList.add('active');
  if (paneEl) paneEl.classList.add('active');
}

// Tab click handlers
tabWhois.addEventListener('click', () => {
  switchDetailTab('whois');
  if (state.selectedIp) loadWhois(state.selectedIp);
});
tabTraceroute.addEventListener('click', () => switchDetailTab('traceroute'));
tabDns.addEventListener('click', () => switchDetailTab('dns'));
tabPing.addEventListener('click', () => switchDetailTab('ping'));

detailCloseBtn.addEventListener('click', () => {
  detailPanel.classList.remove('open');
  if (state.selectedIp) {
    const row = document.getElementById(`row-${state.selectedIp.replace(/[:.]/g, '_')}`);
    if (row) row.classList.remove('selected');
    state.selectedIp = null;
  }
  stopTraceroute();
  // Stop ping if running
  if (btnPingStop && !btnPingStop.classList.contains('hidden')) {
    electronAPI.pingStop();
    btnPingStop.classList.add('hidden');
    btnPingStart.classList.remove('hidden');
  }
});

/* ══ WHOIS ═══════════════════════════════════════════════════════════════════ */
async function loadWhois(ip) {
  const cached = state.ipMap.get(ip)?.whois;

  whoisLoading.classList.remove('hidden');
  whoisFields.innerHTML = '';

  const data = cached || await electronAPI.whoisLookup(ip);

  const entry = state.ipMap.get(ip);
  if (entry && !entry.whois) entry.whois = data;

  whoisLoading.classList.add('hidden');

  if (!data) {
    whoisFields.innerHTML = '<p style="color:var(--text-muted);font-size:12px">Failed to fetch WHOIS data.</p>';
    return;
  }

  const cdnBrand = resolveCdnBrand(data);
  if (entry && !entry.cdnBrand && cdnBrand) {
    entry.cdnBrand = cdnBrand;
    updateRowCdn(ip, cdnBrand, data);
    updateStats();
  }

  const fields = [
    { label: 'IP Address', value: ip },
    { label: 'Organization', value: data.org },
    { label: 'AS Number', value: data.asn },
    { label: 'Country', value: data.country },
    { label: 'CIDR Range', value: data.cidr },
  ];

  whoisFields.innerHTML = fields.map(f => `
    <div class="whois-field">
      <span class="whois-label">${f.label}</span>
      <span class="whois-value">${f.value || '—'}</span>
    </div>`).join('');

  if (cdnBrand) {
    const badge = document.createElement('div');
    badge.className = 'whois-cdn-badge';
    badge.style.color = cdnBrand.color;
    badge.style.borderColor = cdnBrand.color;
    badge.style.background = cdnBrand.bg;
    badge.innerHTML = `<span>✦</span><span>${cdnBrand.label}</span>`;
    whoisFields.appendChild(badge);
  }
}

/* ══ Traceroute ══════════════════════════════════════════════════════════════ */
btnStartTrace.addEventListener('click', () => {
  if (!state.selectedIp) return;
  startTraceroute(state.selectedIp);
});

btnStopTrace.addEventListener('click', stopTraceroute);

function startTraceroute(ip) {
  tracerouteBody.innerHTML = '';
  state.tracerouteRunning = true;
  state.currentTracerouteIp = ip;

  btnStartTrace.classList.add('hidden');
  btnStopTrace.classList.remove('hidden');
  traceStatus.textContent = `Tracing route to ${ip}…`;

  electronAPI.tracerouteStart(ip);
}

function stopTraceroute() {
  if (state.tracerouteRunning) {
    electronAPI.tracerouteStop();
  }
  state.tracerouteRunning = false;
  btnStartTrace.classList.remove('hidden');
  btnStopTrace.classList.add('hidden');
  traceStatus.textContent = '';
}

electronAPI.onTracerouteHop((hop) => {
  const tr = document.createElement('tr');
  const isTimeout = hop.status === 'timeout';
  tr.innerHTML = `
    <td class="trace-hop-num">${hop.hop}</td>
    <td class="trace-ip ${isTimeout ? 'trace-timeout' : ''}">${hop.ip}</td>
    <td class="trace-rtt ${isTimeout ? 'trace-timeout' : ''}">${hop.rtt}</td>
    <td>${isTimeout
      ? '<span style="color:var(--text-muted);font-size:10px">timeout</span>'
      : '<span style="color:var(--green);font-size:10px">✓</span>'
    }</td>`;

  const existing = tracerouteBody.querySelector(`[data-hop="${hop.hop}"]`);
  if (existing) {
    existing.replaceWith(tr);
  } else {
    tr.dataset.hop = hop.hop;
    tracerouteBody.appendChild(tr);
  }

  traceStatus.textContent = `Hop ${hop.hop}: ${hop.ip}`;
});

electronAPI.onTracerouteDone(({ exitCode, error }) => {
  state.tracerouteRunning = false;
  btnStartTrace.classList.remove('hidden');
  btnStopTrace.classList.add('hidden');

  if (error) {
    traceStatus.textContent = `Error: ${error}`;
    traceStatus.style.color = 'var(--red)';
  } else {
    traceStatus.textContent = 'Traceroute complete.';
    traceStatus.style.color = 'var(--green)';
  }
});

/* ══ DNS Panel Wiring ════════════════════════════════════════════════════════ */
// Wire up DNS tab controls
const btnDnsRun       = $('btn-dns-run');
const dnsDomainInput  = $('dns-domain-input');
const dnsTypeSelect   = $('dns-type-select');

btnDnsRun.addEventListener('click', () => {
  const domain = dnsDomainInput.value.trim();
  if (!domain) return;
  runDnsCheck(domain, dnsTypeSelect.value);
});

dnsDomainInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const domain = dnsDomainInput.value.trim();
    if (domain) runDnsCheck(domain, dnsTypeSelect.value);
  }
});

async function runDnsCheck(domain, type) {
  const resultsContainer = $('dns-results');
  const consensusEl = $('dns-consensus');
  if (!resultsContainer) return;

  type = type || 'A';
  resultsContainer.innerHTML = '<div class="detail-loading"><div class="spinner"></div><span>Checking DNS propagation…</span></div>';
  if (consensusEl) consensusEl.innerHTML = '';

  try {
    const data = await electronAPI.dnsPropagation(domain, type);
    if (data.error) {
      resultsContainer.innerHTML = `<div class="bgp-error">${data.error}</div>`;
      return;
    }
    // Render results using shared renderDnsResults from dns-panel.js
    if (window.renderDnsResults) {
      window.renderDnsResults(data, resultsContainer, consensusEl);
    }
  } catch (err) {
    resultsContainer.innerHTML = `<div class="dns-error">DNS check failed: ${err.message || err}</div>`;
  }
}

/* ══ Ping Monitor Wiring ════════════════════════════════════════════════════ */
const btnPingStart      = $('btn-ping-start');
const btnPingStop       = $('btn-ping-stop');
const pingTargetInput   = $('ping-target-input');
const pingIntervalSelect= $('ping-interval-select');
const pingThresholdInput= $('ping-threshold-input');
const pingLogBody       = $('ping-log-body');

let pingChart = null;
let pingStats = { sent: 0, recv: 0, loss: 0, min: Infinity, max: -Infinity, avg: 0, jitter: 0, lastLatency: -1 };
let pingSum = 0;
let pingPrevLatency = 0;

// Initialize PingChart after DOM ready
document.addEventListener('DOMContentLoaded', () => {
  const canvas = $('ping-chart-canvas');
  if (canvas && window.PingChart) {
    pingChart = new PingChart(canvas, { threshold: 100, maxPoints: 300 });
  }
});

btnPingStart.addEventListener('click', () => {
  const target = pingTargetInput.value.trim();
  if (!target) return;

  const interval = parseFloat(pingIntervalSelect.value);
  const threshold = parseInt(pingThresholdInput.value) || 100;

  // Reset stats
  pingStats = { sent: 0, recv: 0, loss: 0, min: Infinity, max: -Infinity, avg: 0, jitter: 0, lastLatency: -1 };
  pingSum = 0;
  pingPrevLatency = 0;

  // Set threshold on chart
  if (pingChart) {
    pingChart.setThreshold(threshold);
    pingChart.clear();
  }

  // Clear log table
  pingLogBody.innerHTML = '';

  // Start ping
  electronAPI.pingStart(target, interval, 0);

  // Toggle buttons
  btnPingStart.classList.add('hidden');
  btnPingStop.classList.remove('hidden');
});

btnPingStop.addEventListener('click', () => {
  electronAPI.pingStop();
  btnPingStop.classList.add('hidden');
  btnPingStart.classList.remove('hidden');
});

electronAPI.onPingResult((data) => {
  const { seq, time, latency, status } = data;

  // Update chart
  if (pingChart) {
    pingChart.addPoint(latency >= 0 ? latency : 0);
  }

  // Update stats
  pingStats.sent++;
  if (status === 'ok') {
    pingStats.recv++;
    if (latency < pingStats.min) pingStats.min = latency;
    if (latency > pingStats.max) pingStats.max = latency;
    pingSum += latency;
    pingStats.avg = pingSum / pingStats.recv;
    pingStats.lastLatency = latency;

    // Jitter: average absolute difference between consecutive pings
    if (pingStats.recv > 1) {
      const diff = Math.abs(latency - pingPrevLatency);
      pingStats.jitter = pingStats.jitter + (diff - pingStats.jitter) / (pingStats.recv - 1);
    }
    pingPrevLatency = latency;
  }
  pingStats.loss = pingStats.sent > 0 ? ((pingStats.sent - pingStats.recv) / pingStats.sent * 100) : 0;

  // Update DOM
  $('ping-sent').textContent = pingStats.sent;
  $('ping-recv').textContent = pingStats.recv;
  $('ping-loss').textContent = pingStats.loss.toFixed(1) + '%';
  $('ping-min').textContent = pingStats.min === Infinity ? '—' : pingStats.min.toFixed(1) + 'ms';
  $('ping-max').textContent = pingStats.max === -Infinity ? '—' : pingStats.max.toFixed(1) + 'ms';
  $('ping-avg').textContent = pingStats.recv > 0 ? pingStats.avg.toFixed(1) + 'ms' : '—';
  $('ping-jitter').textContent = pingStats.recv > 1 ? pingStats.jitter.toFixed(1) + 'ms' : '—';
  $('ping-last').textContent = pingStats.lastLatency >= 0 ? pingStats.lastLatency.toFixed(1) + 'ms' : '—';

  // Add log row
  const tr = document.createElement('tr');
  const statusLabel = status === 'ok' ? `<span style="color:var(--green)">${latency.toFixed(1)}ms</span>` : `<span style="color:var(--red)">${status}</span>`;
  const timeStr = time ? new Date(time).toLocaleTimeString() : '';
  tr.innerHTML = `<td>${seq}</td><td>${timeStr}</td><td>${status === 'ok' ? latency.toFixed(1) + 'ms' : '—'}</td><td>${statusLabel}</td>`;
  pingLogBody.insertBefore(tr, pingLogBody.firstChild);
});

electronAPI.onPingDone(() => {
  btnPingStop.classList.add('hidden');
  btnPingStart.classList.remove('hidden');
});