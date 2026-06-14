'use strict';

// ─── AS Path Graph Visualization Module ──────────────────────────────────────
// Interactive graph visualization for BGP AS Path data with RIPEstat integration

const RIPESTAT_BASE = 'https://stat.ripe.net/data';
const MAX_CONCURRENT_REQUESTS = 4;
const ASN_CACHE = new Map(); // asn -> { name, country, holder, prefixes_v4, prefixes_v6 }
const API_QUEUE = [];
let activeRequests = 0;

// State
let modal = null;
let canvas = null;
let ctx = null;
let graphNodes = [];
let graphEdges = [];
let currentPaths = [];
let selectedPathIndex = 0;
let selectedNode = null;
let hoveredNode = null;
let graphPathData = []; // normalized paths for hover highlighting

// Transform state
let viewTransform = { x: 0, y: 0, scale: 1 };
let isDragging = false;
let isPanning = false;
let dragNode = null;
let dragStart = { x: 0, y: 0 };
let lastMouse = { x: 0, y: 0 };

// Animation
let animFrame = null;
let needsRender = true;

// Node colors
const COLORS = {
  monitored: '#4A8FE7',   // --accent
  origin: '#2DD4A0',      // --green
  peer: '#FBBF24',        // --orange
  transit: '#94A3B8',     // --text-secondary
  loop: '#F87171',        // --red
  edge: '#1A2744',        // --border
  edgeArrow: '#4A5C7A',   // --text-muted
  nodeBg: '#111C30',      // --bg-card
  nodeBorder: '#1E2D47',  // --border-light
  nodeText: '#E2E8F0',    // --text-primary
  highlight: '#4A8FE7',
};

// Node dimensions
const NODE_RADIUS = 30;
const NODE_PADDING_H = 110;
const NODE_PADDING_V = 80;
// Maximum nodes stacked vertically in one column before wrapping to a sub-column grid
const MAX_NODES_PER_COLUMN = 7;
// Horizontal gap between sub-columns within the same hop (grid overflow)
const GRID_SUB_COL_GAP = NODE_RADIUS * 2 + 30;

// ─── RIPEstat API ────────────────────────────────────────────────────────────

function enqueueRequest(url) {
  return new Promise((resolve, reject) => {
    API_QUEUE.push({ url, resolve, reject });
    processQueue();
  });
}

function processQueue() {
  while (activeRequests < MAX_CONCURRENT_REQUESTS && API_QUEUE.length > 0) {
    const { url, resolve, reject } = API_QUEUE.shift();
    activeRequests++;
    fetch(url)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(data => { activeRequests--; resolve(data); processQueue(); })
      .catch(err => { activeRequests--; reject(err); processQueue(); });
  }
}

async function fetchAsnInfo(asn) {
  if (ASN_CACHE.has(asn)) return ASN_CACHE.get(asn);

  const entry = { name: 'Unknown', country: '', holder: '', prefixes_v4: null, prefixes_v6: null };
  ASN_CACHE.set(asn, entry);

  try {
    const url = `${RIPESTAT_BASE}/as-overview/data.json?resource=${asn}&sourceapp=cdn-diagnostic`;
    const resp = await enqueueRequest(url);
    if (resp && resp.data) {
      entry.holder = resp.data.holder || '';
      entry.name = resp.data.holder || 'Unknown';
      // Try to get country from resource (often in holder response)
      if (resp.data.resource && resp.data.resource.country) {
        entry.country = resp.data.resource.country;
      }
    }
  } catch (_) { /* keep defaults */ }

  // Also fetch network-info for country if not set
  if (!entry.country) {
    try {
      const url2 = `${RIPESTAT_BASE}/network-info/data.json?resource=${asn}&sourceapp=cdn-diagnostic`;
      const resp2 = await enqueueRequest(url2);
      if (resp2 && resp2.data && resp2.data.asns && resp2.data.asns.length > 0) {
        const info = resp2.data.asns[0];
        if (info.country) entry.country = info.country;
        if (info.holder && !entry.holder) {
          entry.holder = info.holder;
          entry.name = info.holder;
        }
      }
    } catch (_) { /* keep defaults */ }
  }

  return entry;
}

async function fetchPrefixCount(asn) {
  try {
    const url = `${RIPESTAT_BASE}/prefix-count/data.json?resource=${asn}&sourceapp=cdn-diagnostic`;
    const resp = await enqueueRequest(url);
    if (resp && resp.data) {
      const v4 = resp.data.prefixes_v4 ? resp.data.prefixes_v4.count : null;
      const v6 = resp.data.prefixes_v6 ? resp.data.prefixes_v6.count : null;
      return { v4, v6 };
    }
  } catch (_) {}
  return { v4: null, v6: null };
}

async function fetchPrefixOverview(prefix) {
  try {
    const url = `${RIPESTAT_BASE}/prefix-overview/data.json?resource=${prefix}&sourceapp=cdn-diagnostic`;
    const resp = await enqueueRequest(url);
    if (resp && resp.data) return resp.data;
  } catch (_) {}
  return null;
}

async function fetchRpkiValidation(asn, prefix) {
  try {
    const url = `${RIPESTAT_BASE}/rpki-validation/data.json?resource=${asn}&prefix=${encodeURIComponent(prefix)}&sourceapp=cdn-diagnostic`;
    const resp = await enqueueRequest(url);
    if (resp && resp.data) return resp.data;
  } catch (_) {}
  return null;
}

async function fetchBgpUpdates(prefix) {
  try {
    const now = new Date().toISOString().replace(/\.\d+Z$/, '');
    const url = `${RIPESTAT_BASE}/bgp-updates/data.json?resource=${prefix}&endtime=${now}&sourceapp=cdn-diagnostic`;
    const resp = await enqueueRequest(url);
    if (resp && resp.data) return resp.data;
  } catch (_) {}
  return null;
}

// ─── Data Parsing ────────────────────────────────────────────────────────────

function parseAsPathTokens(pathStr) {
  // Handle multiple formats:
  // 1) Arrow-separated: "AS8218 → AS9002 → AS134654 → AS153327"
  // 2) Space-separated: "8218 9002 134654 153327"
  // 3) Mixed with braces (AS sets): "AS8218 {AS9002,AS9003} AS134654"
  if (!pathStr) return [];

  // Split by arrow or whitespace, then clean each token
  const tokens = pathStr
    .split(/\s*[→>]\s*|\s+/)
    .map(s => s.trim())
    .map(s => s.replace(/[\{\}]/g, ''))  // remove braces
    .filter(s => s && s !== '—' && s !== '-' && s !== '' && s !== '→' && s !== '>');

  // Normalize: ensure each token has "AS" prefix
  return tokens.map(s => {
    if (/^AS\d+$/i.test(s)) return s.toUpperCase();
    if (/^\d+$/.test(s)) return 'AS' + s;
    return s.toUpperCase();
  }).filter(s => /^AS\d+$/.test(s));  // only valid ASNs
}

function parseUniquePaths(streamLog) {
  const pathsMap = new Map();
  for (const event of streamLog) {
    if (!event.asPath || event.asPath === '—') continue;
    const pathStr = event.asPath.trim();
    if (!pathStr) continue;

    const asns = parseAsPathTokens(pathStr);
    if (asns.length === 0) continue;

    // Use normalized AS path as key to avoid duplicates
    const normalizedKey = asns.join(' ');
    if (!pathsMap.has(normalizedKey)) {
      pathsMap.set(normalizedKey, {
        raw: pathStr,
        asns,
        prefix: event.prefix || '',
        type: event.type,
        time: event.time,
      });
    }
  }
  return Array.from(pathsMap.values());
}

function getMonitoredAsns() {
  // Read from the BGP stream panel's monitored list
  let asns = [];
  if (window.bgpStreamPanel && window.bgpStreamPanel.getMonitoredAsns) {
    asns = window.bgpStreamPanel.getMonitoredAsns();
  } else {
    // Fallback: try reading from ASN chips
    const chips = document.querySelectorAll('.bgp-stream-asn-chip');
    asns = Array.from(chips).map(c => c.textContent.trim());
  }
  // Normalize: ensure all have "AS" prefix uppercase
  return asns.map(a => {
    const s = String(a).trim();
    if (/^AS\d+$/i.test(s)) return s.toUpperCase();
    if (/^\d+$/.test(s)) return 'AS' + s;
    return s.toUpperCase();
  });
}

// ─── Graph Building ──────────────────────────────────────────────────────────

function buildGraph(pathData) {
  const nodes = [];
  const edges = [];
  const asns = pathData.asns;
  const monitoredAsns = getMonitoredAsns();

  if (!asns || asns.length === 0) return { nodes, edges };

  // Detect loops
  const seen = new Map(); // asn -> first index
  const loopIndices = new Set();
  for (let i = 0; i < asns.length; i++) {
    const normalAsn = asns[i].toUpperCase();
    if (seen.has(normalAsn)) {
      loopIndices.add(i);
      loopIndices.add(seen.get(normalAsn));
    } else {
      seen.set(normalAsn, i);
    }
  }

  // Layout: horizontal chain
  // AS Path order: index 0 = Peer (source/upstream), last = Origin (destination/announced)
  // In BGP: path goes FROM peer TOWARD origin, showing upstream hierarchy
  const stepX = NODE_RADIUS * 2 + NODE_PADDING_H;
  const baseY = 200;

  for (let i = 0; i < asns.length; i++) {
    const asn = asns[i].toUpperCase();
    // Normalize for comparison
    const asnNorm = asn.startsWith('AS') ? asn : 'AS' + asn;

    // Determine role:
    // i=0 → Peer (upstream source that sent the update)
    // i=last → Origin (the ASN that originated the prefix)
    // monitored → override to 'monitored'
    // loop → override to 'loop'
    let role = 'transit';
    if (loopIndices.has(i)) {
      role = 'loop';
    } else if (monitoredAsns.includes(asnNorm)) {
      role = 'monitored';
    } else if (i === 0) {
      role = 'peer';
    } else if (i === asns.length - 1) {
      role = 'origin';
    }

    const x = NODE_PADDING_H + i * stepX;
    const y = baseY;

    nodes.push({
      asn: asnNorm,
      role,
      x,
      y,
      index: i,
      info: null, // will be filled async
      hovered: false,
      selected: false,
      hidden: false,
    });

    // Draw edge from previous node to this node
    // Direction: peer → transit → monitored → origin (upstream to downstream)
    if (i > 0) {
      edges.push({
        from: i - 1,
        to: i,
        label: i === 1 ? 'upstream' : '',
      });
    }
  }

  return { nodes, edges };
}

