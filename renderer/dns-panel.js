'use strict';

// ─── DNS Propagation Panel Logic ─────────────────────────────────────────────
const DNS_RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'NS', 'MX', 'TXT', 'ALL'];

function initDnsPanel() {
  const dnsBtn = document.getElementById('btn-dns-check');
  if (dnsBtn) {
    dnsBtn.addEventListener('click', () => {
      const selectedIp = getSelectedIp();
      if (selectedIp) {
        const domain = prompt('Enter domain to check DNS:', selectedIp) || selectedIp;
        openDnsPanel(domain);
      }
    });
  }
}

async function openDnsPanel(domain) {
  const panel = document.getElementById('detail-panel');
  if (!panel) return;

  // Activate DNS tab
  document.querySelectorAll('.detail-tab').forEach((t) => t.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach((p) => p.classList.remove('active'));
  const dnsTab = document.querySelector('.detail-tab[data-tab="dns"]');
  const dnsPane = document.getElementById('tab-dns');
  if (dnsTab) dnsTab.classList.add('active');
  if (dnsPane) dnsPane.classList.add('active');
  panel.classList.add('visible');

  // Set domain input
  const domainInput = document.getElementById('dns-domain-input');
  if (domainInput) domainInput.value = domain;

  // Auto-run check
  await runDnsCheck(domain);
}

async function runDnsCheck(domain, type) {
  const resultsContainer = document.getElementById('dns-results');
  const consensusEl = document.getElementById('dns-consensus');
  if (!resultsContainer) return;

  if (!type) {
    const typeSelect = document.getElementById('dns-type-select');
    type = typeSelect ? typeSelect.value : 'A';
  }

  // Show loading
  resultsContainer.innerHTML = '<div class="dns-loading"><div class="spinner"></div> Checking DNS resolvers...</div>';
  if (consensusEl) consensusEl.innerHTML = '';

  try {
    const data = await electronAPI.dnsPropagation(domain, type);
    renderDnsResults(data, resultsContainer, consensusEl);
  } catch (err) {
    resultsContainer.innerHTML = `<div class="dns-error">DNS check failed: ${err.message || err}</div>`;
  }
}

function renderDnsResults(data, container, consensusEl) {
  if (!data || !data.resolvers) {
    container.innerHTML = '<div class="dns-error">No data returned</div>';
    return;
  }

  const { resolvers, consensus } = data;

  // Build table
  let html = `<table class="dns-table">
    <thead><tr>
      <th class="dns-col-status"></th>
      <th class="dns-col-resolver">Resolver</th>
      <th class="dns-col-result">IP Result</th>
      <th class="dns-col-time">Response</th>
    </tr></thead><tbody>`;

  for (const r of resolvers) {
    const statusIcon = r.status === 'ok' ? '🟢' : r.status === 'timeout' ? '🟡' : '🔴';
    const differs = consensus && consensus.differingResolvers && consensus.differingResolvers.includes(r.name);
    const recordsStr = (r.records || []).join(', ') || (r.error || '—');
    const timeStr = r.status === 'timeout' ? 'Timeout' : `${r.responseTime || 0}ms`;
    const diffBadge = differs ? '<span class="dns-differs">DIFFERS</span>' : '';

    html += `<tr class="${differs ? 'dns-row-differs' : ''} ${r.status !== 'ok' ? 'dns-row-error' : ''}">
      <td class="dns-col-status">${statusIcon}</td>
      <td class="dns-col-resolver"><span class="dns-resolver-name">${r.name}</span><br><span class="dns-resolver-ip">${r.server}</span></td>
      <td class="dns-col-result">${recordsStr} ${diffBadge}</td>
      <td class="dns-col-time">${timeStr}</td>
    </tr>`;
  }

  html += '</tbody></table>';
  container.innerHTML = html;

  // Consensus
  if (consensusEl && consensus) {
    if (consensus.agreeCount === consensus.totalCount) {
      consensusEl.innerHTML = `<div class="dns-consensus dns-consensus-ok">All ${consensus.totalCount} resolvers agree on <code>${consensus.ip}</code></div>`;
    } else {
      const diffNames = (consensus.differingResolvers || []).join(', ');
      consensusEl.innerHTML = `<div class="dns-consensus dns-consensus-warn">Consensus: ${consensus.agreeCount}/${consensus.totalCount} resolvers agree on <code>${consensus.ip}</code> — Differing: ${diffNames}</div>`;
    }
  }
}

// Export shared render function for use in monitor.js and modal
if (typeof window !== 'undefined') {
  window.renderDnsResults = renderDnsResults;
  window.runDnsCheck = runDnsCheck;
}