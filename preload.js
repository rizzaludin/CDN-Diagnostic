'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// ─── Main Electron API ────────────────────────────────────────────────────────
contextBridge.exposeInMainWorld('electronAPI', {
  // Navigation
  navigate: (url) => ipcRenderer.send('navigate', { url }),
  goBack: () => ipcRenderer.send('navigate-back'),
  goForward: () => ipcRenderer.send('navigate-forward'),
  refresh: () => ipcRenderer.send('navigate-refresh'),
  stop: () => ipcRenderer.send('navigate-stop'),
  openDevTools: () => ipcRenderer.send('open-devtools'),

  // Sidebar resize — fix: monitor.js calls startResize/endResize
  startResize: () => ipcRenderer.send('resize-start'),
  endResize: () => ipcRenderer.send('resize-end'),
  updateMonitorWidth: (width) => ipcRenderer.send('update-monitor-width', width),

  // WHOIS
  whoisLookup: (ip) => ipcRenderer.invoke('whois-lookup', ip),

  // Traceroute
  tracerouteStart: (ip) => ipcRenderer.send('traceroute-start', ip),
  tracerouteStop: () => ipcRenderer.send('traceroute-stop'),
  onTracerouteHop: (cb) => {
    ipcRenderer.on('traceroute-hop', (_, hop) => cb(hop));
  },
  onTracerouteDone: (cb) => {
    ipcRenderer.on('traceroute-done', (_, data) => cb(data));
  },

  // Request capture (IP monitor)
  onRequestCaptured: (cb) => {
    ipcRenderer.on('request-captured', (_, data) => cb(data));
  },

  // Browser navigation events — fix: monitor.js calls onNavigated
  onNavigated: (cb) => {
    ipcRenderer.on('browser-navigated', (_, data) => cb(data));
  },
  onPageTitle: (cb) => {
    ipcRenderer.on('page-title-updated', (_, data) => cb(data));
  },
  onPageLoading: (cb) => {
    ipcRenderer.on('page-loading', (_, data) => cb(data));
  },

  // Ping Monitor
  pingStart: (target, interval, count) =>
    ipcRenderer.invoke('ping-start', { target, interval, count }),
  pingStop: () => ipcRenderer.invoke('ping-stop'),
  onPingResult: (cb) => {
    ipcRenderer.on('ping-result', (_, data) => cb(data));
  },
  onPingDone: (cb) => {
    ipcRenderer.on('ping-done', (_, data) => cb(data));
  },

  // DNS Propagation
  dnsPropagation: (domain, type) =>
    ipcRenderer.invoke('dns-propagation', { domain, type }),

  // BGP Lookup (per-IP, RIPE Stat API)
  bgpLookup: (ip) => ipcRenderer.invoke('bgp-lookup', ip),
});

// ─── Settings API ─────────────────────────────────────────────────────────────
contextBridge.exposeInMainWorld('settingsAPI', {
  // Settings window
  openSettings: () => ipcRenderer.send('open-settings'),

  // Monitored ASNs (RIS Live)
  getMonitoredAsns: () => ipcRenderer.invoke('bgp:get-monitored-asns'),
  setMonitoredAsns: (asns) => ipcRenderer.invoke('bgp:set-monitored-asns', asns),

  // BGP Stream events
  onBgpStreamUpdate: (cb) => {
    ipcRenderer.on('bgp:stream-update', (_, data) => cb(data));
  },
  onBgpStreamStatus: (cb) => {
    ipcRenderer.on('bgp:stream-status', (_, data) => cb(data));
  },
  
  // AS Path Graph
  openAspathGraph: (streamLog) => ipcRenderer.send('open-aspath-graph', streamLog),
  getAspathData: () => ipcRenderer.invoke('get-aspath-data'),
  onAspathData: (cb) => {
    ipcRenderer.on('aspath-data', (_, data) => cb(data));
  },
});