function loadPath(index) {
  if (index < 0 || index >= currentPaths.length) return;
  selectedPathIndex = index;
  const pathData = currentPaths[index];
  const { nodes, edges } = buildGraph(pathData);
  graphNodes = nodes;
  graphEdges = edges;
  selectedNode = null;
  hoveredNode = null;
  centerView();
  needsRender = true;
  renderDetailPlaceholder();

  // Update path info bar
  const infoBar = modal ? modal.querySelector('#aspath-path-info') : null;
  if (infoBar) {
    const prefix = pathData.prefix || '—';
    const hops = nodes.length;
    infoBar.textContent = `Prefix: ${prefix}  ·  ${hops} hop${hops !== 1 ? 's' : ''}  ·  ${pathData.type || 'UPDATE'}`;
    infoBar.style.display = '';
  }

  // Start fetching names async
  fetchAllNames();
}

function centerView() {
  if (!canvas || graphNodes.length === 0) return;
  const dpr = window.devicePixelRatio || 1;
  const canvasW = canvas.width / dpr;
  const canvasH = canvas.height / dpr;
  const pad = 100;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const n of graphNodes) {
    if (n.x - NODE_RADIUS < minX) minX = n.x - NODE_RADIUS;
    if (n.x + NODE_RADIUS > maxX) maxX = n.x + NODE_RADIUS;
    if (n.y - NODE_RADIUS - 30 < minY) minY = n.y - NODE_RADIUS - 30;
    if (n.y + NODE_RADIUS + 40 > maxY) maxY = n.y + NODE_RADIUS + 40;
  }

  const gw = Math.max(maxX - minX + pad * 2, 200);
  const gh = Math.max(maxY - minY + pad * 2, 200);
  const scaleX = (canvasW - 40) / gw;
  const scaleY = (canvasH - 40) / gh;
  viewTransform.scale = Math.max(0.15, Math.min(scaleX, scaleY, 1.5));

  viewTransform.x = (canvasW - gw * viewTransform.scale) / 2 - (minX - pad) * viewTransform.scale;
  viewTransform.y = (canvasH - gh * viewTransform.scale) / 2 - (minY - pad) * viewTransform.scale;
  needsRender = true;
}

async function fetchAllNames() {
  for (const node of graphNodes) {
    fetchAsnInfo(node.asn).then(info => {
      node.info = info;
      needsRender = true;
    });
  }
}

// ─── Canvas Rendering ────────────────────────────────────────────────────────

function setupCanvas() {
  if (!canvas) return;
  const parent = canvas.parentElement;
  const dpr = window.devicePixelRatio || 1;
  // Use getBoundingClientRect for accurate size
  const rect = parent.getBoundingClientRect();
  const w = Math.max(rect.width || parent.clientWidth, 400);
  const h = Math.max(rect.height || parent.clientHeight, 300);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  // Reset transform on new context
  ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  needsRender = true;
}

function renderGraph() {
  if (!ctx || !canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;
  const hasHighlight = hoveredNode !== null;

  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.translate(viewTransform.x, viewTransform.y);
  ctx.scale(viewTransform.scale, viewTransform.scale);

  // Draw non-highlighted edges first (behind), then highlighted on top
  for (const edge of graphEdges) {
    if (hasHighlight && edge.highlighted) continue;
    ctx.globalAlpha = hasHighlight ? 0.12 : 1.0;
    drawEdge(graphNodes[edge.from], graphNodes[edge.to], edge.priority || false, false);
  }
  if (hasHighlight) {
    for (const edge of graphEdges) {
      if (!edge.highlighted) continue;
      ctx.globalAlpha = 1.0;
      drawEdge(graphNodes[edge.from], graphNodes[edge.to], edge.priority || false, true);
    }
  }
  ctx.globalAlpha = 1.0;

  // Draw non-highlighted nodes first, then highlighted on top
  for (const node of graphNodes) {
    if (hasHighlight && node.highlighted) continue;
    ctx.globalAlpha = hasHighlight ? 0.15 : 1.0;
    drawNode(node, false);
  }
  if (hasHighlight) {
    for (const node of graphNodes) {
      if (!node.highlighted) continue;
      ctx.globalAlpha = 1.0;
      drawNode(node, true);
    }
  }
  ctx.globalAlpha = 1.0;

  ctx.restore();

  const zoomEl = (modal ? modal.querySelector('.aspath-zoom-info') : null) || document.querySelector('.aspath-zoom-info');
  if (zoomEl) {
    zoomEl.textContent = `${Math.round(viewTransform.scale * 100)}%`;
  }
}


function drawEdge(fromNode, toNode, isPriority, isHighlighted) {
  if (!fromNode || !toNode) return;
  if (fromNode.hidden || toNode.hidden) return;

  const x1 = fromNode.x + NODE_RADIUS;
  const y1 = fromNode.y;
  const x2 = toNode.x - NODE_RADIUS;
  const y2 = toNode.y;

  // Edge styling: priority = thick gold, highlighted = bright blue, normal = muted
  let lineWidth = 2;
  let strokeColor = '#3A5070';
  let arrowColor = '#4A6FA5';

  if (isPriority) {
    lineWidth = 4;
    strokeColor = isHighlighted ? '#FBBF24' : '#D97706';
    arrowColor = isHighlighted ? '#FBBF24' : '#D97706';
  }
  if (isHighlighted && !isPriority) {
    lineWidth = 2.5;
    strokeColor = '#60A5FA';
    arrowColor = '#60A5FA';
  }

  // Use Bezier curve when there's significant vertical offset (grid sub-columns)
  // so lines to overflow sub-columns don't overlap each other
  const stepY = NODE_RADIUS * 2 + 30;
  const dx = x2 - x1;
  const dy = Math.abs(y2 - y1);
  const useCurve = dy > stepY * 1.5 || (fromNode.gridCol > 0 || toNode.gridCol > 0);

  // Glow effect for priority edges
  ctx.save();
  if (isPriority) {
    ctx.shadowColor = '#FBBF2488';
    ctx.shadowBlur = 10;
  }
  ctx.beginPath();
  ctx.moveTo(x1, y1);

  if (useCurve) {
    // Cubic Bezier: control points pull the curve horizontally for a smooth S-curve
    const cpOff = Math.max(dx * 0.45, 40);
    ctx.bezierCurveTo(x1 + cpOff, y1, x2 - cpOff, y2, x2, y2);
  } else {
    ctx.lineTo(x2, y2);
  }
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = lineWidth;
  ctx.setLineDash([]);
  ctx.stroke();
  ctx.restore();

  // Arrow head: compute tangent direction at endpoint
  let angle;
  if (useCurve) {
    const cpOff = Math.max(dx * 0.45, 40);
    // Tangent at t=1 of cubic bezier: derivative = 3*(P3-P2)
    // P3 = (x2, y2), P2 = (x2 - cpOff, y2) => tangent = (cpOff, 0) → always horizontal at endpoint
    // Add a small Y component proportional to the vertical offset for a more natural arrow
    const tangentY = (y2 - y1) * 0.15;
    angle = Math.atan2(tangentY, cpOff);
  } else {
    angle = Math.atan2(y2 - y1, x2 - x1);
  }
  const arrowLen = isPriority ? 13 : 10;
  const arrowAngle = 0.4;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(
    x2 - arrowLen * Math.cos(angle - arrowAngle),
    y2 - arrowLen * Math.sin(angle - arrowAngle)
  );
  ctx.lineTo(
    x2 - arrowLen * Math.cos(angle + arrowAngle),
    y2 - arrowLen * Math.sin(angle + arrowAngle)
  );
  ctx.closePath();
  ctx.fillStyle = arrowColor;
  ctx.fill();
  ctx.restore();

  // Weight label on priority edges
  if (isPriority) {
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2 - 10;
    ctx.save();
    ctx.font = 'bold 9px Inter, sans-serif';
    ctx.fillStyle = '#FBBF24';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.restore();
  }
}

function bezierPoint(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
}


function drawNode(node, isHighlighted) {
  if (node.hidden) return;

  const x = node.x;
  const y = node.y;
  const r = NODE_RADIUS;
  const isSelected = node === selectedNode;
  const isHovered = node === hoveredNode;

  ctx.save();

  // Glow ring for selected / hovered / monitored / highlighted
  if (isSelected || isHovered || node.role === 'monitored' || isHighlighted) {
    const glowColor = isSelected
      ? COLORS.highlight
      : (node.role === 'monitored' ? COLORS.monitored : (isHighlighted ? '#60A5FA' : COLORS.highlight));
    ctx.beginPath();
    ctx.arc(x, y, r + 8, 0, Math.PI * 2);
    ctx.fillStyle = glowColor + '22';
    ctx.fill();
    ctx.strokeStyle = glowColor + '70';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Node circle background
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  // Gradient fill based on role
  const grad = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
  grad.addColorStop(0, '#1A2D4A');
  grad.addColorStop(1, '#0D1626');
  ctx.fillStyle = grad;
  ctx.fill();

  // Border color by role
  let borderColor = COLORS.nodeBorder;
  let borderWidth = isSelected ? 3 : 2;
  if (node.role === 'monitored') { borderColor = COLORS.monitored; borderWidth = 2.5; }
  else if (node.role === 'origin')  { borderColor = COLORS.origin; }
  else if (node.role === 'peer')    { borderColor = COLORS.peer; }
  else if (node.role === 'loop')    { borderColor = COLORS.loop; }

  ctx.strokeStyle = borderColor;
  ctx.lineWidth = borderWidth;
  ctx.stroke();

  // ASN label inside circle
  const label = node.asn.startsWith('AS') ? node.asn : 'AS' + node.asn;
  const fontSize = label.length > 8 ? 9 : (label.length > 6 ? 10 : 12);
  ctx.font = `700 ${fontSize}px 'JetBrains Mono', 'Courier New', monospace`;
  ctx.fillStyle = COLORS.nodeText;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x, y);

  // Role badge above node
  const roleLabels = { peer: 'PEER', origin: 'ORIGIN', monitored: 'MONITORED', transit: 'TRANSIT', loop: 'LOOP' };
  const roleCols  = { peer: COLORS.peer, origin: COLORS.origin, monitored: COLORS.monitored, transit: COLORS.transit, loop: COLORS.loop };
  const roleLabel = roleLabels[node.role] || 'TRANSIT';
  ctx.font = '600 8px Inter, sans-serif';
  ctx.fillStyle = roleCols[node.role] || COLORS.transit;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(roleLabel, x, y - r - 4);

  // Holder name below node
  const nameY = y + r + 14;
  if (node.info && node.info.name && node.info.name !== 'Unknown') {
    const name = node.info.name.length > 22 ? node.info.name.substring(0, 20) + '…' : node.info.name;
    ctx.font = '500 9px Inter, sans-serif';
    ctx.fillStyle = '#8A9BB8';
    ctx.textBaseline = 'top';
    ctx.fillText(name, x, nameY);
  } else if (!node.info) {
    // Show loading indicator
    ctx.font = '400 8px Inter, sans-serif';
    ctx.fillStyle = '#4A5C7A';
    ctx.textBaseline = 'top';
    ctx.fillText('loading…', x, nameY);
  }

  // Country code
  if (node.info && node.info.country) {
    ctx.font = '400 8px Inter, sans-serif';
    ctx.fillStyle = '#4A5C7A';
    ctx.textBaseline = 'top';
    ctx.fillText(node.info.country, x, nameY + 13);
  }

  // Hop index badge (small circle, bottom right)
  const hopX = x + r * 0.72;
  const hopY = y + r * 0.72;
  ctx.beginPath();
  ctx.arc(hopX, hopY, 8, 0, Math.PI * 2);
  ctx.fillStyle = '#0D1626';
  ctx.fill();
  ctx.strokeStyle = '#2A3D5A';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.font = '700 7px Inter, sans-serif';
  ctx.fillStyle = '#7A8EA8';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(node.index + 1), hopX, hopY);

  ctx.restore();
}

