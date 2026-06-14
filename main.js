'use strict';

const {
  app,
  BrowserWindow,
  WebContentsView,
  ipcMain,
  session,
  nativeTheme,
  Menu,
  dialog,
} = require('electron');

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const dns = require('dns').promises;
const dnsSync = require('dns');

// ─── Constants ────────────────────────────────────────────────────────────────
const TOOLBAR_HEIGHT = 56;
const MIN_WIDTH = 1100;
const MIN_HEIGHT = 680;

// ─── Monitored ASNs Path ──────────────────────────────────────────────────────
const MONITORED_ASNS_PATH = path.join(__dirname, 'monitored-asns.json');

// ─── Monitored ASNs Persistence ───────────────────────────────────────────────
let monitoredAsns = []; // array of strings: ["AS7713", "AS13335"]

function loadMonitoredAsns() {
  try {
    if (fs.existsSync(MONITORED_ASNS_PATH)) {
      const data = JSON.parse(fs.readFileSync(MONITORED_ASNS_PATH, 'utf8'));
      monitoredAsns = Array.isArray(data.asns) ? data.asns : [];
    } else {
      // Default: mulai dengan daftar kosong
      monitoredAsns = [];
      saveMonitoredAsnsFile();
    }
  } catch (err) {
    console.error('[Monitored ASNs] Failed to load:', err.message);
    monitoredAsns = [];
  }
  console.log(`[Monitored ASNs] Loaded: ${monitoredAsns.join(', ') || '(empty)'}`);
  return monitoredAsns;
}

