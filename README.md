# Crypto Liquidation Heatmap & Perpetual Volume Scanner

A high-performance, mobile-first cryptocurrency perpetual liquidation heatmap scanner and price sweep simulator. Built with vanilla HTML5, CSS3, and JavaScript with zero external dependencies.

---

## 🚀 Key Enhancements & New Features

### 1. Universal Search (1,000+ Perpetual Pairs)
- **Live Exchange Catalog Indexing**: Dynamically fetches and indexes over **1,050+ active perpetual contracts** on startup from Gate.io Public Futures API (`api.gateio.ws`), with fallback to Binance Futures (`fapi.binance.com`) and OKX SWAP (`okx.com`).
- **Real-Time Autocomplete & Search Suggestions**:
  - Instant fuzzy search dropdown as you type (e.g., typing `pepe`, `sol`, `doge`, `wif`, `sui`, `btc`, `pump`).
  - Dropdown displays Base Symbol, Pair Type (`PERP`), 24h Perpetual Volume (e.g., `$890.00M Vol`), Spot Price, and 24h Price Change %.
  - Full keyboard navigation: <kbd>↓</kbd> / <kbd>↑</kbd> to navigate, <kbd>Enter</kbd> to select, and <kbd>Esc</kbd> to dismiss.
- **Categorized Quick-Select Strip**:
  - Filter by **Top Volume** (BTC, ETH, SOL, DOGE, XRP, BNB), **Memes** (PEPE, WIF, BONK, SHIB, PUMP, BERA), **Layer 1** (SUI, APT, AVAX, NEAR, TON, SEI), **AI & Data** (TAO, WLD, RENDER, FET), and **DeFi** (AKE, HYPE, AAVE, UNI, ARB).
- **Freeform Symbol Resolution**: Accepts any format (e.g., `BTC`, `btc`, `BTCUSDT`, `BTC/USDT`, `BTC_USDT`, `SOL`, `pepe`). Automatically checks live exchanges, verified presets, or realistic deterministic simulation models.

### 2. 24h Perpetual Trading Volume & Velocity Metrics
- **Dedicated 24h Perp Trading Volume KPI Card**:
  - **Total 24h Quote Volume**: Displays 24h perpetual trading volume in USD (e.g., `$6.19B`, `$485.87M`, `$58.40M`).
  - **Base Token Volume**: Shows actual token contract volume traded (e.g., `95.6K BTC`, `610.2M SUI`, `5.18B AKE`).
  - **24h High/Low Price Range**: Visualizes intraday trading volatility bounds.
  - **Volume-to-OI Turnover Ratio**: Computes turnover velocity (e.g., `3.42x Turnover`), indicating whether market movement is driven by fast day-trading cascades or sticky positional buildup.
- **Volume-Relative Liquidation Impact (% of 24h Volume)**:
  - **Crosshair Tooltip**: Inspecting any price bin displays its estimated liquidation density and what percentage of the entire day's perpetual volume that cluster accounts for.
  - **Price Sweep Simulator**: Dragging the target price slider displays the total cascading liquidations swept in USD, tokens, and the **percentage of 24h Perpetual Volume** swept.
  - **Top Liquidation Magnet Levels Table**: Features a dedicated `% of 24h Perp Vol` column so traders immediately recognize systemic squeeze risk vs. easily absorbed liquidity.

### 3. Recommended Pairs Engine (>10% Market Cap Mechanism)
- **High-Squeeze & Liquidation Cascade Scanner**:
  - Dynamically scans all 1,000+ perpetual pairs and detects where **Total Short Position, Long Position, or Open Interest exceeds 10% of circulating Market Cap**!
  - When derivatives leverage exceeds 10% of market cap, spot float liquidity is overpowered by derivatives positioning:
    - 🚀 **Extreme Short Squeeze Setup**: Crowded short positions $>10\%$ of Market Cap combined with negative funding. Small upward impulses trigger violent cascading squeezes.
    - 💥 **High Long Flush Risk**: Over-leveraged long positions $>10\%$ of Market Cap combined with positive funding. High vulnerability to cascading downside flushes.
    - ⚡ **Hyper-Overleveraged**: Symmetrical open interest $>10\%$ of Market Cap, priming the pair for explosive volatility expansions.