function requestRender() {
  if (animFrame) return;
  animFrame = requestAnimationFrame(() => {
    animFrame = null;
    if (needsRender) {
      renderGraph();
      needsRender = false;
    }
  });
}

// Render loop that runs while graph is active
let renderLoopId = null;
function startRenderLoop() {
  function loop() {
    if (!modal || modal.classList.contains('hidden')) return;
    if (needsRender) {
      renderGraph();
      needsRender = false;
    }
    renderLoopId = requestAnimationFrame(loop);
  }
  renderLoopId = requestAnimationFrame(loop);
}
function stopRenderLoop() {
  if (renderLoopId) {
    cancelAnimationFrame(renderLoopId);
    renderLoopId = null;
  }
}

// ─── Hit Testing ─────────────────────────────────────────────────────────────

function screenToGraph(sx, sy) {
  return {
    x: (sx - viewTransform.x) / viewTransform.scale,
    y: (sy - viewTransform.y) / viewTransform.scale,
  };
}

function hitTestNode(sx, sy) {
  const gp = screenToGraph(sx, sy);
  for (let i = graphNodes.length - 1; i >= 0; i--) {
    const n = graphNodes[i];
    const dx = gp.x - n.x;
    const dy = gp.y - n.y;
    if (dx * dx + dy * dy <= NODE_RADIUS * NODE_RADIUS) return n;
  }
  return null;
}

// ─── Tooltip ─────────────────────────────────────────────────────────────────

function showTooltip(node, clientX, clientY) {
  // Works in both modal mode and standalone mode
  const root = modal || document;
  const tooltip = root.querySelector ? root.querySelector('.aspath-tooltip') : document.querySelector('.aspath-tooltip');
  if (!tooltip) return;

  const asnLabel = node.asn.startsWith('AS') ? node.asn : 'AS' + node.asn;
  tooltip.querySelector('.aspath-tooltip-asn').textContent = asnLabel;

  if (node.info) {
    tooltip.querySelector('.aspath-tooltip-name').textContent = node.info.name || 'Unknown';
    tooltip.querySelector('.aspath-tooltip-country').textContent = node.info.country ? `Country: ${node.info.country}` : '';
    tooltip.querySelector('.aspath-tooltip-country').style.display = node.info.country ? '' : 'none';
  } else {
    tooltip.querySelector('.aspath-tooltip-name').textContent = 'Loading…';
    tooltip.querySelector('.aspath-tooltip-country').style.display = 'none';
  }

  // Position
  const pad = 12;
  let left = clientX + pad;
  let top = clientY - pad - 60;
  if (left + 250 > window.innerWidth) left = clientX - 250 - pad;
  if (top < 0) top = clientY + pad;
  tooltip.style.left = left + 'px';
  tooltip.style.top = top + 'px';
  tooltip.classList.add('visible');
}

function hideTooltip() {
  const root = modal || document;
  const tooltip = root.querySelector ? root.querySelector('.aspath-tooltip') : document.querySelector('.aspath-tooltip');
  if (tooltip) tooltip.classList.remove('visible');
}

// ─── Detail Panel ────────────────────────────────────────────────────────────

function renderDetailPlaceholder() {
  const root = modal || document;
  const content = root.querySelector ? root.querySelector('.aspath-detail-content') : null;
  if (!content) return;
  content.innerHTML = `
    <div class="aspath-detail-placeholder">
      <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" width="36" height="36">
        <circle cx="24" cy="24" r="18"/><path d="M24 14v10"/><circle cx="24" cy="30" r="1" fill="currentColor"/>
      </svg>
      <p>Click a node to view<br/>ASN details from RIPEstat</p>
    </div>`;
  // Update header
  const detailAsn = root.querySelector('.aspath-detail-asn');
  if (detailAsn) detailAsn.textContent = '—';
}

function showNodeDetail(node) {
  const root = modal || document;
  const content = root.querySelector('.aspath-detail-content');
  if (!content) return;

  const detailAsn = root.querySelector('.aspath-detail-asn');
  const asnLabel = node.asn.startsWith('AS') ? node.asn : 'AS' + node.asn;
  if (detailAsn) detailAsn.textContent = asnLabel;

  content.innerHTML = `
    <div class="aspath-detail-tabs-wrap">
      <div class="aspath-detail-tabs">
        <button class="aspath-detail-tab active" data-pane="overview">Overview</button>
        <button class="aspath-detail-tab" data-pane="prefixes">Prefix Info</button>
        <button class="aspath-detail-tab" data-pane="rpki">RPKI Status</button>
        <button class="aspath-detail-tab" data-pane="bgp">BGP Activity</button>
      </div>
    </div>
    <div class="aspath-detail-content-inner">
      <div class="aspath-detail-pane active" id="adp-overview">
        <div class="aspath-detail-loading"><div class="spinner"></div><span>Loading ASN info…</span></div>
      </div>
      <div class="aspath-detail-pane" id="adp-prefixes">
        <div class="aspath-detail-loading"><div class="spinner"></div><span>Loading prefix data…</span></div>
      </div>
      <div class="aspath-detail-pane" id="adp-rpki">
        <div class="aspath-detail-loading"><div class="spinner"></div><span>Click a prefix to validate RPKI</span></div>
      </div>
      <div class="aspath-detail-pane" id="adp-bgp">
        <div class="aspath-detail-loading"><div class="spinner"></div><span>Click a prefix to see BGP updates</span></div>
      </div>
    </div>`;

  // Tab switching
  const tabs = content.querySelectorAll('.aspath-detail-tab');
  const panes = content.querySelectorAll('.aspath-detail-pane');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      panes.forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const pane = content.querySelector(`#adp-${tab.dataset.pane}`);
      if (pane) pane.classList.add('active');
    });
  });

  // Fetch overview data
  loadOverviewTab(node);
  loadPrefixesTab(node);
}

async function loadOverviewTab(node) {
  const root = modal || document;
  const pane = root.querySelector('#adp-overview');
  if (!pane) return;

  const info = await fetchAsnInfo(node.asn);
  node.info = info;
  needsRender = true;

  const asnLabel = node.asn.startsWith('AS') ? node.asn : 'AS' + node.asn;
  pane.innerHTML = `
    <div class="aspath-field">
      <span class="aspath-field-label">AS Number</span>
      <span class="aspath-field-value"><code>${asnLabel}</code></span>
    </div>
    <div class="aspath-field">
      <span class="aspath-field-label">AS Name / Holder</span>
      <span class="aspath-field-value">${info.holder || info.name || 'Unknown'}</span>
    </div>
    <div class="aspath-field">
      <span class="aspath-field-label">Country</span>
      <span class="aspath-field-value">${info.country || '—'}</span>
    </div>
    <div class="aspath-field">
      <span class="aspath-field-label">Role in Path</span>
      <span class="aspath-field-value">${formatRole(node.role)}</span>
    </div>
    <div class="aspath-field">
      <span class="aspath-field-label">Position</span>
      <span class="aspath-field-value">Hop ${node.index + 1} of ${graphNodes.length}</span>
    </div>`;


  // Also fetch prefix count
  try {
    const pc = await fetchPrefixCount(node.asn);
    const pcField = document.createElement('div');
    pcField.className = 'aspath-field';
    pcField.innerHTML = `
      <span class="aspath-field-label">Announced Prefixes</span>
      <span class="aspath-field-value">${pc.v4 !== null ? pc.v4 + ' IPv4' : '—'} &middot; ${pc.v6 !== null ? pc.v6 + ' IPv6' : '—'}</span>`;
    pane.appendChild(pcField);
  } catch (_) {}

  // Fetch Whois
  try {
    const whoisContainer = document.createElement('div');
    whoisContainer.innerHTML = `<div class="aspath-field"><span class="aspath-field-label">WHOIS Record</span>
                                <span class="aspath-field-value" style="color: var(--text-muted); font-size: 11px;">Loading...</span></div>`;
    pane.appendChild(whoisContainer);
    
    const asnStr = node.asn.startsWith('AS') ? node.asn : 'AS' + node.asn;
    const url = `${RIPESTAT_BASE}/whois/data.json?resource=${asnStr}&sourceapp=cdn-diagnostic`;
    const resp = await enqueueRequest(url);
    
    if (resp && resp.data && resp.data.records && resp.data.records.length > 0) {
      // Find the main ASN record (usually the first one, or the one containing 'aut-num')
      let mainRecord = resp.data.records.find(r => r.some(line => line.key === 'aut-num')) || resp.data.records[0];
      
      // Extract specific keys
      const parsedData = {};
      mainRecord.forEach(line => {
        const key = line.key.toLowerCase();
        if (!parsedData[key]) parsedData[key] = [];
        parsedData[key].push(line.value);
      });

      const displayKeys = [
        { key: 'as-name', label: 'AS Name' },
        { key: 'descr', label: 'Description' },
        { key: 'admin-c', label: 'Admin Contact' },
        { key: 'tech-c', label: 'Tech Contact' },
        { key: 'mnt-by', label: 'Maintained By' },
        { key: 'created', label: 'Created' },
        { key: 'last-modified', label: 'Last Modified' },
        { key: 'source', label: 'Source Registry' }
      ];

      let whoisHtml = `<div style="margin-top: 15px; margin-bottom: 8px; font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;">WHOIS Information</div>`;
      
      let hasData = false;
      displayKeys.forEach(dk => {
        if (parsedData[dk.key]) {
          hasData = true;
          const valueStr = parsedData[dk.key].join('<br>');
          whoisHtml += `
            <div class="aspath-field" style="margin-bottom: 6px;">
              <span class="aspath-field-label" style="min-width: 100px;">${dk.label}</span>
              <span class="aspath-field-value" style="white-space: normal; line-height: 1.4;">${valueStr}</span>
            </div>`;
        }
      });

      if (hasData) {
        whoisContainer.innerHTML = whoisHtml;
      } else {
        whoisContainer.innerHTML = `<div class="aspath-field"><span class="aspath-field-label">WHOIS Record</span>
                                    <span class="aspath-field-value" style="color: var(--text-muted); font-size: 11px;">No readable fields found</span></div>`;
      }
    } else {
      whoisContainer.innerHTML = `<div class="aspath-field"><span class="aspath-field-label">WHOIS Record</span>
                                  <span class="aspath-field-value" style="color: var(--text-muted); font-size: 11px;">Not available</span></div>`;
    }
  } catch (_) {
    const whoisField = pane.querySelector('.aspath-field:last-child');
    if (whoisField) {
      whoisField.innerHTML = `<span class="aspath-field-label">WHOIS Record</span>
                              <span class="aspath-field-value" style="color: var(--text-muted); font-size: 11px;">Error loading WHOIS</span>`;
    }
  }

}