function saveMonitoredAsnsFile() {
  try {
    const data = {
      version: '1.0',
      lastModified: new Date().toISOString(),
      asns: monitoredAsns,
    };
    fs.writeFileSync(MONITORED_ASNS_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('[Monitored ASNs] Failed to save:', err.message);
  }
}

// Load on startup
loadMonitoredAsns();

// ─── RIS Live WebSocket Client ─────────────────────────────────────────────────
let risLiveWs = null;
let risLiveReconnectTimer = null;
let risLiveConnected = false;

function connectRisLive() {
  // Jangan connect jika tidak ada ASN yang dimonitor
  if (monitoredAsns.length === 0) {
    console.log('[RIS Live] No ASNs to monitor, skipping connection.');
    return;
  }

  // Clear reconnect timer
  if (risLiveReconnectTimer) {
    clearTimeout(risLiveReconnectTimer);
    risLiveReconnectTimer = null;
  }

  // Close existing connection
  if (risLiveWs) {
    try { risLiveWs.close(); } catch (_) {}
    risLiveWs = null;
  }

  console.log(`[RIS Live] Connecting for ASNs: ${monitoredAsns.join(', ')}`);

  let WebSocket;
  try {
    WebSocket = require('ws');
  } catch (e) {
    console.error('[RIS Live] ws module not found. Run: npm install ws in electron-app/');
    broadcastStreamStatus(false, 'Package ws tidak terinstall. Jalankan: npm install ws');
    return;
  }

  const ws = new WebSocket('wss://ris-live.ripe.net/v1/ws/?client=cdn-diagnostic-browser');
  risLiveWs = ws;
  
  let pingInterval;

  ws.on('open', () => {
    console.log('[RIS Live] Connected!');
    risLiveConnected = true;
    broadcastStreamStatus(true);
    
    // Keep-alive ping to prevent server disconnects (code 1006/1005)
    pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.ping();
      // RIS Live allows an explicit ping message as well: ws.send(JSON.stringify({ type: 'ping' }))
      ws.send(JSON.stringify({ type: 'ris_subscribe', data: { type: 'ping' } })); // Heartbeat via API just in case standard ws.ping() is ignored
    }, 60000);

    // Subscribe ke tiap ASN yang dimonitor menggunakan path filter
    // Dokumentasi: https://ris-live.ripe.net/manual/#ris_subscribe
    for (const asn of monitoredAsns) {
      const asnNum = parseInt(asn.replace(/^AS/i, ''), 10);
      ws.send(JSON.stringify({
        type: 'ris_subscribe',
        data: {
          type: 'UPDATE',
          path: asnNum,
          moreSpecific: true,
        },
      }));
      console.log(`[RIS Live] Subscribed for ${asn} (${asnNum})`);
    }
  });

  ws.on('message', (rawData) => {
    try {
      const msg = JSON.parse(rawData.toString());
      if (msg.type !== 'ris_message') return;

      const data = msg.data;
      if (!data) return;

      // Ambil AS path — bisa dari path atau path2
      const asPath = Array.isArray(data.path) ? data.path : [];
      if (asPath.length === 0) return;

      // Filter: cek apakah salah satu ASN yang dimonitor ada di AS path
      const isRelevant = monitoredAsns.some((asn) => {
        const asnNum = parseInt(asn.replace(/^AS/i, ''), 10);
        return asPath.includes(asnNum);
      });
      if (!isRelevant) return;

      const originAs = `AS${asPath[asPath.length - 1]}`;
      const peerAsn = data.peer_asn ? `AS${data.peer_asn}` : '—';
      const ts = data.timestamp || Date.now() / 1000;
      const timeStr = new Date(ts * 1000).toLocaleTimeString('en-GB');
      const asPathStr = asPath.map((n) => `AS${n}`).join(' → ');

      // Process announcements (UPDATE)
      const announcements = data.announcements || [];
      for (const ann of announcements) {
        const prefixes = ann.prefixes || [];
        for (const prefix of prefixes) {
          broadcastStreamUpdate({
            type: 'UPDATE',
            time: timeStr,
            timestamp: ts,
            peer: data.peer || '—',
            peerAsn,
            prefix,
            asPath: asPathStr,
            originAs,
          });
        }
      }

      // Process withdrawals (WITHDRAW)
      const withdrawals = data.withdrawals || [];
      for (const prefix of withdrawals) {
        broadcastStreamUpdate({
          type: 'WITHDRAW',
          time: timeStr,
          timestamp: ts,
          peer: data.peer || '—',
          peerAsn,
          prefix: typeof prefix === 'string' ? prefix : prefix.prefix || '—',
          asPath: asPathStr,
          originAs,
        });
      }
    } catch (e) {
      // Ignore parse errors silently
    }
  });

  ws.on('close', (code, reason) => {
    if (pingInterval) clearInterval(pingInterval);
    console.log(`[RIS Live] Disconnected (code: ${code})`);
    risLiveConnected = false;
    risLiveWs = null;
    broadcastStreamStatus(false);

    // Auto-reconnect setelah 10 detik jika masih ada ASN yang dimonitor
    if (monitoredAsns.length > 0) {
      risLiveReconnectTimer = setTimeout(() => {
        console.log('[RIS Live] Attempting reconnect…');
        connectRisLive();
      }, 10000);
    }
  });

  ws.on('error', (err) => {
    if (pingInterval) clearInterval(pingInterval);
    console.error('[RIS Live] WebSocket error:', err.message);
    risLiveConnected = false;
    broadcastStreamStatus(false, err.message);
  });
}

function disconnectRisLive() {
  if (risLiveReconnectTimer) {
    clearTimeout(risLiveReconnectTimer);
    risLiveReconnectTimer = null;
  }
  if (risLiveWs) {
    try { risLiveWs.close(); } catch (_) {}
    risLiveWs = null;
  }
  risLiveConnected = false;
  broadcastStreamStatus(false);
}

function broadcastStreamStatus(connected, error = null) {
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send('bgp:stream-status', { connected, error });
  });
}

function broadcastStreamUpdate(event) {
  if (mainWindow) {
    mainWindow.webContents.send('bgp:stream-update', event);
  }
}

// ─── Global State ─────────────────────────────────────────────────────────────
let mainWindow = null;
let browserView = null;
let activeTracerouteProcess = null;
let activePingProcess = null;
const whoisCache = new Map();
let monitorWidth = 420;
let isDraggingSidebar = false;