- **Interactive Recommendation Strip**:
  - Filter pills: `All (>10% MCap)`, `Short Squeeze (>10%)`, `Long Flush (>10%)`.
  - Visual ratio progress bar and direct 1-click **"Analyze Liquidation Map ↗"** button.
- **Active Pair Squeeze Alert Banner & KPI 4**:
  - An animated warning banner appears whenever the active loaded pair exceeds 10% of its market cap.
  - KPI Card 4 shows **Market Cap**, **Position / MCap Ratio**, and **Alert Badges**.

### 4. Modular File Architecture
The codebase has been refactored from a monolithic file into modular components:

```
crypto-liquidation-scanner/
├── index.html           # Semantic HTML5 shell, accessible controls, dropdown & tables
├── css/
│   └── styles.css       # Mobile-first cyber-terminal stylesheet, canvas & animations
├── js/
│   ├── data.js          # Catalog presets, verified pairs, formatting & PRNG helpers
│   ├── api.js           # Gate.io, Binance, OKX, and Coinglass API client
│   ├── heatmap.js       # Liquidation distribution math & High-DPI canvas engine
│   └── app.js           # UI controller, autocomplete, sweep simulator & events
└── README.md            # Architecture, features, and setup documentation
```

---

## 🛠️ How to Run & Preview

### Option A: Direct Browser File Launch (Zero Installation)
Simply double-click `index.html` or open it in any modern browser:
```
file:///C:/Users/arsen/.gemini/antigravity/scratch/crypto-liquidation-scanner/index.html
```

### Option B: Local HTTP Server (Recommended)
You can run any local development server:

**Using Python**:
```powershell
cd C:\Users\arsen\.gemini\antigravity\scratch\crypto-liquidation-scanner
python -m http.server 8080
```
Then open `http://localhost:8080` in your browser.

**Using Node / npx**:
```powershell
cd C:\Users\arsen\.gemini\antigravity\scratch\crypto-liquidation-scanner
npx serve
```

---

## 📊 Heatmap & Chart Anatomy

1. **Left 80% (Thermal Heatmap & OHLC Candles)**:
   - 96 horizontal price bins mapped onto a non-linear thermal gradient:
     - `Deep Navy / Indigo` $\rightarrow$ Low Liquidity
     - `Teal / Cyan` $\rightarrow$ Moderate Buildup
     - `Emerald Green` $\rightarrow$ Dense Cluster
     - `Bright Yellow / Amber` $\rightarrow$ High-Risk Liquidation Wall
     - `Crimson Red` $\rightarrow$ Extreme Squeeze Magnet Level
   - 40 chronological OHLC candlesticks rendered directly over the thermal background.
   - White dashed line indicating the current spot mark price.
   - Colored dashed line & shaded zone tracking the interactive **Price Sweep Simulator**.

2. **Right 20% (Synchronized Liquidity Profile Histogram)**:
   - Green/Cyan bars: Downside Long Liquidation volume.
   - Rose/Amber bars: Overhead Short Liquidation volume.
   - Highlighted in bright white when swept by the simulator.

3. **Top 6 Liquidation Magnet Levels Table**:
   - Lists the 3 largest overhead short squeeze targets and 3 deepest downside long flush targets.
   - Tapping any row smoothly snaps the simulator to that exact price level.

4. **Reusable Code Export (Tab 2)**:
   - Production-ready JavaScript (Node 18+ / Browser) and Python scripts to scan perpetual volume, open interest, and liquidation bands via terminal or backend bots.