async function loadPrefixesTab(node) {
  const root = modal || document;
  const pane = root.querySelector('#adp-prefixes');
  if (!pane) return;

  // Get prefix from current path data
  let prefix = '';
  if (typeof selectedPrefix !== 'undefined' && selectedPrefix !== 'all') {
    prefix = selectedPrefix;
  }
  if (!prefix && currentPaths.length > 0) {
    const pathData = currentPaths[selectedPathIndex];
    if (pathData && pathData.prefix) prefix = pathData.prefix;
  }
  if (!prefix) {
    // Try to find prefix from any path that contains this ASN
    const found = currentPaths.find(p => p.asns.includes(node.asn));
    if (found) prefix = found.prefix;
  }
  if (!prefix) {
    pane.innerHTML = '<p style="color: var(--text-muted); font-size: 12px;">No prefix data available for this path.</p>';
    return;
  }
  try {
    const data = await fetchPrefixOverview(prefix);
    if (!data) {
      pane.innerHTML = '<p style="color: var(--text-muted); font-size: 12px;">Could not fetch prefix data.</p>';
      return;
    }

    let html = `
      <div class="aspath-field">
        <span class="aspath-field-label">Prefix</span>
        <span class="aspath-field-value"><code>${prefix}</code></span>
      </div>
      <div class="aspath-field">
        <span class="aspath-field-label">Announced</span>
        <span class="aspath-field-value">${data.announced ? 'Yes' : 'No'}</span>
      </div>`;

    if (data.asns && data.asns.length > 0) {
      html += `
      <div class="aspath-field">
        <span class="aspath-field-label">Announcing ASNs</span>
        <span class="aspath-field-value">${data.asns.map(a => '<code>AS' + a.asn + '</code>').join(', ')}</span>
      </div>`;
    }

    if (data.holders && data.holders.length > 0) {
      html += `
      <div class="aspath-field">
        <span class="aspath-field-label">Holders</span>
        <span class="aspath-field-value">${data.holders.join(', ')}</span>
      </div>`;
    }

    // Add RPKI validation link
    html += `
      <div style="margin-top: 12px;">
        <button class="aspath-btn aspath-btn-wide" onclick="window.asPathGraph._loadRpkiForPrefix('${prefix}')">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="12" height="12"><path d="M8 1l6 3v4c0 3.5-2.5 6.5-6 8-3.5-1.5-6-4.5-6-8V4l6-3z"/></svg>
          Check RPKI
        </button>
      </div>`;

    pane.innerHTML = html;

    // Store prefix for RPKI/BGP tabs
    pane.dataset.prefix = prefix;
  } catch (err) {
    pane.innerHTML = `<div class="aspath-detail-error">Error loading prefix data: ${err.message}</div>`;
  }
}

async function loadRpkiForPrefix(prefix) {
  const root = modal || document;
  const pane = root.querySelector('#adp-rpki');
  if (!pane) return;

  // Switch to RPKI tab
  const tabs = root.querySelectorAll('.aspath-detail-tab');
  const panes = root.querySelectorAll('.aspath-detail-pane');
  tabs.forEach(t => t.classList.remove('active'));
  panes.forEach(p => p.classList.remove('active'));
  const rpkiTab = root.querySelector('[data-pane="rpki"]');
  if (rpkiTab) rpkiTab.classList.add('active');
  pane.classList.add('active');

  pane.innerHTML = '<div class="aspath-detail-loading"><div class="spinner"></div><span>Validating RPKI…</span></div>';

  const asn = selectedNode ? selectedNode.asn : '';
  const cleanAsn = asn.replace(/^AS/i, '');

  try {
    const data = await fetchRpkiValidation(cleanAsn, prefix);
    if (!data) {
      pane.innerHTML = '<p style="color: var(--text-muted); font-size: 12px;">Could not fetch RPKI data.</p>';
      return;
    }

    const status = data.status || 'unknown';
    const badgeClass = status === 'valid' ? 'aspath-rpki-valid' : (status === 'invalid' ? 'aspath-rpki-invalid' : 'aspath-rpki-unknown');

    let html = `
      <div class="aspath-field">
        <span class="aspath-field-label">Validation Status</span>
        <span class="aspath-field-value"><span class="aspath-rpki-badge ${badgeClass}">${status.toUpperCase()}</span></span>
      </div>
      <div class="aspath-field">
        <span class="aspath-field-label">Prefix</span>
        <span class="aspath-field-value"><code>${prefix}</code></span>
      </div>
      <div class="aspath-field">
        <span class="aspath-field-label">ASN</span>
        <span class="aspath-field-value"><code>AS${cleanAsn}</code></span>
      </div>`;

    if (data.validating_roas && data.validating_roas.length > 0) {
      html += `<div class="aspath-field"><span class="aspath-field-label">Validating ROAs</span></div>`;
      html += `<table class="aspath-detail-table"><thead><tr><th>Origin</th><th>Max Length</th><th>Prefix</th></tr></thead><tbody>`;
      for (const roa of data.validating_roas) {
        html += `<tr><td>AS${roa.asn || roa.origin || '—'}</td><td>${roa.max_length || roa.maxLength || '—'}</td><td><code>${roa.prefix || '—'}</code></td></tr>`;
      }
      html += '</tbody></table>';
    }

    pane.innerHTML = html;
  } catch (err) {
    pane.innerHTML = `<div class="aspath-detail-error">Error: ${err.message}</div>`;
  }
}

async function loadBgpForPrefix(prefix) {
  const root = modal || document;
  const pane = root.querySelector('#adp-bgp');
  if (!pane) return;

  // Switch to BGP tab
  const tabs = root.querySelectorAll('.aspath-detail-tab');
  const panes = root.querySelectorAll('.aspath-detail-pane');
  tabs.forEach(t => t.classList.remove('active'));
  panes.forEach(p => p.classList.remove('active'));
  const bgpTab = root.querySelector('[data-pane="bgp"]');
  if (bgpTab) bgpTab.classList.add('active');
  pane.classList.add('active');

  pane.innerHTML = '<div class="aspath-detail-loading"><div class="spinner"></div><span>Loading BGP updates…</span></div>';

  try {
    const data = await fetchBgpUpdates(prefix);
    if (!data || !data.updates || data.updates.length === 0) {
      pane.innerHTML = '<p style="color: var(--text-muted); font-size: 12px;">No recent BGP updates found for this prefix.</p>';
      return;
    }

    let html = `
      <div class="aspath-field">
        <span class="aspath-field-label">Prefix</span>
        <span class="aspath-field-value"><code>${prefix}</code></span>
      </div>
      <div class="aspath-field">
        <span class="aspath-field-label">Total Updates</span>
        <span class="aspath-field-value">${data.updates.length}</span>
      </div>`;

    const updates = data.updates.slice(0, 20); // limit display
    html += `<table class="aspath-detail-table"><thead><tr><th>Time</th><th>Type</th><th>Peer</th><th>AS Path</th></tr></thead><tbody>`;
    for (const upd of updates) {
      const attrs = upd.attrs || {};
      const type = upd.type || '—';
      const peer = attrs.peer || upd.peer || '—';
      const path = attrs.path ? attrs.path.join(' ') : (upd.path || '—');
      const time = attrs.timestamp ? new Date(attrs.timestamp * 1000).toLocaleTimeString() : (upd.timestamp || '—');
      html += `<tr><td>${time}</td><td>${type}</td><td>AS${peer}</td><td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${path}">${path}</td></tr>`;
    }
    html += '</tbody></table>';

    if (data.updates.length > 20) {
      html += `<p style="color: var(--text-muted); font-size: 10px; margin-top: 6px;">Showing 20 of ${data.updates.length} updates</p>`;
    }

    pane.innerHTML = html;
  } catch (err) {
    pane.innerHTML = `<div class="aspath-detail-error">Error: ${err.message}</div>`;
  }
}

function formatRole(role) {
  switch (role) {
    case 'peer': return '<span style="color: var(--orange);">▲ Peer (Source)</span>';
    case 'origin': return '<span style="color: var(--green);">● Origin (Destination)</span>';
    case 'monitored': return '<span style="color: var(--accent);">◉ Monitored</span>';
    case 'loop': return '<span style="color: var(--red);">⚠ Loop Detected</span>';
    default: return '<span style="color: var(--text-secondary);">◆ Transit</span>';
  }
}

// ─── Search / Filter ─────────────────────────────────────────────────────────

function filterNodes(query) {
  if (!query) {
    graphNodes.forEach(n => n.hidden = false);
    needsRender = true;
    return;
  }
  const q = query.toLowerCase();
  graphNodes.forEach(n => {
    const match = n.asn.toLowerCase().includes(q) ||
      (n.info && n.info.name && n.info.name.toLowerCase().includes(q)) ||
      (n.info && n.info.country && n.info.country.toLowerCase().includes(q));
    n.hidden = !match;
  });
  needsRender = true;
}