// ─── WHOIS / ASN Lookup ───────────────────────────────────────────────────────
async function fetchWhois(ip) {
  if (whoisCache.has(ip)) return whoisCache.get(ip);

  try {
    const [ipApiRes, rdapRes] = await Promise.allSettled([
      fetch(`http://ip-api.com/json/${ip}?fields=status,country,countryCode,isp,org,as,query`)
        .then((r) => r.json()),
      fetch(`https://rdap.org/ip/${ip}`, { headers: { Accept: 'application/json' } })
        .then((r) => r.json()),
    ]);

    let asn = '—', org = '—', country = '—', cidr = '—';

    if (ipApiRes.status === 'fulfilled' && ipApiRes.value.status === 'success') {
      const d = ipApiRes.value;
      if (d.as) {
        const m = d.as.match(/^(AS\d+)/i);
        asn = m ? m[1] : d.as;
      }
      org = d.org || d.isp || '—';
      country = d.country ? `${d.country} (${d.countryCode || ''})` : '—';
    }

    if (rdapRes.status === 'fulfilled') {
      const d = rdapRes.value;
      if (org === '—' && d.entities) {
        for (const e of d.entities) {
          const fn = e.vcardArray?.[1]?.find((i) => i[0] === 'fn')?.[3];
          if (fn) { org = fn; break; }
        }
      }
      if (d.startAddress && d.endAddress) {
        cidr = `${d.startAddress} – ${d.endAddress}`;
      }
    }

    const result = { asn, org, country, cidr };
    whoisCache.set(ip, result);
    return result;
  } catch (err) {
    const result = { asn: '—', org: '—', country: '—', cidr: '—', error: err.message };
    whoisCache.set(ip, result);
    return result;
  }
}

// ─── Traceroute Parser ─────────────────────────────────────────────────────────
function parseTracerouteLine(line) {
  const clean = line.trim();
  if (!clean || !/^\d+/.test(clean)) return null;

  const parts = clean.split(/\s+/).filter(Boolean);
  const hop = parseInt(parts[0], 10);
  if (isNaN(hop)) return null;

  let rttTokens = [];
  let idx = 1;
  for (let i = 0; i < 3; i++) {
    if (idx >= parts.length) break;
    const cur = parts[idx];
    if (cur === '*') {
      rttTokens.push('*');
      idx++;
    } else if (cur.includes('<') || !isNaN(cur)) {
      if (idx + 1 < parts.length && parts[idx + 1].toLowerCase() === 'ms') {
        rttTokens.push(`${cur} ms`);
        idx += 2;
      } else {
        rttTokens.push(cur);
        idx++;
      }
    } else break;
  }

  const dest = parts.slice(idx).join(' ');
  const timedOut = dest.toLowerCase().includes('timed out') || rttTokens.every((r) => r === '*');

  return {
    hop,
    ip: timedOut ? '*' : dest,
    rtt: rttTokens.join(', '),
    status: timedOut ? 'timeout' : 'ok',
  };
}

// ─── Ping Line Parser ─────────────────────────────────────────────────────────
function parsePingLine(line, isWin) {
  const now = new Date().toLocaleTimeString('en-GB');

  if (isWin) {
    const match = line.match(/Reply from .+?: bytes=\d+ time[=<](\d+)ms TTL=(\d+)/i);
    if (match) {
      return { time: now, latency: parseInt(match[1]), ttl: parseInt(match[2]), status: 'ok' };
    }
    if (line.includes('Request timed out')) {
      return { time: now, latency: -1, ttl: 0, status: 'timeout' };
    }
  } else {
    const match = line.match(/(\d+\.?\d*) ms/);
    if (match) {
      return { time: now, latency: Math.round(parseFloat(match[1])), ttl: 0, status: 'ok' };
    }
    if (line.includes('timeout') || line.includes('Unreachable')) {
      return { time: now, latency: -1, ttl: 0, status: 'timeout' };
    }
  }
  return null;
}

