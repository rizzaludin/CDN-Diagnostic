# 🌐 CDN Diagnostic Browser

**Real-time Network Monitoring & CDN Diagnostic Tool for NOC Engineers**

A desktop application built with Electron that provides comprehensive network diagnostic capabilities including real-time IP monitoring, CDN identification, BGP streaming, DNS propagation checking, latency measurement, and traceroute visualization.

> **Version:** 1.0.0  
> **Platform:** Windows (x64)  
> **License:** MIT

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Key Features](#-key-features)
- [System Architecture](#-system-architecture)
- [Installation](#-installation)
- [Getting Started](#-getting-started)
- [Feature Guide](#-feature-guide)
  - [Browser & Network Monitor](#1-browser--network-monitor)
  - [CDN/ASN Identification](#2-cdnasn-identification)
  - [WHOIS Lookup](#3-whois-lookup)
  - [Traceroute](#4-traceroute)
  - [DNS Propagation Checker](#5-dns-propagation-checker)
  - [Ping Monitor](#6-ping-monitor)
  - [BGP Route Information](#7-bgp-route-information)
  - [BGP Stream Monitor](#8-bgp-stream-monitor)
  - [AS Path Graph](#9-as-path-graph)
  - [Settings & ASN Management](#10-settings--asn-management)
- [Keyboard Shortcuts](#-keyboard-shortcuts)
- [Export & Data](#-export--data)
- [Building & Development](#-building--development)
- [Technology Stack](#-technology-stack)
- [Data Sources](#-data-sources)

---

## 🎯 Overview

CDN Diagnostic Browser is a specialized network diagnostic tool designed for **NOC (Network Operations Center) engineers** and network professionals. It combines a built-in Chromium-based browser with a powerful real-time network monitoring panel that captures and analyzes all network traffic as you browse.

### What Makes It Different?

| Feature | Traditional Tools | CDN Diagnostic Browser |
|---|---|---|
| IP Monitoring | Manual, one-at-a-time | Automatic capture of ALL IPs while browsing |
| CDN Identification | Requires separate lookups | Instant visual badges for 20+ CDN providers |
| BGP Monitoring | Command-line only | Real-time WebSocket streaming with visual UI |
| DNS Propagation | Check each resolver manually | One-click check across 6 global resolvers |
| Ping & Latency | Terminal-based | Interactive charts with statistics |

---

## ✨ Key Features

### 🔍 Real-time IP & Network Monitoring
- Automatically captures **all IP addresses** (IPv4 & IPv6) from every page resource
- Displays domain-to-IP mapping in real-time
- Tracks request count and resource types (video, image, API, script, CSS, font, HTML)
- Visual traffic activity indicators with pulsing animations

### 🏷️ CDN/ASN Brand Identification
- Built-in database of **20+ CDN and cloud providers** including:
  - Cloudflare, Akamai, Fastly, Google/GGC, AWS CloudFront
  - Microsoft Azure, Meta/Facebook, Alibaba Cloud, CDN77, EdgeNext
  - Indonesian ISPs: Telkom, Biznet, XL Axiata, Indosat
- Automatic ASN lookup via WHOIS with color-coded brand badges
- Custom ASN monitoring list support

### 🌍 DNS Propagation Checker
- Check DNS resolution across **6 global resolvers**: Google, Cloudflare, Quad9, OpenDNS, AdGuard, AlterVista
- Supports record types: A, AAAA, CNAME, NS, MX, TXT
- Consensus view showing propagation status
- Available from toolbar (standalone modal) and detail panel

### 📊 Ping Monitor
- Continuous ICMP ping with configurable intervals (0.5s, 1s, 2s, 5s)
- **Real-time latency chart** (Canvas-based, last 60 data points)
- Comprehensive statistics: Sent, Received, Loss %, Min, Max, Avg, Jitter
- Color-coded status indicators: 🟢 Normal, 🟡 Warning, 🔴 Critical
- Configurable alert threshold in milliseconds

### 🔎 WHOIS Lookup
- Instant WHOIS data for any captured IP
- Displays: Organization, AS Number, Country, CIDR Range
- Results cached for performance

### 🛤️ Traceroute
- Visual hop-by-hop traceroute to any IP address
- Real-time progress display with RTT (Round Trip Time)
- Start/Stop controls with status indicators

### 📡 BGP Route Information
- Per-IP BGP lookup using RIPE Stat API
- Displays origin AS, prefix, and routing information

### 📈 BGP Stream Monitor (Real-time)
- **WebSocket streaming** from RIS Live (RIPE NCC)
- Monitors BGP UPDATE and WITHDRAW events for configured ASNs
- Displays: timestamp, event type, prefix, peer ASN, AS path
- Connection status indicator
- AS Path Graph visualization

### 🗺️ AS Path Graph
- Visual graph of AS path relationships from BGP stream data
- Interactive node-based visualization
- Helps understand routing topology

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Electron Main Process                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────┐ │
│  │ Browser   │  │ WHOIS    │  │ Ping     │  │ BGP Stream  │ │
│  │ Window    │  │ Lookup   │  │ Monitor  │  │ (WebSocket) │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └──────┬──────┘ │
│       │              │              │               │        │
│       │    ┌─────────┴──────────────┴───────────────┘        │
│       │    │           IPC Bridge (Preload)                   │
│       │    └─────────┬──────────────┬───────────────┐        │
└───────┼──────────────┼──────────────┼───────────────┼────────┘
        │              │              │               │
┌───────┴──────────────┴──────────────┴───────────────┴────────┐
│                   Renderer Process (UI)                        │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │ Browser Pane  │  │ Network      │  │ BGP Stream Panel   │  │
│  │ (Chromium)    │  │ Monitor      │  │                    │  │
│  └──────────────┘  └──────────────┘  └────────────────────┘  │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │ Ping Chart   │  │ DNS Panel    │  │ AS Path Graph      │  │
│  └──────────────┘  └──────────────┘  └────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

---

## 📦 Installation

### Prerequisites

- **Node.js** (v16 or higher)
- **npm** (v8 or higher)
- **Windows 10/11** (x64)

### Install Dependencies

```bash
cd electron-app
npm install
```

### Run in Development Mode

```bash
npm start
```

### Build for Distribution

```bash
# Build Windows installer (NSIS)
npm run build

# Build unpacked directory
npm run pack
```

The built application will be in the `dist/` directory.

---

## 🚀 Getting Started

### Quick Start Guide

1. **Launch the application**
   ```bash
   cd electron-app
   npm start
   ```

2. **Browse a website** — Enter any URL in the address bar and press Enter

3. **Watch the Network Monitor** — All IPs will appear in the right panel automatically

4. **Click on any IP** to see detailed information (WHOIS, Traceroute, DNS, Ping, BGP)

5. **Configure ASN monitoring** — Go to Settings (⚙️) and add ASNs for BGP streaming

### First-Time Setup

1. Click the **⚙️ Settings** button in the toolbar
2. In the **Monitoring ASN** tab, add ASNs you want to monitor
   - Example: `AS7713` (Telkom Indonesia), `AS13335` (Cloudflare)
3. Click **Simpan & Reconnect** to start BGP streaming
4. The **BGP Stream** tab will show real-time BGP events for your monitored ASNs

---

## 📖 Feature Guide

### 1. Browser & Network Monitor

The left pane is a full Chromium-based browser. As you navigate websites, the right panel automatically captures and displays all network connections.

**IP Table columns:**
- **Type Badge**: IPv4 (v4) or IPv6 (v6) indicator
- **Domain**: The domain name making the request
- **IP Address**: Resolved IP with request count
- **CDN Badge**: Identified CDN provider (if applicable)
- **Traffic Tag**: Resource type indicator (Video, Image, API, Script, CSS, Font, HTML)

**Resource Type Indicators:**
| Icon | Label | Description |
|------|-------|-------------|
| 🎥 | Video / Buffering | Media/video resources |
| 🖼️ | Image | Image resources |
| ⚡ | API / Data | XHR, Fetch, WebSocket, Ping |
| ⚙️ | Script | JavaScript files |
| 🎨 | CSS / Style | Stylesheets |
| 🔤 | Font | Web fonts |
| 📄 | HTML / Page | Document/main frame |
| 📦 | Other | Other resource types |

### 2. CDN/ASN Identification

The application automatically identifies CDN providers based on ASN data:

| CDN Provider | ASN(s) | Badge Color |
|---|---|---|
| Cloudflare | AS13335, AS209242 | 🟠 Orange |
| Akamai | AS209240, AS16625 | 🔵 Blue |
| Fastly | AS54113 | 🔴 Red |
| Google/GGC | AS15169, AS396982, AS19527 | 🔵 Blue |
| Meta/Facebook | AS32934 | 🔵 Blue |
| Microsoft/Azure | AS8075 | 🔵 Cyan |
| AWS CloudFront | AS16509, AS14618 | 🟠 Orange |
| Alibaba Cloud | AS45102 | 🟠 Orange |
| CDN77 | AS60068 | 🟢 Green |
| Telkom Indonesia | AS7713, AS17995 | 🟠 Red-Orange |
| Biznet | AS17451 | 🟢 Green |
| XL Axiata | AS23693 | 🔵 Blue |
| Indosat | AS4761 | 🟡 Yellow |
| Limelight/Edgio | AS22822 | 🟣 Purple |
| EdgeNext | AS139327 | 🔵 Cyan |

Custom ASNs added via Settings are also displayed with a purple badge.

### 3. WHOIS Lookup

Click any IP address in the network monitor to view WHOIS information:

- **IP Address**: The queried IP
- **Organization**: Registered organization name
- **AS Number**: Autonomous System Number
- **Country**: Country code
- **CIDR Range**: Network range

WHOIS data is cached per session for performance.

### 4. Traceroute

1. Select an IP from the network monitor
2. Click the **Traceroute** tab (or the traceroute icon on the row)
3. Click **Start Traceroute**
4. View hop-by-hop results with IP addresses and RTT values
5. Click **Stop** to abort at any time

### 5. DNS Propagation Checker

**From Toolbar (Global):**
1. Click the 🌐 button in the toolbar
2. Enter a domain name
3. Select record type (A, AAAA, CNAME, NS, MX, TXT, ALL)
4. Click **Check**
5. View results from 6 resolvers with consensus view

**From Detail Panel:**
1. Select an IP from the network monitor
2. Click the **DNS** tab
3. The domain is auto-filled from the selected IP
4. Select record type and click **Check DNS**

### 6. Ping Monitor

1. Select an IP from the network monitor
2. Click the **Ping** tab
3. Configure settings:
   - **Target**: IP or domain (auto-filled)
   - **Interval**: 0.5s, 1s, 2s, or 5s
   - **Threshold**: Alert threshold in milliseconds (default: 100ms)
4. Click **Start**
5. View real-time chart and statistics:
   - Sent/Received counts
   - Packet loss percentage
   - Min/Max/Avg latency
   - Jitter
   - Last response time
6. Click **Stop** to end monitoring

### 7. BGP Route Information

1. Select an IP from the network monitor
2. Click the **BGP** tab
3. View BGP routing data fetched from RIPE Stat API:
   - Origin AS
   - Announced prefix
   - AS path information

### 8. BGP Stream Monitor

The BGP Stream tab provides real-time monitoring of BGP routing events using WebSocket connection to RIS Live (RIPE NCC).

**Setup:**
1. Go to Settings → Monitoring ASN
2. Add ASNs to monitor (e.g., `AS7713`, `AS13335`)
3. Click **Simpan & Reconnect**

**Features:**
- Real-time UPDATE and WITHDRAW event display
- Connection status indicator (green dot = connected)
- Event table showing: Time, Type, Prefix, Peer ASN, AS Path
- Clear log button
- AS Path Graph button (opens visualization window)

### 9. AS Path Graph

Visualizes AS path relationships from collected BGP stream data:
- Interactive node-based graph
- Shows relationships between autonomous systems
- Helps understand routing topology and path diversity

### 10. Settings & ASN Management

Access via the ⚙️ button in the toolbar.

**Monitoring ASN Tab:**
- Add ASNs in format `AS` + number (e.g., `AS7713`)
- View all monitored ASNs as chips
- Remove ASNs by clicking the ✕ on each chip
- Save and reconnect to apply changes

**About Tab:**
- Application version and description
- Feature list
- Data source information

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Enter` | Navigate to URL in address bar |
| `Alt + ←` | Browser back |
| `Alt + →` | Browser forward |
| `F5` | Refresh page |
| `Ctrl + L` | Focus address bar |
| `Ctrl + B` | Toggle Network Monitor sidebar |
| `Ctrl + Shift + I` | Toggle Developer Tools |
| `Escape` | Cancel / Close modal |

---

## 📤 Export & Data

### Export IP List as JSON

Click the **Export** button (📥) in the Network Monitor header to download a JSON file containing all captured IPs with:

```json
[
  {
    "ip": "104.16.132.229",
    "domain": "example.com",
    "ipVersion": 4,
    "cdn": "Cloudflare",
    "asn": "AS13335",
    "org": "Cloudflare, Inc.",
    "country": "US",
    "requestCount": 42,
    "firstSeen": "2024-01-15T08:30:00.000Z"
  }
]
```

### Filter Options

- **Text filter**: Search by domain or IP address
- **Type filter**: All, IPv4 only, IPv6 only, CDN only

### Statistics Bar

Real-time counters showing:
- Total unique IPs
- IPv4 count
- IPv6 count
- CDN-identified count

---

## 🔧 Building & Development

### Project Structure

```
electron-app/
├── main.js                    # Main Electron process
├── preload.js                 # IPC bridge (contextBridge)
├── package.json               # Dependencies & build config
├── asn-database.json          # ASN metadata database
├── monitored-asns.json        # User's monitored ASN list
├── assets/
│   └── icon.png               # Application icon
├── renderer/
│   ├── index.html             # Main UI layout
│   ├── style.css              # Main stylesheet
│   ├── settings.html          # Settings window
│   ├── settings.css           # Settings stylesheet
│   ├── settings.js            # Settings logic
│   ├── monitor.js             # Network monitor & core logic
│   ├── dns-panel.js           # DNS propagation panel
│   ├── bgp-panel.js           # BGP route lookup panel
│   ├── bgp-stream-panel.js    # BGP stream monitor
│   ├── bgp-stream.css         # BGP stream styles
│   ├── ping-chart.js          # Ping monitor & chart
│   ├── aspath-graph.js        # AS Path graph visualization
│   └── aspath-graph.css       # AS Path graph styles
└── dist/                      # Build output (after npm run build)
```

### Development Commands

```bash
# Start in development mode
npm start

# Build Windows x64 installer
npm run build

# Build unpacked directory (for testing)
npm run pack
```

### Dependencies

| Package | Version | Purpose |
|---|---|---|
| `electron` | ^42.3.3 | Desktop app framework |
| `electron-builder` | ^24.13.3 | Build & packaging |
| `ws` | ^8.21.0 | WebSocket client (BGP Stream) |
| `node-fetch` | ^3.3.2 | HTTP requests |

---

## 🌐 Data Sources

| Data | Source | Protocol |
|---|---|---|
| BGP Stream | RIS Live (RIPE NCC) | WebSocket (`wss://ris-live.ripe.net`) |
| BGP Routes | RIPE Stat API | HTTPS |
| WHOIS Data | RIPE Stat API | HTTPS |
| DNS Propagation | Google, Cloudflare, Quad9, OpenDNS, AdGuard, AlterVista | DNS-over-HTTPS |

---

## 📄 License

This project is licensed under the **MIT License**.

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

**Built for NOC Engineers who need fast, visual, and comprehensive network diagnostics.**