// Note: drawNode already checks node.hidden internally

// ─── Zoom / Pan ──────────────────────────────────────────────────────────────

function zoomBy(delta, centerX, centerY) {
  const oldScale = viewTransform.scale;
  viewTransform.scale *= (1 + delta);
  viewTransform.scale = Math.max(0.2, Math.min(viewTransform.scale, 4));

  // Zoom toward center
  const ratio = viewTransform.scale / oldScale;
  viewTransform.x = centerX - (centerX - viewTransform.x) * ratio;
  viewTransform.y = centerY - (centerY - viewTransform.y) * ratio;

  needsRender = true;

  // Show zoom info briefly
  const zoomEl = modal ? modal.querySelector('.aspath-zoom-info') : null;
  if (zoomEl) {
    zoomEl.classList.add('visible');
    clearTimeout(zoomEl._hideTimer);
    zoomEl._hideTimer = setTimeout(() => zoomEl.classList.remove('visible'), 1200);
  }
}

// ─── Modal HTML ──────────────────────────────────────────────────────────────

function createModalHTML() {
  return `
    <div class="aspath-modal-overlay hidden" id="aspath-modal-overlay">
      <div class="aspath-modal">
        <!-- Header -->
        <div class="aspath-header">
          <div class="aspath-header-left">
            <span class="aspath-header-title">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 8h3l2-4 2 8 2-4h3"/></svg>
              AS Path Graph
            </span>
          </div>
          <div class="aspath-toolbar">
            <div class="aspath-search-wrap">
              <svg class="aspath-search-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="4"/><path d="M10 10l3.5 3.5"/></svg>
              <input type="text" class="aspath-search" id="aspath-search" placeholder="Search ASN…" />
            </div>
            <select class="aspath-path-select" id="aspath-path-select"></select>
            <div class="aspath-zoom-btns">
              <button class="aspath-btn" id="aspath-zoom-out" title="Zoom Out">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="8" x2="12" y2="8"/></svg>
              </button>
              <button class="aspath-btn" id="aspath-zoom-in" title="Zoom In">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="4" x2="8" y2="12"/><line x1="4" y1="8" x2="12" y2="8"/></svg>
              </button>
              <button class="aspath-btn aspath-btn-wide" id="aspath-zoom-reset" title="Reset View">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="1 4 1 1 4 1"/><path d="M5.5 11A6 6 0 1 1 2 8"/></svg>
                Reset
              </button>
            </div>
            <button class="aspath-refresh-btn" id="aspath-refresh" title="Refresh from current BGP data">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="1 4 1 7 4 7"/><path d="M3.51 13a8 8 0 1 0 .49-4.5"/></svg>
              Refresh
            </button>
          </div>
          <button class="aspath-close-btn" id="aspath-close" title="Close (Esc)">✕</button>
        </div>

        <!-- Body -->
        <div class="aspath-body">
          <!-- Graph Area -->
          <div class="aspath-graph-area" id="aspath-graph-area">
            <canvas class="aspath-canvas" id="aspath-canvas"></canvas>
            <div class="aspath-graph-empty" id="aspath-graph-empty">
              <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.2" width="48" height="48">
                <path d="M4 36l10-12 8 6 10-18 10 12"/>
                <circle cx="4" cy="36" r="2" fill="currentColor"/>
                <circle cx="44" cy="24" r="2" fill="currentColor"/>
              </svg>
              <p>No AS Path data available</p>
            </div>
            <div class="aspath-hop-guide" id="aspath-hop-guide">
              <span>PEER</span> → Transit → Transit → <span>ORIGIN</span>
              &nbsp;·&nbsp; upstream ke downstream
            </div>
            <div class="aspath-path-info" id="aspath-path-info" style="display:none;"></div>
            <div class="aspath-legend">
              <span class="aspath-legend-item"><span class="aspath-legend-dot" style="background: var(--accent);"></span> Monitored</span>
              <span class="aspath-legend-item"><span class="aspath-legend-dot" style="background: var(--orange);"></span> Peer</span>
              <span class="aspath-legend-item"><span class="aspath-legend-dot" style="background: var(--text-secondary);"></span> Transit</span>
              <span class="aspath-legend-item"><span class="aspath-legend-dot" style="background: var(--green);"></span> Origin</span>
              <span class="aspath-legend-item"><span class="aspath-legend-dot" style="background: var(--red);"></span> Loop</span>
              <span class="aspath-legend-item"><span class="aspath-legend-dot" style="background: #D97706; width: 16px; height: 4px; border-radius: 2px;"></span> Priority</span>
            </div>
            <div class="aspath-zoom-info">100%</div>
          </div>

          <!-- Detail Panel -->
          <div class="aspath-detail" id="aspath-detail">
            <div class="aspath-detail-header">
              <span class="aspath-detail-asn">—</span>
              <button class="aspath-detail-close" id="aspath-detail-close" title="Close detail panel">✕</button>
            </div>
            <div class="aspath-detail-content" id="aspath-detail-content">
              <div class="aspath-detail-placeholder">
                <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" width="36" height="36">
                  <circle cx="24" cy="24" r="18"/><path d="M24 14v10"/><circle cx="24" cy="30" r="1" fill="currentColor"/>
                </svg>
                <p>Click a node to view<br/>ASN details from RIPEstat</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Tooltip -->
        <div class="aspath-tooltip" id="aspath-tooltip">
          <div class="aspath-tooltip-asn"></div>
          <div class="aspath-tooltip-name"></div>
          <div class="aspath-tooltip-country"></div>
        </div>
      </div>
    </div>`;
}

// ─── Modal Open / Close ──────────────────────────────────────────────────────

function openModal() {
  if (!modal) {
    // Inject modal HTML
    const wrapper = document.createElement('div');
    wrapper.innerHTML = createModalHTML();
    document.body.appendChild(wrapper.firstElementChild);
    modal = document.getElementById('aspath-modal-overlay');
    bindModalEvents();
  }

  modal.classList.remove('hidden');

  // Get canvas AFTER showing modal (so it has dimensions)
  canvas = document.getElementById('aspath-canvas');

  // Setup canvas after a frame so layout is complete
  requestAnimationFrame(() => {
    setupCanvas();

    // Get current stream log from bgp stream panel
    const streamLog = window.bgpStreamPanel ? window.bgpStreamPanel.getLog() : [];
    currentPaths = parseUniquePaths(streamLog);

    console.log('[AS Path Graph] Parsed paths:', currentPaths.length, currentPaths.map(p => p.asns.join(' → ')));

    // Populate path selector
    const sel = document.getElementById('aspath-path-select');
    sel.innerHTML = '';
    if (currentPaths.length === 0) {
      sel.innerHTML = '<option>No paths available</option>';
      graphNodes = [];
      graphEdges = [];
      const emptyEl = document.getElementById('aspath-graph-empty');
      if (emptyEl) emptyEl.style.display = '';
      renderDetailPlaceholder();
    } else {
      currentPaths.forEach((p, i) => {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = `Path ${i + 1}: ${p.asns.slice(0, 4).join(' → ')}${p.asns.length > 4 ? ' → …' : ''} (${p.prefix || '—'})`;
        sel.appendChild(opt);
      });
      const emptyEl = document.getElementById('aspath-graph-empty');
      if (emptyEl) emptyEl.style.display = 'none';
      loadPath(0);
    }

    startRenderLoop();
  });

  // Escape key handler
  document.addEventListener('keydown', escHandler);
}

function closeModal() {
  if (modal) {
    modal.classList.add('hidden');
    stopRenderLoop();
  }
  document.removeEventListener('keydown', escHandler);
}

function escHandler(e) {
  if (e.key === 'Escape') closeModal();
}

// ─── Event Binding ───────────────────────────────────────────────────────────

function bindModalEvents() {
  const graphArea = document.getElementById('aspath-graph-area');
  const searchInput = document.getElementById('aspath-search');
  const pathSelect = document.getElementById('aspath-path-select');
  const closeBtn = document.getElementById('aspath-close');
  const detailCloseBtn = document.getElementById('aspath-detail-close');
  const zoomInBtn = document.getElementById('aspath-zoom-in');
  const zoomOutBtn = document.getElementById('aspath-zoom-out');
  const zoomResetBtn = document.getElementById('aspath-zoom-reset');
  const refreshBtn = document.getElementById('aspath-refresh');
  const detailPanel = document.getElementById('aspath-detail');

  // Close
  closeBtn.addEventListener('click', closeModal);

  // Detail panel close
  detailCloseBtn.addEventListener('click', () => {
    detailPanel.classList.toggle('collapsed');
    // Resize canvas after transition
    setTimeout(() => { setupCanvas(); centerView(); }, 300);
  });

  // Path select
  pathSelect.addEventListener('change', (e) => {
    loadPath(parseInt(e.target.value, 10));
  });

  // Search
  let searchTimer;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => filterNodes(e.target.value.trim()), 200);
  });

  // Zoom buttons
  zoomInBtn.addEventListener('click', () => {
    const rect = canvas.getBoundingClientRect();
    zoomBy(0.25, rect.width / 2, rect.height / 2);
  });
  zoomOutBtn.addEventListener('click', () => {
    const rect = canvas.getBoundingClientRect();
    zoomBy(-0.2, rect.width / 2, rect.height / 2);
  });
  zoomResetBtn.addEventListener('click', () => centerView());

  // Refresh
  refreshBtn.addEventListener('click', () => {
    const streamLog = window.bgpStreamPanel ? window.bgpStreamPanel.getLog() : [];
    currentPaths = parseUniquePaths(streamLog);
    const sel = document.getElementById('aspath-path-select');
    sel.innerHTML = '';
    if (currentPaths.length === 0) {
      sel.innerHTML = '<option>No paths available</option>';
      graphNodes = [];
      graphEdges = [];
      const emptyEl = document.getElementById('aspath-graph-empty');
      if (emptyEl) emptyEl.style.display = '';
    } else {
      const emptyEl = document.getElementById('aspath-graph-empty');
      if (emptyEl) emptyEl.style.display = 'none';
      currentPaths.forEach((p, i) => {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = `Path ${i + 1}: ${p.asns.slice(0, 4).join(' → ')}${p.asns.length > 4 ? ' → …' : ''} (${p.prefix || '—'})`;
        sel.appendChild(opt);
      });
      loadPath(0);
    }
  });

  // Mouse events on canvas
  graphArea.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const hit = hitTestNode(mx, my);
    if (hit) {
      // Start dragging node
      isDragging = true;
      dragNode = hit;
      dragStart = { x: e.clientX, y: e.clientY };
    } else {
      // Start panning
      isPanning = true;
      graphArea.classList.add('grabbing');
    }
    lastMouse = { x: e.clientX, y: e.clientY };
  });

  graphArea.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (isDragging && dragNode) {
      const dx = (e.clientX - lastMouse.x) / viewTransform.scale;
      const dy = (e.clientY - lastMouse.y) / viewTransform.scale;
      dragNode.x += dx;
      dragNode.y += dy;
      lastMouse = { x: e.clientX, y: e.clientY };
      needsRender = true;
      return;
    }

    if (isPanning) {
      const dx = e.clientX - lastMouse.x;
      const dy = e.clientY - lastMouse.y;
      viewTransform.x += dx;
      viewTransform.y += dy;
      lastMouse = { x: e.clientX, y: e.clientY };
      needsRender = true;
      return;
    }

    // Hover detection
    const hit = hitTestNode(mx, my);
    if (hit !== hoveredNode) {
      hoveredNode = hit;
      if (hit) {
        computeHighlightState(hit.asn);
        showTooltip(hit, e.clientX, e.clientY);
        canvas.style.cursor = 'pointer';
      } else {
        computeHighlightState(null);
        hideTooltip();
        canvas.style.cursor = 'grab';
      }
      needsRender = true;
    } else if (hit) {
      // Update tooltip position
      showTooltip(hit, e.clientX, e.clientY);
    }
  });

  window.addEventListener('mouseup', (e) => {
    if (isDragging && dragNode) {
      // If barely moved, treat as click
      const dist = Math.hypot(e.clientX - dragStart.x, e.clientY - dragStart.y);
      if (dist < 5) {
        selectNode(dragNode);
      }
    }
    isDragging = false;
    dragNode = null;
    isPanning = false;
    graphArea.classList.remove('grabbing');
  });

  graphArea.addEventListener('mouseleave', () => {
    hoveredNode = null;
    computeHighlightState(null);
    hideTooltip();
    needsRender = true;
  });

  // Mouse wheel zoom
  graphArea.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    zoomBy(delta, mx, my);
  }, { passive: false });

  // Window resize
  window.addEventListener('resize', () => {
    if (modal && !modal.classList.contains('hidden')) {
      setupCanvas();
      needsRender = true;
    }
  });
}