// ─── DNS Propagation ──────────────────────────────────────────────────────────
const DNS_RESOLVERS = [
  { name: 'Google', server: '8.8.8.8' },
  { name: 'Cloudflare', server: '1.1.1.1' },
  { name: 'OpenDNS', server: '208.67.222.222' },
  { name: 'Quad9', server: '9.9.9.9' },
  { name: 'Alibaba', server: '223.5.5.5' },
  { name: 'Cloudflare Family', server: '1.1.1.2' },
];

async function checkDnsPropagation(domain, type = 'A') {
  const results = await Promise.allSettled(
    DNS_RESOLVERS.map(async (resolver) => {
      const start = Date.now();
      const dnsResolver = new dnsSync.Resolver();
      dnsResolver.setServers([resolver.server]);

      try {
        const records = await Promise.race([
          new Promise((resolve, reject) => {
            if (type === 'A') {
              dnsResolver.resolve4(domain, (err, addresses) => {
                if (err) reject(err);
                else resolve(addresses);
              });
            } else if (type === 'AAAA') {
              dnsResolver.resolve6(domain, (err, addresses) => {
                if (err) reject(err);
                else resolve(addresses);
              });
            } else {
              dnsResolver.resolve(domain, type, (err, records) => {
                if (err) reject(err);
                else resolve(records);
              });
            }
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
        ]);

        return {
          name: resolver.name,
          server: resolver.server,
          status: 'ok',
          records: Array.isArray(records) ? records : [],
          responseTime: Date.now() - start,
        };
      } catch (err) {
        return {
          name: resolver.name,
          server: resolver.server,
          status: err.message === 'timeout' ? 'timeout' : 'error',
          records: [],
          responseTime: Date.now() - start,
          error: err.message,
        };
      }
    })
  );

  const resolvedResults = results.map((r) => (r.status === 'fulfilled' ? r.value : r.reason));
  const okResults = resolvedResults.filter((r) => r.status === 'ok' && r.records.length > 0);

  let consensusIp = null;
  let agreeCount = 0;
  let totalCount = okResults.length;
  let differingResolvers = [];

  if (totalCount > 0) {
    const ipCounts = {};
    for (const r of okResults) {
      for (const ip of r.records) {
        ipCounts[ip] = (ipCounts[ip] || 0) + 1;
      }
    }
    const sorted = Object.entries(ipCounts).sort((a, b) => b[1] - a[1]);
    consensusIp = sorted[0]?.[0] || null;
    agreeCount = sorted[0]?.[1] || 0;

    for (const r of resolvedResults) {
      if (r.status === 'ok' && r.records.length > 0 && !r.records.includes(consensusIp)) {
        differingResolvers.push(r.name);
      }
    }
  }

  return {
    domain,
    type,
    timestamp: new Date().toISOString(),
    resolvers: resolvedResults,
    consensus: { ip: consensusIp, agreeCount, totalCount, differingResolvers },
  };
}

// ─── BGP Lookup (per-IP, RIPE Stat API) ───────────────────────────────────────
async function fetchBgpInfo(ip) {
  try {
    const networkInfo = await fetch(`https://stat.ripe.net/data/network-info/data.json?resource=${ip}`)
      .then((r) => r.json());

    const asn = networkInfo.data?.asns?.[0];
    let asnDetails = null;
    if (asn) {
      asnDetails = await fetch(`https://stat.ripe.net/data/as-overview/data.json?resource=${asn}`)
        .then((r) => r.json());
    }

    const routingHistory = await fetch(
      `https://stat.ripe.net/data/routing-history/data.json?resource=${ip}&max_results=5`
    ).then((r) => r.json());

    const prefix = networkInfo.data?.prefix;
    let rpkiStatus = 'unknown';
    if (prefix && asn) {
      try {
        const rpki = await fetch(
          `https://stat.ripe.net/data/rpki-validation/data.json?resource=${asn}&prefix=${prefix}`
        ).then((r) => r.json());
        rpkiStatus = rpki.data?.status || 'unknown';
      } catch (_) {}
    }

    let relatedPrefixes = [];
    if (asn) {
      try {
        const related = await fetch(
          `https://stat.ripe.net/data/announced-prefixes/data.json?resource=${asn}`
        ).then((r) => r.json());
        relatedPrefixes = (related.data?.prefixes || []).slice(0, 20).map((p) => ({
          prefix: p.prefix,
          ipCount: p.nr_addresses || 0,
          firstSeen: p.timelines?.[0]?.starttime || '',
        }));
      } catch (_) {}
    }

    return {
      ip,
      prefix: prefix || '—',
      origin_as: asn ? `AS${asn}` : '—',
      origin_as_name: asnDetails?.data?.holder || '—',
      rpki_status: rpkiStatus,
      peer_count: routingHistory.data?.length || 0,
      country: asnDetails?.data?.country || '—',
      registry: 'RIPE',
      prefixes_by_asn: relatedPrefixes,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    console.error('BGP lookup error:', err);
    throw new Error('Failed to retrieve BGP information');
  }
}

// ─── Create Main Window ───────────────────────────────────────────────────────
function createWindow() {
  nativeTheme.themeSource = 'dark';

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 860,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    backgroundColor: '#080E1A',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0D1626',
      symbolColor: '#94A3B8',
      height: 36,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    icon: path.join(__dirname, 'assets', 'icon.png'),
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    attachBrowserView();
    // Mulai RIS Live setelah window siap
    setTimeout(() => connectRisLive(), 2000);
  });

  mainWindow.on('resize', () => updateBrowserViewBounds());
  mainWindow.on('closed', () => {
    disconnectRisLive();
    mainWindow = null;
  });

  Menu.setApplicationMenu(null);
}

// ─── WebContentsView ──────────────────────────────────────────────────────────
function attachBrowserView() {
  const ses = session.fromPartition('persist:cdnbrowser', { cache: true });

  ses.webRequest.onResponseStarted({ urls: ['<all_urls>'] }, (details) => {
    const { url, ip } = details;
    if (!ip || !url) return;

    // Filter IP privat / lokal
    if (
      ip.startsWith('127.') ||
      ip === '::1' ||
      ip.startsWith('192.168.') ||
      ip.startsWith('10.') ||
      ip.startsWith('172.16.')
    )
      return;

    try {
      const domain = new URL(url).hostname;
      const isIPv6 = ip.includes(':');
      const resourceType = details.resourceType || 'other';

      mainWindow?.webContents.send('request-captured', {
        ip,
        domain,
        url,
        resourceType,
        isIPv6,
        timestamp: Date.now(),
      });
    } catch (_) {
      /* ignore invalid URLs */
    }
  });

  browserView = new WebContentsView({
    webPreferences: {
      session: ses,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.contentView.addChildView(browserView);
  updateBrowserViewBounds();

  const wc = browserView.webContents;

  wc.on('did-navigate', (_, url) => sendNavigated(url));
  wc.on('did-navigate-in-page', (_, url) => sendNavigated(url));
  wc.on('did-redirect-navigation', (_, url) => sendNavigated(url));

  wc.on('page-title-updated', (_, title) => {
    mainWindow?.webContents.send('page-title-updated', { title });
  });

  wc.on('did-start-loading', () => {
    mainWindow?.webContents.send('page-loading', { loading: true });
  });

  wc.on('did-stop-loading', () => {
    mainWindow?.webContents.send('page-loading', { loading: false });
    sendNavigated(wc.getURL());
  });

  wc.setWindowOpenHandler(({ url }) => {
    wc.loadURL(url);
    return { action: 'deny' };
  });

  wc.loadURL('https://www.google.com');
}

function sendNavigated(url) {
  if (url && url !== 'about:blank') {
    mainWindow?.webContents.send('browser-navigated', { url });
  }
}

function updateBrowserViewBounds() {
  if (!mainWindow || !browserView) return;
  if (isDraggingSidebar) {
    browserView.setBounds({ x: -9999, y: -9999, width: 0, height: 0 });
    return;
  }
  const { width, height } = mainWindow.getContentBounds();
  const top = TOOLBAR_HEIGHT;

  browserView.setBounds({
    x: 0,
    y: top,
    width: Math.max(0, width - monitorWidth),
    height: Math.max(0, height - top),
  });
}

// ─── IPC Handlers ─────────────────────────────────────────────────────────────

// Navigation
ipcMain.on('navigate', (_, { url }) => {
  if (!browserView) return;
  let target = url.trim();
  if (!target) return;

  if (!/^https?:\/\//i.test(target) && !target.startsWith('about:')) {
    if (target.includes('.') && !target.includes(' ')) {
      target = 'https://' + target;
    } else {
      target = `https://www.google.com/search?q=${encodeURIComponent(target)}`;
    }
  }
  browserView.webContents.loadURL(target);
});

ipcMain.on('navigate-back', () => {
  if (browserView?.webContents.navigationHistory.canGoBack())
    browserView.webContents.navigationHistory.goBack();
});
ipcMain.on('navigate-forward', () => {
  if (browserView?.webContents.navigationHistory.canGoForward())
    browserView.webContents.navigationHistory.goForward();
});
ipcMain.on('navigate-refresh', () => browserView?.webContents.reload());
ipcMain.on('navigate-stop', () => browserView?.webContents.stop());

ipcMain.on('open-devtools', () => {
  browserView?.webContents.openDevTools({ mode: 'detach' });
});

ipcMain.on('resize-start', () => {
  isDraggingSidebar = true;
  updateBrowserViewBounds();
});

ipcMain.on('resize-end', () => {
  isDraggingSidebar = false;
  updateBrowserViewBounds();
});

ipcMain.on('update-monitor-width', (_, width) => {
  monitorWidth = width;
  updateBrowserViewBounds();
});

// WHOIS
ipcMain.handle('whois-lookup', async (_, ip) => fetchWhois(ip));

// Traceroute
ipcMain.on('traceroute-start', (_, ip) => {
  if (activeTracerouteProcess) {
    activeTracerouteProcess.kill();
    activeTracerouteProcess = null;
  }

  const isWin = process.platform === 'win32';
  const cmd = isWin ? 'tracert' : 'traceroute';
  const args = isWin ? ['-d', '-h', '30', ip] : ['-q', '1', '-n', '-m', '30', ip];

  let buffer = '';
  const child = spawn(cmd, args);
  activeTracerouteProcess = child;

  child.stdout.on('data', (data) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      const parsed = parseTracerouteLine(line);
      if (parsed) mainWindow?.webContents.send('traceroute-hop', parsed);
    }
  });

  child.on('close', (code) => {
    mainWindow?.webContents.send('traceroute-done', { exitCode: code });
    activeTracerouteProcess = null;
  });

  child.on('error', (err) => {
    mainWindow?.webContents.send('traceroute-done', { error: err.message });
    activeTracerouteProcess = null;
  });
});

ipcMain.on('traceroute-stop', () => {
  if (activeTracerouteProcess) {
    activeTracerouteProcess.kill();
    activeTracerouteProcess = null;
    mainWindow?.webContents.send('traceroute-done', { exitCode: -1 });
  }
});

// ─── Monitored ASNs IPC (menggantikan ASN Database lama) ─────────────────────

ipcMain.handle('bgp:get-monitored-asns', () => {
  return monitoredAsns;
});

ipcMain.handle('bgp:set-monitored-asns', (_, asns) => {
  try {
    if (!Array.isArray(asns)) throw new Error('Invalid: expected array of ASNs');
    monitoredAsns = asns.filter((a) => /^AS\d+$/i.test(a)).map((a) => a.toUpperCase());
    saveMonitoredAsnsFile();

    // Reconnect RIS Live dengan ASN baru
    if (monitoredAsns.length > 0) {
      setTimeout(() => connectRisLive(), 500);
    } else {
      disconnectRisLive();
    }

    return { success: true };
  } catch (err) {
    console.error('[Monitored ASNs] Set error:', err.message);
    return { success: false, error: err.message };
  }
});

// ─── Ping Monitor IPC ─────────────────────────────────────────────────────────

ipcMain.handle('ping-start', (_, { target, interval = 1, count = 0 }) => {
  if (activePingProcess) {
    activePingProcess.kill();
    activePingProcess = null;
  }

  const isWin = process.platform === 'win32';
  let args;

  if (isWin) {
    args = ['-t', '-w', '5000', target];
    if (count > 0) {
      args = ['-n', count.toString(), '-w', '5000', target];
    }
  } else {
    args = ['-i', interval.toString(), '-W', '5', target];
    if (count > 0) {
      args = ['-i', interval.toString(), '-W', '5', '-c', count.toString(), target];
    }
  }

  const child = spawn('ping', args);
  activePingProcess = child;
  let seq = 0;
  let buffer = '';

  child.stdout.on('data', (data) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      const parsed = parsePingLine(line, isWin);
      if (parsed) {
        seq++;
        mainWindow?.webContents.send('ping-result', { seq, ...parsed });
      }
    }
  });

  child.stderr.on('data', (data) => {
    console.error('[Ping Error]', data.toString());
  });

  child.on('close', (code) => {
    mainWindow?.webContents.send('ping-done', { exitCode: code, seq });
    activePingProcess = null;
  });

  child.on('error', (err) => {
    mainWindow?.webContents.send('ping-done', { error: err.message, seq });
    activePingProcess = null;
  });

  return { success: true };
});

