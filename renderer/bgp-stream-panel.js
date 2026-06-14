'use strict';

// ─── BGP Stream Panel — Real-time RIS Live Feed ───────────────────────────────
// Menampilkan event BGP UPDATE/WITHDRAW secara real-time dari RIPE NCC RIS Live

const MAX_LOG_ENTRIES = 200; // Maksimal baris yang disimpan di log

let streamLog = []; // array of event objects
let monitoredAsnList = []; // cached list for display

async function initBgpStreamPanel() {
  // Load daftar ASN yang dimonitor untuk tampilan badge
  try {
    monitoredAsnList = await settingsAPI.getMonitoredAsns() || [];
  } catch (_) {
    monitoredAsnList = [];
  }

  renderAsnBadges();

  // Listen ke stream updates dari main process
  settingsAPI.onBgpStreamUpdate((event) => {
    appendStreamEvent(event);
  });

  // Listen ke status perubahan koneksi
  settingsAPI.onBgpStreamStatus(({ connected, error }) => {
    updateStreamStatus(connected, error);
  });
}

// ─── Status Indicator ────────────────────────────────────────────────────────
function updateStreamStatus(connected, error = null) {
  const dot = document.getElementById('bgp-stream-dot');
  const label = document.getElementById('bgp-stream-status-label');
  if (!dot || !label) return;

  if (connected) {
    dot.className = 'bgp-stream-dot connected';
    label.textContent = 'Connected';
  } else {
    dot.className = 'bgp-stream-dot disconnected';
    label.textContent = error ? 'Error' : 'Disconnected';
  }
}

// ─── ASN Badges ──────────────────────────────────────────────────────────────
function renderAsnBadges() {
  const container = document.getElementById('bgp-stream-asns');
  if (!container) return;

  if (monitoredAsnList.length === 0) {
    container.innerHTML = '<span class="bgp-stream-no-asn">Belum ada ASN — buka Settings untuk menambahkan</span>';
    return;
  }

  container.innerHTML = monitoredAsnList.map((asn) =>
    `<span class="bgp-stream-asn-chip">${asn}</span>`
  ).join('');
}

// ─── Append Event ─────────────────────────────────────────────────────────────
function appendStreamEvent(event) {
  streamLog.push(event);

  // Trim log jika melebihi batas
  if (streamLog.length > MAX_LOG_ENTRIES) {
    streamLog = streamLog.slice(-MAX_LOG_ENTRIES);
    // Hapus baris terlama di DOM juga
    const tbody = document.getElementById('bgp-stream-tbody');
    if (tbody && tbody.children.length >= MAX_LOG_ENTRIES) {
      tbody.removeChild(tbody.lastChild);
    }
  }

  const tbody = document.getElementById('bgp-stream-tbody');
  const emptyEl = document.getElementById('bgp-stream-empty');
  if (!tbody) return;

  if (emptyEl) emptyEl.style.display = 'none';

  const tr = document.createElement('tr');
  tr.className = `bgp-event-row bgp-event-${event.type.toLowerCase()}`;

  const typeBadge = event.type === 'UPDATE'
    ? '<span class="bgp-type-badge bgp-update">▲ UPDATE</span>'
    : '<span class="bgp-type-badge bgp-withdraw">▼ WITHDRAW</span>';

  // Highlight ASN termonitor di AS path
  let pathHtml = event.asPath || '—';
  if (monitoredAsnList.length > 0) {
    monitoredAsnList.forEach((asn) => {
      pathHtml = pathHtml.replaceAll(asn,
        `<span class="bgp-path-highlight">${asn}</span>`
      );
    });
  }

  tr.innerHTML = `
    <td class="bgp-col-time">${event.time || '—'}</td>
    <td class="bgp-col-type">${typeBadge}</td>
    <td class="bgp-col-prefix"><code>${event.prefix || '—'}</code></td>
    <td class="bgp-col-peer">${event.peerAsn || '—'}</td>
    <td class="bgp-col-path">${pathHtml}</td>`;

  // Masukkan di atas (newest first)
  tbody.insertBefore(tr, tbody.firstChild);

  // Animasi masuk
  tr.style.animation = 'bgp-row-in 0.25s ease';
}

// ─── Clear Log ────────────────────────────────────────────────────────────────
function clearStreamLog() {
  streamLog = [];
  const tbody = document.getElementById('bgp-stream-tbody');
  if (tbody) tbody.innerHTML = '';
  const emptyEl = document.getElementById('bgp-stream-empty');
  if (emptyEl) emptyEl.style.display = 'flex';
}

// ─── Refresh ASN Badges (dipanggil setelah settings disimpan) ────────────────
async function refreshStreamAsns() {
  try {
    monitoredAsnList = await settingsAPI.getMonitoredAsns() || [];
  } catch (_) {}
  renderAsnBadges();
}

// ─── AS Path Graph Button Logic ───────────────────────────────────────────────
function initAsPathGraphButton() {
  const btn = document.getElementById('btn-aspath-graph');
  if (!btn) return;

  btn.addEventListener('click', () => {
    if (!btn.disabled) {
      if (window.settingsAPI && window.settingsAPI.openAspathGraph) {
        window.settingsAPI.openAspathGraph(streamLog);
      }
    }
  });

  setInterval(() => {
    const hasPaths = streamLog.some(e => e.asPath && e.asPath !== '—' && e.asPath.trim().length > 0);
    btn.disabled = !hasPaths;
    btn.title = hasPaths ? 'Open AS Path Graph' : 'No AS Path data available';
  }, 2000);
}

// ─── Export ──────────────────────────────────────────────────────────────────
if (typeof window !== 'undefined') {
  window.bgpStreamPanel = {
    init: () => {
      initBgpStreamPanel();
      initAsPathGraphButton();
    },
    clear: clearStreamLog,
    refreshAsns: refreshStreamAsns,
    updateStatus: updateStreamStatus,
    getLog: () => streamLog,
    getMonitoredAsns: () => monitoredAsnList.slice(),
  };
}