function selectNode(node) {
  if (selectedNode) selectedNode.selected = false;
  selectedNode = node;
  node.selected = true;
  needsRender = true;
  showNodeDetail(node);
}

// ─── Update Graph Button State ───────────────────────────────────────────────

function updateGraphButton() {
  const btn = document.getElementById('btn-aspath-graph');
  if (!btn) return;

  const streamLog = window.bgpStreamPanel ? window.bgpStreamPanel.getLog() : [];
  const hasPaths = streamLog.some(e => e.asPath && e.asPath !== '—' && e.asPath.trim().length > 0);

  btn.disabled = !hasPaths;
  btn.title = hasPaths ? 'Open AS Path Graph' : 'No AS Path data available';
}

// ─── Initialize ──────────────────────────────────────────────────────────────

function initAsPathGraph() {
  // Bind the button
  const btn = document.getElementById('btn-aspath-graph');
  if (btn) {
    btn.addEventListener('click', () => {
      if (!btn.disabled) openModal();
    });
  }

  // Periodically check button state
  setInterval(updateGraphButton, 2000);
  updateGraphButton();
}

// ─── Standalone Window Mode (aspath-window.html) ─────────────────────────────
// When running as a dedicated window, canvas is already in the DOM.
// Data arrives via IPC 'aspath-data' from main.js.

function initStandaloneWindow() {
  // Get elements directly from DOM (no modal overlay needed)
  canvas = document.getElementById('aspath-canvas');
  if (!canvas) { console.error('[AS Path Graph] Canvas not found!'); return; }

  // ctx will be set by setupCanvas
  const graphArea = document.getElementById('aspath-graph-area');
  const detailPanel = document.getElementById('aspath-detail');

  // Setup canvas immediately
  setupCanvas();

  // Bind zoom / pan / resize
  if (graphArea) {
    graphArea.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const hit = hitTestNode(mx, my);
      if (hit) {
        isDragging = true; dragNode = hit;
        dragStart = { x: e.clientX, y: e.clientY };
      } else {
        isPanning = true;
        graphArea.classList.add('grabbing');
      }
      lastMouse = { x: e.clientX, y: e.clientY };
    });

    graphArea.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      if (isDragging && dragNode) {
        dragNode.x += (e.clientX - lastMouse.x) / viewTransform.scale;
        dragNode.y += (e.clientY - lastMouse.y) / viewTransform.scale;
        lastMouse = { x: e.clientX, y: e.clientY };
        needsRender = true; return;
      }
      if (isPanning) {
        viewTransform.x += e.clientX - lastMouse.x;
        viewTransform.y += e.clientY - lastMouse.y;
        lastMouse = { x: e.clientX, y: e.clientY };
        needsRender = true; return;
      }
      const hit = hitTestNode(mx, my);
      if (hit !== hoveredNode) {
        hoveredNode = hit;
        if (hit) { computeHighlightState(hit.asn); showTooltip(hit, e.clientX, e.clientY); canvas.style.cursor = 'pointer'; }
        else { computeHighlightState(null); hideTooltip(); canvas.style.cursor = 'grab'; }
        needsRender = true;
      } else if (hit) {
        showTooltip(hit, e.clientX, e.clientY);
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (isDragging && dragNode) {
        const dist = Math.hypot(e.clientX - dragStart.x, e.clientY - dragStart.y);
        if (dist < 5) selectNodeStandalone(dragNode);
      }
      isDragging = false; dragNode = null; isPanning = false;
      graphArea.classList.remove('grabbing');
    });

    graphArea.addEventListener('mouseleave', () => {
      hoveredNode = null; computeHighlightState(null); hideTooltip(); needsRender = true;
    });

    graphArea.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      zoomBy(e.deltaY > 0 ? -0.1 : 0.1, e.clientX - rect.left, e.clientY - rect.top);
    }, { passive: false });
  }

  // Zoom buttons
  const zoomIn  = document.getElementById('aspath-zoom-in');
  const zoomOut = document.getElementById('aspath-zoom-out');
  const zoomReset = document.getElementById('aspath-zoom-reset');
  if (zoomIn)  zoomIn.addEventListener('click',  () => zoomBy(0.25, canvas.clientWidth/2, canvas.clientHeight/2));
  if (zoomOut) zoomOut.addEventListener('click', () => zoomBy(-0.2, canvas.clientWidth/2, canvas.clientHeight/2));
  if (zoomReset) zoomReset.addEventListener('click', () => centerView());

  // Detail close
  const detailClose = document.getElementById('aspath-detail-close');
  if (detailClose && detailPanel) {
    detailClose.addEventListener('click', () => {
      detailPanel.classList.toggle('collapsed');
      setTimeout(() => { setupCanvas(); centerView(); }, 300);
    });
  }

  // Search
  const searchInput = document.getElementById('aspath-search');
  if (searchInput) {
    let t;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(t);
      t = setTimeout(() => filterNodes(e.target.value.trim()), 200);
    });
  }

  // Prefix select filter
  const prefixSel = document.getElementById('aspath-prefix-select');
  if (prefixSel) {
    prefixSel.addEventListener('change', (e) => {
      selectedPrefix = e.target.value;
      buildAndShowPaths();
    });
  }

  // IPv4 / IPv6 tabs
  document.querySelectorAll('.aspath-tab[data-version]').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.aspath-tab[data-version]').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentVersionFilter = tab.dataset.version; // 'v4' or 'v6'
      buildAndShowPaths();
    });
  });

  // Resize
  window.addEventListener('resize', () => { setupCanvas(); needsRender = true; });

  // Start render loop
  function loop() {
    if (needsRender) { renderGraph(); needsRender = false; }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // Receive data from main process
  if (window.settingsAPI) {
    if (window.settingsAPI.getAspathData) {
      window.settingsAPI.getAspathData().then((streamLog) => {
        console.log('[AS Path Graph Window] Received streamLog via getAspathData:', streamLog ? streamLog.length : 0, 'events');
        loadStreamData(streamLog);
      });
    } else if (window.settingsAPI.onAspathData) {
      window.settingsAPI.onAspathData((streamLog) => {
        console.log('[AS Path Graph Window] Received streamLog via onAspathData:', streamLog ? streamLog.length : 0, 'events');
        loadStreamData(streamLog);
      });
    }
  } else {
    console.warn('[AS Path Graph Window] settingsAPI not available');
  }

  // Also get monitored ASNs
  if (window.settingsAPI && window.settingsAPI.getMonitoredAsns) {
    window.settingsAPI.getMonitoredAsns().then(asns => {
      standaloneMonitoredAsns = (asns || []).map(a => {
        const s = String(a).trim();
        if (/^AS\d+$/i.test(s)) return s.toUpperCase();
        if (/^\d+$/.test(s)) return 'AS' + s;
        return s.toUpperCase();
      });
      console.log('[AS Path Graph Window] Monitored ASNs:', standaloneMonitoredAsns);
    }).catch(() => {});
  }
}

// State for standalone mode
let standaloneStreamLog = [];
let standaloneMonitoredAsns = [];
let selectedPrefix = 'all';
let currentVersionFilter = 'v4';

function getMonitoredAsnsStandalone() {
  return standaloneMonitoredAsns;
}

function loadStreamData(streamLog) {
  standaloneStreamLog = streamLog || [];

  // Populate prefix filter
  populatePrefixSelect();

  // Build and display
  buildAndShowPaths();
}

function populatePrefixSelect() {
  const sel = document.getElementById('aspath-prefix-select');
  if (!sel) return;

  const prefixes = new Set();
  for (const ev of standaloneStreamLog) {
    if (ev.prefix && ev.prefix !== '—') {
      const isV6 = ev.prefix.includes(':');
      if (currentVersionFilter === 'v4' && isV6) continue;
      if (currentVersionFilter === 'v6' && !isV6) continue;
      prefixes.add(ev.prefix);
    }
  }

  // Keep 'All Prefixes' option
  sel.innerHTML = '<option value="all">All Prefixes</option>';
  for (const p of [...prefixes].sort()) {
    const opt = document.createElement('option');
    opt.value = p; opt.textContent = p;
    // Maintain selection if still valid
    if (p === selectedPrefix) opt.selected = true;
    sel.appendChild(opt);
  }
}