ipcMain.handle('ping-stop', () => {
  if (activePingProcess) {
    activePingProcess.kill();
    activePingProcess = null;
    mainWindow?.webContents.send('ping-done', { exitCode: -1 });
  }
  return { success: true };
});

// ─── DNS Propagation IPC ──────────────────────────────────────────────────────

ipcMain.handle('dns-propagation', async (_, { domain, type = 'A' }) => {
  try {
    return await checkDnsPropagation(domain, type);
  } catch (err) {
    return { error: err.message };
  }
});

// ─── BGP Lookup IPC (per-IP, RIPE Stat API) ───────────────────────────────────

ipcMain.handle('bgp-lookup', async (_, ip) => {
  try {
    return await fetchBgpInfo(ip);
  } catch (err) {
    return { error: err.message };
  }
});

// ─── Open Settings Window ─────────────────────────────────────────────────────

ipcMain.on('open-settings', () => {
  const settingsWin = new BrowserWindow({
    width: 520,
    height: 620,
    minWidth: 460,
    minHeight: 500,
    backgroundColor: '#080E1A',
    parent: mainWindow,
    modal: false,
    show: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0D1626',
      symbolColor: '#94A3B8',
      height: 32,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  settingsWin.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
  settingsWin.once('ready-to-show', () => {
    settingsWin.show();
    // Kirim status RIS Live saat settings window baru dibuka
    settingsWin.webContents.send('bgp:stream-status', { connected: risLiveConnected });
  });
});

// ─── Open AS Path Graph Window ──────────────────────────────────────────────────

let currentAspathData = [];
ipcMain.handle('get-aspath-data', () => currentAspathData);

ipcMain.on('open-aspath-graph', (_, streamLog) => {
  currentAspathData = streamLog || [];
  const graphWin = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#080E1A',
    parent: mainWindow,
    modal: false,
    show: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0D1626',
      symbolColor: '#94A3B8',
      height: 32,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  graphWin.loadFile(path.join(__dirname, 'renderer', 'aspath-window.html'));
  graphWin.once('ready-to-show', () => {
    graphWin.show();
    // Send the streamLog to the new window (fallback for old API)
    graphWin.webContents.send('aspath-data', streamLog);
  });
});

// ─── App Lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  disconnectRisLive();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});