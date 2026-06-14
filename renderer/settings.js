'use strict';

// ─── State ────────────────────────────────────────────────────────────────────
let currentAsns = []; // array of string ASN, e.g. ["AS7713", "AS13335"]
let toastTimer = null;

// ─── Elements ─────────────────────────────────────────────────────────────────
const $ = (s) => document.querySelector(s);
const asnInput      = $('#asn-input');
const btnAddAsn     = $('#btn-add-asn');
const btnSave       = $('#btn-save');
const asnChips      = $('#asn-chips');
const chipsEmpty    = $('#chips-empty');
const asnCountBadge = $('#asn-count-badge');
const statusDot     = $('#status-dot');
const statusText    = $('#status-text');
const saveHint      = $('#save-hint');
const toast         = $('#toast');

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  // Load current monitored ASNs
  try {
    const asns = await settingsAPI.getMonitoredAsns();
    currentAsns = Array.isArray(asns) ? [...asns] : [];
  } catch (e) {
    currentAsns = [];
  }

  renderChips();
  bindEvents();
  listenStreamStatus();
}

// ─── Listen to RIS Live status ────────────────────────────────────────────────
function listenStreamStatus() {
  settingsAPI.onBgpStreamStatus(({ connected, error }) => {
    if (connected) {
      statusDot.className = 'status-dot connected';
      statusText.textContent = `Terhubung ke RIS Live${currentAsns.length > 0 ? ' · ' + currentAsns.length + ' ASN' : ''}`;
    } else {
      statusDot.className = 'status-dot disconnected';
      statusText.textContent = error ? `Terputus: ${error}` : 'Terputus dari RIS Live';
    }
  });

  // Request initial status from main process
  // (akan dikirim saat pertama kali connect)
  statusDot.className = 'status-dot connecting';
  statusText.textContent = 'Memeriksa koneksi…';
}

// ─── Events ───────────────────────────────────────────────────────────────────
function bindEvents() {
  // Tabs
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
      btn.classList.add('active');
      $(`#tab-${btn.dataset.tab}`).classList.add('active');
    });
  });

  // Add ASN
  btnAddAsn.addEventListener('click', handleAddAsn);
  asnInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleAddAsn();
  });

  // Save
  btnSave.addEventListener('click', handleSave);
}

// ─── Add ASN ──────────────────────────────────────────────────────────────────
function handleAddAsn() {
  let val = asnInput.value.trim().toUpperCase();
  if (!val) return;

  // Auto-prefix: jika user input "7713" → "AS7713"
  if (/^\d+$/.test(val)) val = 'AS' + val;

  // Validasi format
  if (!/^AS\d+$/.test(val)) {
    showToast('Format tidak valid. Gunakan AS diikuti angka, contoh: AS7713', 'error');
    return;
  }

  // Cek duplikat
  if (currentAsns.includes(val)) {
    showToast(`${val} sudah ada dalam daftar.`, 'error');
    return;
  }

  currentAsns.push(val);
  asnInput.value = '';
  renderChips();
  showToast(`${val} ditambahkan. Jangan lupa simpan!`, 'info');
}

// ─── Remove ASN ───────────────────────────────────────────────────────────────
function handleRemoveAsn(asn) {
  currentAsns = currentAsns.filter((a) => a !== asn);
  renderChips();
}

// ─── Save ─────────────────────────────────────────────────────────────────────
async function handleSave() {
  btnSave.disabled = true;
  btnSave.textContent = 'Menyimpan…';

  try {
    const result = await settingsAPI.setMonitoredAsns(currentAsns);
    if (result && result.success) {
      showToast('Tersimpan! Koneksi RIS Live diperbarui.', 'success');
      saveHint.textContent = `✓ Disimpan ${new Date().toLocaleTimeString()}`;
      saveHint.classList.add('visible');
      setTimeout(() => saveHint.classList.remove('visible'), 4000);
    } else {
      showToast('Gagal menyimpan: ' + (result?.error || 'Unknown error'), 'error');
    }
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  } finally {
    btnSave.disabled = false;
    btnSave.innerHTML = `
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="14" height="14">
        <path d="M3 8a5 5 0 1 0 10 0 5 5 0 0 0-10 0M3 3v5h5"/>
      </svg>
      Simpan &amp; Reconnect`;
  }
}

// ─── Render Chips ─────────────────────────────────────────────────────────────
function renderChips() {
  // Remove existing chips (jangan hapus chipsEmpty)
  asnChips.querySelectorAll('.asn-chip').forEach((c) => c.remove());

  asnCountBadge.textContent = currentAsns.length;

  if (currentAsns.length === 0) {
    chipsEmpty.style.display = 'flex';
    return;
  }

  chipsEmpty.style.display = 'none';

  currentAsns.forEach((asn) => {
    const chip = document.createElement('div');
    chip.className = 'asn-chip';
    chip.innerHTML = `
      <span>${asn}</span>
      <button class="chip-remove" data-asn="${asn}" title="Hapus ${asn}">✕</button>`;
    chip.querySelector('.chip-remove').addEventListener('click', () => handleRemoveAsn(asn));
    asnChips.appendChild(chip);
  });
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(message, type = 'info') {
  toast.textContent = message;
  toast.className = `toast toast-${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 3500);
}

// ─── Start ────────────────────────────────────────────────────────────────────
init();