function buildAndShowPaths() {
  // Filter log by version and prefix
  const filtered = standaloneStreamLog.filter(ev => {
    if (!ev.asPath || ev.asPath === '—') return false;
    if (selectedPrefix !== 'all' && ev.prefix !== selectedPrefix) return false;
    if (currentVersionFilter === 'v4' && ev.prefix && ev.prefix.includes(':')) return false;
    if (currentVersionFilter === 'v6' && ev.prefix && !ev.prefix.includes(':')) return false;
    return true;
  });

  currentPaths = parseUniquePaths(filtered);
  console.log('[AS Path Graph] Filtered paths:', currentPaths.length, currentPaths.map(p => p.asns.join(' → ')));

  // Hide path selector as we now aggregate all paths
  const pathSel = document.getElementById('aspath-path-select');
  if (pathSel) pathSel.style.display = 'none';

  const emptyEl = document.getElementById('aspath-graph-empty');

  if (currentPaths.length === 0) {
    if (emptyEl) emptyEl.style.display = '';
    graphNodes = []; graphEdges = [];
    needsRender = true;
    renderDetailPlaceholderStandalone();
    return;
  }

  if (emptyEl) emptyEl.style.display = 'none';
  loadAggregatedGraphStandalone();
}

function loadAggregatedGraphStandalone() {
  const { nodes, edges } = buildAggregatedGraph(currentPaths);
  graphNodes = nodes;
  graphEdges = edges;
  selectedNode = null;
  hoveredNode = null;
  setupCanvas();
  centerView();
  needsRender = true;
  renderDetailPlaceholderStandalone();

  // Update path info bar if present
  const infoBar = document.getElementById('aspath-path-info');
  if (infoBar) {
    const priorityCount = edges.filter(e => e.priority).length;
    const priorityLabel = priorityCount > 0 ? `  ·  ${priorityCount} priority edges` : '';
    infoBar.textContent = `Aggregated: ${currentPaths.length} paths  ·  ${nodes.length} nodes${priorityLabel}  ·  Hover a node to trace paths`;
    infoBar.style.display = '';
  }

  fetchAllNames();
}

function buildAggregatedGraph(paths) {
  if (!paths || paths.length === 0) { graphPathData = []; return { nodes: [], edges: [] }; }

  const monitoredAsns = standaloneMonitoredAsns.length > 0
    ? standaloneMonitoredAsns
    : getMonitoredAsns();
  const primaryMonitored = monitoredAsns.length > 0 ? monitoredAsns[0] : null;

  // ── Step 1: Normalize all paths and collect edge weights ──────────────────
  const edgeWeightMap = new Map();
  const normalizedPaths = [];

  for (const p of paths) {
    const asns = p.asns.map(a => {
      const s = a.toUpperCase();
      return s.startsWith('AS') ? s : 'AS' + s;
    });
    normalizedPaths.push(asns);

    for (let i = 1; i < asns.length; i++) {
      if (asns[i - 1] === asns[i]) continue;
      const key = asns[i - 1] + '->' + asns[i];
      edgeWeightMap.set(key, (edgeWeightMap.get(key) || 0) + 1);
    }
  }

  // ── Step 2: Build adjacency maps (upstream/downstream) ──────────────────
  const downstreamMap = new Map();
  const upstreamMap = new Map();

  for (const asns of normalizedPaths) {
    for (let i = 0; i < asns.length; i++) {
      if (!downstreamMap.has(asns[i])) downstreamMap.set(asns[i], new Set());
      if (!upstreamMap.has(asns[i])) upstreamMap.set(asns[i], new Set());
      if (i > 0 && asns[i - 1] !== asns[i]) {
        downstreamMap.get(asns[i - 1]).add(asns[i]);
        upstreamMap.get(asns[i]).add(asns[i - 1]);
      }
    }
  }

  // ── Step 3: Assign layers relative to Monitored ASN ─────────────────────
  // Monitored ASN = Layer 0. Upstream (toward Peer) = negative layers (left).
  // Downstream (toward Origin) = positive layers (right).
  const layerMap = new Map();
  const allAsns = new Set();
  for (const asns of normalizedPaths) {
    for (const a of asns) allAsns.add(a);
  }

  const bfsQueue = [];
  for (const masn of monitoredAsns) {
    if (allAsns.has(masn)) {
      layerMap.set(masn, 0);
      bfsQueue.push(masn);
    }
  }

  // Fallback: if no monitored ASN in graph, use first ASN of first path
  if (bfsQueue.length === 0 && normalizedPaths.length > 0) {
    const fallback = normalizedPaths[0][0];
    layerMap.set(fallback, 0);
    bfsQueue.push(fallback);
  }

  let qi = 0;
  while (qi < bfsQueue.length) {
    const asn = bfsQueue[qi++];
    const curLayer = layerMap.get(asn);

    // Upstream neighbors → layer - 1 (left)
    const upstream = upstreamMap.get(asn) || new Set();
    for (const u of upstream) {
      const newLayer = curLayer - 1;
      if (!layerMap.has(u) || Math.abs(newLayer) < Math.abs(layerMap.get(u))) {
        layerMap.set(u, newLayer);
        bfsQueue.push(u);
      }
    }

    // Downstream neighbors → layer + 1 (right)
    const downstream = downstreamMap.get(asn) || new Set();
    for (const d of downstream) {
      const newLayer = curLayer + 1;
      if (!layerMap.has(d) || Math.abs(newLayer) < Math.abs(layerMap.get(d))) {
        layerMap.set(d, newLayer);
        bfsQueue.push(d);
      }
    }
  }

  // Handle disconnected nodes
  for (const asn of allAsns) {
    if (!layerMap.has(asn)) {
      let minDist = Infinity;
      for (const asns of normalizedPaths) {
        const idx = asns.indexOf(asn);
        if (idx !== -1 && asns.length > 1) {
          const dist = idx < asns.length / 2 ? -(asns.length / 2 - idx) : (idx - asns.length / 2);
          if (Math.abs(dist) < Math.abs(minDist)) minDist = Math.round(dist);
        }
      }
      layerMap.set(asn, isFinite(minDist) ? minDist : 0);
    }
  }

  // ── Step 4: Determine node roles ──────────────────────────────────────────
  const nodeMap = new Map();
  const loopAsns = new Set();
  for (const asns of normalizedPaths) {
    const seen = new Set();
    for (const a of asns) {
      if (seen.has(a)) loopAsns.add(a);
      seen.add(a);
    }
  }

  for (const asn of allAsns) {
    let role = 'transit';
    if (loopAsns.has(asn)) role = 'loop';
    else if (monitoredAsns.includes(asn)) role = 'monitored';
    else {
      // Check if this ASN is always first (peer) or always last (origin)
      let alwaysFirst = true, alwaysLast = true;
      for (const asns of normalizedPaths) {
        if (asns.includes(asn)) {
          if (asns[0] !== asn) alwaysFirst = false;
          if (asns[asns.length - 1] !== asn) alwaysLast = false;
        }
      }
      if (alwaysLast) role = 'origin';
      else if (alwaysFirst) role = 'peer';
    }
    nodeMap.set(asn, { asn, role, layer: layerMap.get(asn), info: null, hovered: false, selected: false, hidden: false });
  }

  // ── Step 5: Group into layers ─────────────────────────────────────────────
  const minLayer = Math.min(0, ...Array.from(layerMap.values()));
  const maxLayer = Math.max(0, ...Array.from(layerMap.values()));
  const layers = new Map();
  for (let l = minLayer; l <= maxLayer; l++) layers.set(l, []);

  for (const node of nodeMap.values()) {
    if (!layers.has(node.layer)) layers.set(node.layer, []);
    layers.get(node.layer).push(node);
  }

  // ── Step 6: Barycenter heuristic to minimize edge crossings ─────────────
  // Initial sort: by average position of connected nodes in adjacent layers
  for (let l = minLayer; l <= maxLayer; l++) {
    const layerNodes = layers.get(l);
    if (!layerNodes || layerNodes.length <= 1) continue;

    layerNodes.sort((a, b) => {
      const aConn = [...(upstreamMap.get(a.asn) || []), ...(downstreamMap.get(a.asn) || [])];
      const bConn = [...(upstreamMap.get(b.asn) || []), ...(downstreamMap.get(b.asn) || [])];
      return aConn.length - bConn.length || a.asn.localeCompare(b.asn);
    });
  }

  // Barycenter sweep (2 passes)
  for (let pass = 0; pass < 2; pass++) {
    // Forward sweep (left to right)
    for (let l = minLayer + 1; l <= maxLayer; l++) {
      const layerNodes = layers.get(l);
      if (!layerNodes || layerNodes.length <= 1) continue;
      const prevLayer = layers.get(l - 1) || [];

      layerNodes.sort((a, b) => {
        const aBary = computeBarycenter(a.asn, prevLayer, upstreamMap);
        const bBary = computeBarycenter(b.asn, prevLayer, upstreamMap);
        if (aBary !== null && bBary !== null) return aBary - bBary;
        if (aBary !== null) return -1;
        if (bBary !== null) return 1;
        return a.asn.localeCompare(b.asn);
      });
    }
    // Backward sweep (right to left)
    for (let l = maxLayer - 1; l >= minLayer; l--) {
      const layerNodes = layers.get(l);
      if (!layerNodes || layerNodes.length <= 1) continue;
      const nextLayer = layers.get(l + 1) || [];

      layerNodes.sort((a, b) => {
        const aBary = computeBarycenter(a.asn, nextLayer, downstreamMap);
        const bBary = computeBarycenter(b.asn, nextLayer, downstreamMap);
        if (aBary !== null && bBary !== null) return aBary - bBary;
        if (aBary !== null) return -1;
        if (bBary !== null) return 1;
        return a.asn.localeCompare(b.asn);
      });
    }
  }

  // ── Step 7: Assign coordinates (with grid wrapping for dense layers) ──────
  const stepX = NODE_RADIUS * 2 + NODE_PADDING_H + 60;
  const stepY = NODE_RADIUS * 2 + 30;
  let currentX = 600;
  const centerY = 400;

  const nodes = [];
  const asnToIndex = new Map();
  let nodeIdx = 0;

  for (let l = minLayer; l <= maxLayer; l++) {
    const layerNodes = layers.get(l) || [];
    if (layerNodes.length === 0) continue;

    const numCols = Math.ceil(layerNodes.length / MAX_NODES_PER_COLUMN);
    const totalSubColWidth = (numCols - 1) * GRID_SUB_COL_GAP;

    for (let i = 0; i < layerNodes.length; i++) {
      const node = layerNodes[i];
      // Grid wrapping: which sub-column and which row within that sub-column
      const gridCol = Math.floor(i / MAX_NODES_PER_COLUMN);
      const gridRow = i % MAX_NODES_PER_COLUMN;

      // Rows are centered vertically around centerY
      const totalRowsInThisCol = Math.min(MAX_NODES_PER_COLUMN, layerNodes.length - gridCol * MAX_NODES_PER_COLUMN);
      const colHeight = (totalRowsInThisCol - 1) * stepY;
      const colStartY = centerY - colHeight / 2;

      node.x = currentX + gridCol * GRID_SUB_COL_GAP;
      node.y = colStartY + gridRow * stepY;
      node.index = nodeIdx;
      node.gridCol = gridCol; // store for edge routing awareness
      asnToIndex.set(node.asn, nodeIdx);
      nodes.push(node);
      nodeIdx++;
    }

    // Advance currentX for the NEXT layer to prevent overlap
    currentX += totalSubColWidth + stepX;
  }

  // ── Step 8: Build final edges with path indices and weights ──────────────
  const edgeKeySet = new Set();
  const finalEdges = [];

  for (let pi = 0; pi < normalizedPaths.length; pi++) {
    const asns = normalizedPaths[pi];
    for (let i = 1; i < asns.length; i++) {
      if (asns[i - 1] === asns[i]) continue;
      const key = asns[i - 1] + '->' + asns[i];
      const fromIdx = asnToIndex.get(asns[i - 1]);
      const toIdx = asnToIndex.get(asns[i]);
      if (fromIdx === undefined || toIdx === undefined) continue;

      if (!edgeKeySet.has(key)) {
        edgeKeySet.add(key);
        finalEdges.push({
          from: fromIdx, to: toIdx,
          fromAsn: asns[i - 1], toAsn: asns[i],
          pathIndices: [pi],
          weight: edgeWeightMap.get(key) || 1,
          priority: false,
          highlighted: false,
        });
      } else {
        const edge = finalEdges.find(e => e.fromAsn === asns[i - 1] && e.toAsn === asns[i]);
        if (edge) edge.pathIndices.push(pi);
      }
    }
  }

  // ── Step 9: Detect priority (most frequent) path ─────────────────────────
  markPriorityPath(finalEdges, normalizedPaths);

  // Store paths data for hover highlighting
  graphPathData = normalizedPaths;

  return { nodes, edges: finalEdges };
}

