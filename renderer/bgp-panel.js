'use strict';

// ─── BGP Route Information Panel Logic ───────────────────────────────────────

function initBgpPanel() {
  // BGP is loaded from the detail panel tab
}

async function openBgpPanel(ip) {
  const panel = document.getElementById('detail-panel');
  if (!panel) return;

  // Activate BGP tab
  document.querySelectorAll('.detail-tab').forEach((t) => t.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach((p) => p.classList.remove('active'));
  const bgpTab = document.querySelector('.detail-tab[data-tab="bgp"]');
  const bgpPane = document.getElementById('tab-bgp');
  if (bgpTab) bgpTab.classList.add('active');
  if (bgpPane) bgpPane.classList.add('active');
  panel.classList.add('visible');

  await loadBgpInfo(ip);
}

async function loadBgpInfo(ip) {
  const container = document.getElementById('bgp-content');
  if (!container) return;

  container.innerHTML = '<div class="bgp-loading"><div class="spinner"></div> Querying BGP information...</div>';

  try {
    const data = await electronAPI.bgpLookup(ip);
    renderBgpInfo(data, container);
  } catch (err) {
    container.innerHTML = `<div class="bgp-error">BGP lookup failed: ${err.message || err}</div>`;
  }
}

function renderBgpInfo(data, container) {
  if (!data || data.error) {
    container.innerHTML = `<div class="bgp-error">${data?.error || 'No BGP data available'}</div>`;
    return;
  }

  let html = '';

  // Route Summary
  html += `<div class="bgp-section">
    <div class="bgp-section-title">Route Summary</div>
    <div class="bgp-info-grid">
      <div class="bgp-info-row"><span class="bgp-label">IP Address</span><span class="bgp-value">${data.ip || '—'}</span></div>
      <div class="bgp-info-row"><span class="bgp-label">BGP Prefix</span><span class="bgp-value"><code>${data.prefix || '—'}</code></span></div>
      <div class="bgp-info-row"><span class="bgp-label">Origin AS</span><span class="bgp-value">${data.origin_as || '—'} ${data.origin_as_name ? '(' + data.origin_as_name + ')' : ''}</span></div>
      <div class="bgp-info-row"><span class="bgp-label">RPKI Status</span><span class="bgp-value">${renderRpkiBadge(data.rpki_status)}</span></div>
      <div class="bgp-info-row"><span class="bgp-label">Country</span><span class="bgp-value">${data.country || '—'}</span></div>
      <div class="bgp-info-row"><span class="bgp-label">Registry</span><span class="bgp-value">${data.registry || '—'}</span></div>
    </div>
  </div>`;

  // Upstreams
  if (data.upstreams && data.upstreams.length > 0) {
    html += `<div class="bgp-section">
      <div class="bgp-section-title">Upstream / Transit AS</div>
      <table class="bgp-table">
        <thead><tr><th>ASN</th><th>Name</th><th>Country</th><th>Type</th></tr></thead>
        <tbody>`;
    for (const u of data.upstreams) {
      html += `<tr>
        <td><code>${u.asn || '—'}</code></td>
        <td>${u.name || '—'}</td>
        <td>${u.country || '—'}</td>
        <td><span class="cat-tag cat-transit">${u.type || '—'}</span></td>
      </tr>`;
    }
    html += '</tbody></table></div>';
  }

  // Related Prefixes
  if (data.prefixes_by_asn && data.prefixes_by_asn.length > 0) {
    html += `<div class="bgp-section">
      <div class="bgp-section-title">All Prefixes by ${data.origin_as || 'Origin AS'}</div>
      <table class="bgp-table">
        <thead><tr><th>Prefix</th><th>IP Count</th><th>RPKI</th></tr></thead>
        <tbody>`;
    for (const p of data.prefixes_by_asn) {
      html += `<tr>
        <td><code>${p.prefix || '—'}</code></td>
        <td>${p.ipCount ? p.ipCount.toLocaleString() : '—'}</td>
        <td>${renderRpkiBadge(p.rpki || data.rpki_status)}</td>
      </tr>`;
    }
    html += '</tbody></table></div>';
  }

  // Timestamp
  html += `<div class="bgp-timestamp">Data source: RIPE Stat API &bull; Updated: ${data.timestamp ? new Date(data.timestamp).toLocaleTimeString() : '—'}</div>`;

  container.innerHTML = html;
}

function renderRpkiBadge(status) {
  const s = (status || '').toLowerCase();
  if (s === 'valid') return '<span class="rpki-badge rpki-valid">Valid</span>';
  if (s === 'invalid') return '<span class="rpki-badge rpki-invalid">Invalid</span>';
  return '<span class="rpki-badge rpki-unknown">Unknown</span>';
}

// Export
if (typeof window !== 'undefined') {
  window.initBgpPanel = initBgpPanel;
  window.openBgpPanel = openBgpPanel;
  window.loadBgpInfo = loadBgpInfo;
}