// Barycenter helper: compute average index of connected nodes in adjacent layer
function computeBarycenter(asn, adjacentLayerNodes, adjacencyMap) {
  if (!adjacentLayerNodes || adjacentLayerNodes.length === 0) return null;
  const neighbors = adjacencyMap.get(asn) || new Set();
  let sum = 0, count = 0;
  for (let i = 0; i < adjacentLayerNodes.length; i++) {
    if (neighbors.has(adjacentLayerNodes[i].asn)) {
      sum += i;
      count++;
    }
  }
  return count > 0 ? sum / count : null;
}

// Find and mark the priority (most frequently used) path
function markPriorityPath(edges, normalizedPaths) {
  if (edges.length === 0 || normalizedPaths.length === 0) return;

  let bestPathIdx = -1;
  let bestScore = -1;

  for (let pi = 0; pi < normalizedPaths.length; pi++) {
    const asns = normalizedPaths[pi];
    let score = 0;
    let edgeCount = 0;
    for (let i = 1; i < asns.length; i++) {
      if (asns[i - 1] === asns[i]) continue;
      const edge = edges.find(e => e.fromAsn === asns[i - 1] && e.toAsn === asns[i]);
      if (edge) {
        score += edge.weight;
        edgeCount++;
      }
    }
    // Prefer paths with more edges and higher total weight
    const avgScore = edgeCount > 0 ? score / edgeCount : 0;
    if (avgScore > bestScore || (avgScore === bestScore && edgeCount > 0)) {
      bestScore = avgScore;
      bestPathIdx = pi;
    }
  }

  if (bestPathIdx >= 0) {
    const asns = normalizedPaths[bestPathIdx];
    for (let i = 1; i < asns.length; i++) {
      if (asns[i - 1] === asns[i]) continue;
      const edge = edges.find(e => e.fromAsn === asns[i - 1] && e.toAsn === asns[i]);
      if (edge) edge.priority = true;
    }
  }
}

// Compute highlight state for nodes and edges when hovering
function computeHighlightState(hoveredNodeAsn) {
  // Reset all
  for (const n of graphNodes) n.highlighted = false;
  for (const e of graphEdges) e.highlighted = false;

  if (!hoveredNodeAsn || !graphPathData) return;

  const highlightedPathIndices = new Set();
  for (let pi = 0; pi < graphPathData.length; pi++) {
    if (graphPathData[pi].includes(hoveredNodeAsn)) {
      highlightedPathIndices.add(pi);
    }
  }

  if (highlightedPathIndices.size === 0) return;

  // Highlight all nodes in matching paths
  for (const pi of highlightedPathIndices) {
    for (const asn of graphPathData[pi]) {
      const node = graphNodes.find(n => n.asn === asn);
      if (node) node.highlighted = true;
    }
  }

  // Highlight edges used by matching paths
  for (const edge of graphEdges) {
    if (edge.pathIndices) {
      for (const pi of edge.pathIndices) {
        if (highlightedPathIndices.has(pi)) {
          edge.highlighted = true;
          break;
        }
      }
    }
  }
}

function renderDetailPlaceholderStandalone() {
  const content = document.getElementById('aspath-detail-content');
  if (!content) return;
  content.innerHTML = `<div class="aspath-detail-placeholder">
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" width="36" height="36">
      <circle cx="24" cy="24" r="18"/><path d="M24 14v10"/><circle cx="24" cy="30" r="1" fill="currentColor"/>
    </svg>
    <p>Click a node to view<br/>ASN details from RIPEstat</p>
  </div>`;
  const detailAsn = document.getElementById('aspath-detail-asn') || document.querySelector('.aspath-detail-asn');
  if (detailAsn) detailAsn.textContent = '—';
}

function selectNodeStandalone(node) {
  if (selectedNode) selectedNode.selected = false;
  selectedNode = node;
  node.selected = true;
  needsRender = true;
  // Reuse showNodeDetail but with standalone modal reference
  const content = document.getElementById('aspath-detail-content');
  if (!content) return;
  const detailAsn = document.getElementById('aspath-detail-asn') || document.querySelector('.aspath-detail-asn');
  const asnLabel = node.asn.startsWith('AS') ? node.asn : 'AS' + node.asn;
  if (detailAsn) detailAsn.textContent = asnLabel;

  content.innerHTML = `
    <div class="aspath-detail-tabs-wrap">
      <div class="aspath-detail-tabs">
        <button class="aspath-detail-tab active" data-pane="overview">Overview</button>
        <button class="aspath-detail-tab" data-pane="prefixes">Prefix Info</button>
        <button class="aspath-detail-tab" data-pane="rpki">RPKI</button>
      </div>
    </div>
    <div class="aspath-detail-content-inner">
      <div class="aspath-detail-pane active" id="adp-overview">
        <div class="aspath-detail-loading"><div class="spinner"></div><span>Loading ASN info…</span></div>
      </div>
      <div class="aspath-detail-pane" id="adp-prefixes">
        <div class="aspath-detail-loading"><div class="spinner"></div><span>Loading prefix data…</span></div>
      </div>
      <div class="aspath-detail-pane" id="adp-rpki">
        <div class="aspath-detail-loading"><div class="spinner"></div><span>Click a prefix to validate RPKI</span></div>
      </div>
    </div>`;

  const tabs = content.querySelectorAll('.aspath-detail-tab');
  const panes = content.querySelectorAll('.aspath-detail-pane');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      panes.forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const pane = content.querySelector(`#adp-${tab.dataset.pane}`);
      if (pane) pane.classList.add('active');
    });
  });

  // Override modal ref temporarily to use document
  const prevModal = modal;
  modal = document;
  loadOverviewTab(node);
  loadPrefixesTab(node);
  modal = prevModal;
}

// Override showNodeDetail / tooltip for standalone (modal=null case)
function showTooltipStandalone(node, clientX, clientY) {
  const tooltip = document.getElementById('aspath-tooltip');
  if (!tooltip) return;
  const asnLabel = node.asn.startsWith('AS') ? node.asn : 'AS' + node.asn;
  tooltip.querySelector('.aspath-tooltip-asn').textContent = asnLabel;
  if (node.info) {
    tooltip.querySelector('.aspath-tooltip-name').textContent = node.info.name || 'Unknown';
    const countryEl = tooltip.querySelector('.aspath-tooltip-country');
    countryEl.textContent = node.info.country ? `Country: ${node.info.country}` : '';
    countryEl.style.display = node.info.country ? '' : 'none';
  } else {
    tooltip.querySelector('.aspath-tooltip-name').textContent = 'Loading…';
    tooltip.querySelector('.aspath-tooltip-country').style.display = 'none';
  }
  const pad = 12;
  let left = clientX + pad, top = clientY - pad - 60;
  if (left + 250 > window.innerWidth) left = clientX - 250 - pad;
  if (top < 0) top = clientY + pad;
  tooltip.style.left = left + 'px';
  tooltip.style.top = top + 'px';
  tooltip.classList.add('visible');
}

// ─── Public API ──────────────────────────────────────────────────────────────
if (typeof window !== 'undefined') {
  window.asPathGraph = {
    init: initAsPathGraph,
    open: openModal,
    close: closeModal,
    updateButton: updateGraphButton,
    _loadRpkiForPrefix: loadRpkiForPrefix,
    _loadBgpForPrefix: loadBgpForPrefix,
  };

  // ── Auto-detect standalone window mode ──────────────────────────────────────
  // If canvas already exists in DOM when script loads = standalone window mode
  document.addEventListener('DOMContentLoaded', () => {
    const standaloneCanvas = document.getElementById('aspath-canvas');
    const isStandaloneWindow = !!standaloneCanvas && !document.getElementById('aspath-modal-overlay');

    if (isStandaloneWindow) {
      console.log('[AS Path Graph] Standalone window mode detected');
      // Override tooltip/select functions for standalone
      initStandaloneWindow();
    }
  });
}
