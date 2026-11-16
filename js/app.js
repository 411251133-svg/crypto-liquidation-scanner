/**
 * Crypto Liquidation Heatmap Scanner - Main Application Controller
 * Handles Search Autocomplete for 1,000+ pairs, 24h Perp Volume calculations,
 * Price Sweep Simulation, Magnet Table interactions, and UI updates.
 */
(function (global) {
  'use strict';

  const D = global.ScannerData;
  const API = global.ScannerApi;
  const H = global.ScannerHeatmap;

  // ---------------------------------------------------------------------------
  // 1. APPLICATION STATE
  // ---------------------------------------------------------------------------
  const state = {
    activeSymbol: 'AKEUSDT',
    timeframe: '24H',         // '24H' | '3D' | '7D'
    leverageFilter: 'all',    // 'all' | 'high' | 'mid'
    coinglassKey: (typeof localStorage !== 'undefined' && localStorage.getItem('coinglassKey')) || '',
    availableMarkets: [],     // 1,050+ pairs loaded from exchange
    recentSearches: ['AKEUSDT', 'BTCUSDT', 'SOLUSDT', 'PEPEUSDT', 'SUIUSDT'],
    recommendationFilter: 'all', // 'all' | 'short' | 'long'
    model: null,
    sweepPrice: 0.01126,
    hoverPos: null,
    layoutCache: null,
    selectedSuggestionIdx: -1
  };

  // DOM Elements
  const canvas = document.getElementById('liquidationCanvas');
  const stage = document.getElementById('canvasStage');
  const tooltip = document.getElementById('crosshairTooltip');
  const searchInput = document.getElementById('pairSearchInput');
  const searchDropdown = document.getElementById('searchDropdown');
  const clearSearchBtn = document.getElementById('clearSearchBtn');
  const sweepSlider = document.getElementById('sweepSlider');

  function getTierMultiplier() {
    if (state.leverageFilter === 'high') return 0.38;
    if (state.leverageFilter === 'mid')  return 0.44;
    return 1.0;
  }

  // ---------------------------------------------------------------------------
  // 2. SEARCH AUTOCOMPLETE & 1,000+ PAIR FILTERING
  // ---------------------------------------------------------------------------
  function closeSearchDropdown() {
    if (searchDropdown) {
      searchDropdown.classList.add('hidden');
      state.selectedSuggestionIdx = -1;
    }
  }

  function renderSearchSuggestions(query) {
    if (!searchDropdown) return;
    const q = (query || '').trim().toUpperCase();

    if (!q) {
      // Show Popular / Trending pairs when search input is empty but focused
      const topList = state.availableMarkets.slice(0, 10);
      let html = '<div class="dropdown-header">Top 24h Volume Perpetual Markets</div>';
      for (let i = 0; i < topList.length; i++) {
        const item = topList[i];
        html += renderSuggestionItem(item, i);
      }
      searchDropdown.innerHTML = html;
      searchDropdown.classList.remove('hidden');
      state.selectedSuggestionIdx = -1;
      return;
    }

    // Filter matching markets by symbol or base asset
    const matches = [];
    for (let i = 0; i < state.availableMarkets.length; i++) {
      const m = state.availableMarkets[i];
      if (m.symbol.indexOf(q) !== -1 || m.baseAsset.indexOf(q) !== -1) {
        matches.push(m);
        if (matches.length >= 12) break;
      }
    }

    if (matches.length === 0) {
      searchDropdown.innerHTML =
        '<div style="padding: 12px; font-size: 12px; color: var(--text-secondary); text-align: center;">' +
          'No exact market match for "<strong class="text-cyan">' + q + '</strong>". Press <strong>Enter</strong> to run dynamic simulated model.' +
        '</div>';
      searchDropdown.classList.remove('hidden');
      state.selectedSuggestionIdx = -1;
      return;
    }

    let html = '<div class="dropdown-header">Matching Perpetual Markets (' + matches.length + ')</div>';
    for (let i = 0; i < matches.length; i++) {
      html += renderSuggestionItem(matches[i], i);
    }
    searchDropdown.innerHTML = html;
    searchDropdown.classList.remove('hidden');
    state.selectedSuggestionIdx = -1;
  }

  function renderSuggestionItem(item, idx) {
    const isSelected = idx === state.selectedSuggestionIdx;
    const changeClass = item.change24h >= 0 ? 'text-emerald' : 'text-rose';
    const changeSign = item.change24h >= 0 ? '+' : '';
    const volStr = D.formatRawUsdCompact(item.vol24hUsd);

    return (
      '<div class="search-item' + (isSelected ? ' selected' : '') + '" data-symbol="' + item.symbol + '">' +
        '<div class="search-item-left">' +
          '<span class="search-item-symbol">' + item.baseAsset + '<span style="color: var(--text-muted); font-weight: 400;">/USDT</span></span>' +
          '<span class="search-item-badge">PERP</span>' +
        '</div>' +
        '<div class="search-item-right">' +
          '<span class="search-item-vol" title="24h Perp Volume">Vol: ' + volStr + '</span>' +
          '<span class="search-item-price">' + D.formatPrice(item.price) + '</span>' +
          '<span class="search-item-change ' + changeClass + '">' + changeSign + item.change24h.toFixed(2) + '%</span>' +
        '</div>' +
      '</div>'
    );
  }

  // ---------------------------------------------------------------------------
  // 3. RECOMMENDATION ENGINE (Mechanism: Total Short/Long Position > 10% Market Cap)
  // ---------------------------------------------------------------------------
  function findRecommendedPairs(filterType) {
    const list = [];
    const seen = {};

    const allCandidates = (state.availableMarkets && state.availableMarkets.length > 0)
      ? state.availableMarkets
      : D.PRESET_MARKETS;

    for (let i = 0; i < allCandidates.length; i++) {
      const item = allCandidates[i];
      const sym = item.symbol;
      if (seen[sym]) continue;
      seen[sym] = true;

      const baseAsset = item.baseAsset || D.getBaseAsset(sym);

      // Skip synthetic stock/ETF tokens
      if (global.ScannerApi && global.ScannerApi._isBlacklisted && global.ScannerApi._isBlacklisted(baseAsset)) continue;

      const price = item.price || 1;
      const vol24hUsd = item.vol24hUsd || 0;
      const oiM = item.oiM || 0;

      // Require minimum $1M 24h volume and non-zero OI for recommendations
      if (vol24hUsd < 1000000) continue;
      if (oiM <= 0) continue;

      const preset = D.VERIFIED_PRESETS[sym];
      const fundingPct = item.fundingPct || (preset ? preset.fundingPct : 0);
      const marketCap = D.getMarketCap(sym, price) || item.marketCap || (preset ? preset.marketCap : 0);

      if (marketCap <= 0) continue;

      // Sanity check: if OI > 200% of MCap and no verified preset, likely bad data
      const oiUsd = oiM * 1e6;
      const oiToMcapPct = (oiUsd / marketCap) * 100;
      if (oiToMcapPct > 200 && !preset) continue;

      // Long/Short account ratio
      const hasRealLsData = item.hasRealLsData || (preset && typeof preset.longRatio === 'number');
      const longRatio = (item.longRatio || (preset ? preset.longRatio : 0.50));
      const shortRatio = (item.shortRatio || (preset ? preset.shortRatio : (1.0 - longRatio)));

      // Funding data quality
      const fundingIsReal = item.fundingIsReal || (preset && preset.fundingPct !== undefined);

      // Squeeze detection requires BOTH extreme funding AND high OI/MCap
      if (oiToMcapPct < 10.0) continue;

      let type = 'HYPER_LEVERAGED';
      let dominantRatio = oiToMcapPct;

      if (fundingPct <= -0.015) {
        type = 'SHORT_SQUEEZE';
      } else if (fundingPct >= 0.025) {
        type = 'LONG_FLUSH';
      }

      // Apply filter tab
      if (filterType === 'short' && type !== 'SHORT_SQUEEZE') continue;
      if (filterType === 'long' && type !== 'LONG_FLUSH') continue;

      list.push({
        symbol: sym,
        baseAsset: baseAsset,
        name: item.name || baseAsset,
        price: price,
        change24h: item.change24h || 0,
        vol24hUsd: vol24hUsd,
        oiM: oiM,
        marketCap: marketCap,
        // Derivatives: Long Notional = Short Notional = OI
        shortPosUsd: oiUsd,
        longPosUsd: oiUsd,
        oiToMcapPct: oiToMcapPct,
        dominantRatio: dominantRatio,
        fundingPct: fundingPct,
        fundingIsReal: fundingIsReal,
        longRatio: longRatio,
        shortRatio: shortRatio,
        hasRealLsData: hasRealLsData,
        type: type
      });
    }

    // Sort by highest dominant position to market cap ratio descending
    list.sort(function (a, b) {
      return b.dominantRatio - a.dominantRatio;
    });

    return list;
  }

  function renderRecommendations(filterType) {
    const container = document.getElementById('recommendationsGrid');
    const badgeCount = document.getElementById('recomCountBadge');
    if (!container) return;

    const currentFilter = filterType || state.recommendationFilter || 'all';
    state.recommendationFilter = currentFilter;

    const list = findRecommendedPairs(currentFilter);

    if (badgeCount) {
      badgeCount.textContent = list.length + ' Pairs (>10% MCap)';
    }

    if (list.length === 0) {
      container.innerHTML =
        '<div style="grid-column: 1 / -1; padding: 20px; text-align: center; color: var(--text-secondary); font-size: 13px;">' +
          'No perpetual pairs currently exceed 10% Position / Market Cap under this filter.' +
        '</div>';
      return;
    }

    let html = '';
    const displayList = list.slice(0, 8);
    for (let i = 0; i < displayList.length; i++) {
      const item = displayList[i];
      const isShort = item.type === 'SHORT_SQUEEZE';
      const isLong = item.type === 'LONG_FLUSH';
      const badgeCls = isShort ? 'badge-rose' : (isLong ? 'badge-cyan' : 'badge-amber');
      const badgeText = isShort ? '🚀 SHORT SQUEEZE' : (isLong ? '💥 LONG FLUSH' : '⚡ OVERLEVERAGED');
      const ratioCls = isShort ? 'text-rose' : (isLong ? 'text-cyan' : 'text-amber');
      const barCls = isShort ? 'bar-rose' : (isLong ? 'bar-cyan' : 'bar-amber');
      const ratioWidth = Math.min(100, (item.dominantRatio / 30) * 100);
      const fundSign = item.fundingPct >= 0 ? '+' : '';
      const fundingDisplay = item.fundingIsReal
        ? (fundSign + (item.fundingPct || 0).toFixed(4) + '%')
        : '<span style="color: var(--text-muted);">N/A</span>';
      const fundingColorCls = item.fundingIsReal
        ? (item.fundingPct < -0.01 ? 'text-rose' : (item.fundingPct > 0.01 ? 'text-cyan' : ''))
        : '';
      const lsDisplay = item.hasRealLsData
        ? (((item.longRatio || 0.5) * 100).toFixed(1) + '% L / ' + ((item.shortRatio || 0.5) * 100).toFixed(1) + '% S')
        : '<span style="color: var(--text-muted);">No Data</span>';

      html +=
        '<div class="recom-card card' + (item.symbol === state.activeSymbol ? ' active' : '') + '" data-symbol="' + item.symbol + '">' +
          '<div class="recom-card-top">' +
            '<div style="display: flex; align-items: center; gap: 8px;">' +
              '<span class="mono font-bold" style="font-size: 14px; color: var(--text-primary);">' + item.baseAsset + '/USDT</span>' +
              '<span class="badge ' + badgeCls + '" style="font-size: 10px;">' + badgeText + '</span>' +
            '</div>' +
            '<span class="mono font-bold ' + ratioCls + '" style="font-size: 14px;">' + item.dominantRatio.toFixed(1) + '% <span style="font-size: 10px; color: var(--text-secondary); font-weight: 500;">OI/MCap</span></span>' +
          '</div>' +
          '<div class="ratio-progress-bar"><div class="ratio-progress-fill ' + barCls + '" style="width: ' + ratioWidth + '%;"></div></div>' +
          '<div class="recom-card-details mono">' +
            '<div><span>Market Cap:</span> <strong>' + D.formatRawUsdCompact(item.marketCap) + '</strong></div>' +
            '<div><span>Open Interest:</span> <strong class="' + (item.oiToMcapPct >= 10 ? 'text-rose' : '') + '">' + D.formatUsdCompact(item.oiM) + ' (' + item.oiToMcapPct.toFixed(1) + '% MCap)</strong></div>' +
            '<div><span>Funding Rate:</span> <strong class="' + fundingColorCls + '">' + fundingDisplay + '</strong></div>' +
            '<div><span>L/S Accounts:</span> <strong>' + lsDisplay + '</strong></div>' +
            '<div><span>24h Perp Vol:</span> <strong class="text-amber">' + D.formatRawUsdCompact(item.vol24hUsd) + '</strong></div>' +
          '</div>' +
          '<button type="button" class="btn-analyze-pair' + (item.symbol === state.activeSymbol ? ' active' : '') + '" data-symbol="' + item.symbol + '">' +
            (item.symbol === state.activeSymbol ? '✓ Active Map' : 'Analyze Liquidation Map ↗') +
          '</button>' +
        '</div>';
    }

    container.innerHTML = html;
  }

  // ---------------------------------------------------------------------------
  // 4. UI RENDERING & DASHBOARD SYNC
  // ---------------------------------------------------------------------------
  function updateSweepSimulatorUi() {
    const m = state.model;
    if (!m) return;

    const target = state.sweepPrice;
    const spot = m.currentPrice;
    const diff = target - spot;
    const pct = (diff / spot) * 100;

    const targetBadge = document.getElementById('sweepTargetBadge');
    const resultBadge = document.getElementById('sweepResultBadge');

    if (Math.abs(diff) < m.binStep * 0.15) {
      targetBadge.textContent = 'Target: ' + D.formatPrice(spot) + ' (0.00%)';
      targetBadge.className = 'badge badge-neutral';
      resultBadge.textContent = 'Swept: $0.00 (0 ' + m.baseAsset + ')';
      resultBadge.className = 'badge badge-cyan';
      return;
    }

    let sweptBinSum = 0;
    let totalSideBinSum = 0;
    const isUpSweep = diff > 0;

    for (let b = 0; b < m.bins.length; b++) {
      const bin = m.bins[b];
      const val = H.getBinPoolM(bin, state.leverageFilter);
      if (isUpSweep && bin.price > spot) {
        totalSideBinSum += val;
        if (bin.price <= target) sweptBinSum += val;
      } else if (!isUpSweep && bin.price < spot) {
        totalSideBinSum += val;
        if (bin.price >= target) sweptBinSum += val;
      }
    }

    const tierMult = getTierMultiplier();
    const totalPoolM = (isUpSweep ? m.totalShortPoolM : m.totalLongPoolM) * tierMult;
    const ratio = totalSideBinSum > 0 ? Math.min(1, sweptBinSum / totalSideBinSum) : 0;
    const sweptUsdM = totalPoolM * ratio;
    const avgExecPrice = (spot + target) / 2;
    const sweptTokens = (sweptUsdM * 1e6) / Math.max(1e-8, avgExecPrice);

    // Calculate percentage of 24h Perpetual Trading Volume swept
    const vol24hUsd = m.vol24hUsd || 1e6;
    const pctOf24hVol = ((sweptUsdM * 1e6) / vol24hUsd) * 100;

    if (isUpSweep) {
      targetBadge.textContent = 'Target: ' + D.formatPrice(target) + ' (+' + pct.toFixed(2) + '%)';
      targetBadge.className = 'badge badge-rose';
      resultBadge.textContent = 'Shorts Swept: ' + D.formatUsdCompact(sweptUsdM) + ' (' + D.formatTokenCompact(sweptTokens, m.baseAsset) + ') • ' + pctOf24hVol.toFixed(1) + '% 24h Vol';
      resultBadge.className = 'badge badge-rose';
    } else {
      targetBadge.textContent = 'Target: ' + D.formatPrice(target) + ' (' + pct.toFixed(2) + '%)';
      targetBadge.className = 'badge badge-cyan';
      resultBadge.textContent = 'Longs Swept: ' + D.formatUsdCompact(sweptUsdM) + ' (' + D.formatTokenCompact(sweptTokens, m.baseAsset) + ') • ' + pctOf24hVol.toFixed(1) + '% 24h Vol';
      resultBadge.className = 'badge badge-cyan';
    }
  }

  function renderDashboard() {
    const m = state.model;
    if (!m) return;

    const tierMult = getTierMultiplier();
    const adjShortPoolM = m.totalShortPoolM * tierMult;
    const adjLongPoolM = m.totalLongPoolM * tierMult;
    const vol24hUsd = m.vol24hUsd || 1e6;

    // Header Status Pill & Badges
    const statusPill = document.getElementById('feedStatusPill');
    const statusDot = document.getElementById('feedStatusDot');
    const statusText = document.getElementById('feedStatusText');
    if (m.isLive) {
      statusPill.className = 'badge badge-emerald';
      statusDot.className = 'status-dot live';
      statusText.textContent = 'LIVE PERP FEED';
    } else {
      statusPill.className = 'badge badge-amber';
      statusDot.className = 'status-dot offline';
      statusText.textContent = '⚠ OFFLINE — Using Estimated Data';
    }

    // Show/hide offline warning banner
    const offlineBanner = document.getElementById('offlineWarningBanner');
    if (offlineBanner) {
      if (m.isLive) {
        offlineBanner.classList.add('hidden');
      } else {
        offlineBanner.classList.remove('hidden');
      }
    }

    document.getElementById('activePairHeaderBadge').textContent =
      m.baseAsset + '/USDT • ' + D.formatPrice(m.currentPrice) + ' • 24h Vol: ' + D.formatRawUsdCompact(vol24hUsd);

    document.getElementById('canvasChartTitle').textContent =
      m.baseAsset + '/USDT Liquidation Heatmap & Liquidity Profile (' + m.timeframe + ')';
    document.getElementById('canvasChartSubtitle').textContent =
      'Left (80%): Thermal Liquidity Matrix & 40 OHLC Candlesticks • Right (20%): Short vs. Long Profile • 24h Perp Vol: ' + D.formatRawUsdCompact(vol24hUsd);
    document.getElementById('tableSymbolBadge').textContent =
      m.symbol + ' • Top 6 Liquidation Clusters';

    // KPI 1: Overhead Short Pool
    const shortMagnets = m.magnets.filter(function (x) { return x.side === 'SHORT'; })
      .sort(function (a, b) { return a.price - b.price; });
    const longMagnets = m.magnets.filter(function (x) { return x.side === 'LONG'; })
      .sort(function (a, b) { return b.price - a.price; });

    const nearShort = shortMagnets[0];
    const nearLong = longMagnets[0];

    document.getElementById('kpiShortPoolVal').textContent = D.formatUsdCompact(adjShortPoolM);
    if (nearShort) {
      const sPct = ((nearShort.price - m.currentPrice) / m.currentPrice) * 100;
      document.getElementById('kpiShortTriggerInfo').textContent =
        D.formatPrice(nearShort.price) + ' (+' + sPct.toFixed(2) + '%)';
    }

    // KPI 2: Downside Long Pool
    document.getElementById('kpiLongPoolVal').textContent = D.formatUsdCompact(adjLongPoolM);
    if (nearLong) {
      const lPct = ((nearLong.price - m.currentPrice) / m.currentPrice) * 100;
      document.getElementById('kpiLongTriggerInfo').textContent =
        D.formatPrice(nearLong.price) + ' (' + lPct.toFixed(2) + '%)';
    }

    // KPI 3: 24h Perpetual Trading Volume (NEW FEATURE)
    const volUsdEl = document.getElementById('kpiVolUsdVal');
    if (volUsdEl) volUsdEl.textContent = D.formatRawUsdCompact(vol24hUsd);

    const volBaseEl = document.getElementById('kpiVolBaseVal');
    if (volBaseEl) {
      volBaseEl.textContent = '(' + D.formatTokenCompact(m.vol24hBase || (vol24hUsd / m.currentPrice), m.baseAsset) + ')';
    }

    const volRangeEl = document.getElementById('kpiVolRangeInfo');
    if (volRangeEl) {
      volRangeEl.textContent = D.formatAxisPrice(m.low24h) + ' - ' + D.formatAxisPrice(m.high24h);
    }

    const turnoverRatio = (vol24hUsd / (m.oiM * 1e6)).toFixed(2);
    const turnoverEl = document.getElementById('kpiTurnoverRatio');
    if (turnoverEl) turnoverEl.textContent = turnoverRatio + 'x Turnover';

    // KPI 4: Open Interest & Market Cap Ratio (Mechanism: Position/MCap > 10%)
    const oiValEl = document.getElementById('kpiOiVal');
    if (oiValEl) oiValEl.textContent = D.formatUsdCompact(m.oiM);

    const mcapValEl = document.getElementById('kpiMcapVal');
    if (mcapValEl) mcapValEl.textContent = D.formatRawUsdCompact(m.marketCap);

    const ratioValEl = document.getElementById('kpiRatioVal');
    if (ratioValEl) {
      ratioValEl.textContent = m.oiToMcapPct.toFixed(1) + '%';
      ratioValEl.className = m.oiToMcapPct >= 10.0 ? 'text-rose font-bold' : 'text-emerald font-bold';
    }

    const ratioStatusBadge = document.getElementById('kpiRatioStatusBadge');
    if (ratioStatusBadge) {
      if (m.oiToMcapPct >= 10.0 && m.fundingPct <= -0.015) {
        ratioStatusBadge.textContent = '🔥 SHORT SQUEEZE';
        ratioStatusBadge.className = 'badge badge-rose';
      } else if (m.oiToMcapPct >= 10.0 && m.fundingPct >= 0.025) {
        ratioStatusBadge.textContent = '💥 LONG FLUSH';
        ratioStatusBadge.className = 'badge badge-cyan';
      } else if (m.oiToMcapPct >= 10.0) {
        ratioStatusBadge.textContent = '⚡ >10% OVERLEVERAGED';
        ratioStatusBadge.className = 'badge badge-amber';
      } else {
        ratioStatusBadge.textContent = 'Normal (<10%)';
        ratioStatusBadge.className = 'badge badge-neutral';
      }
    }

    const fEl = document.getElementById('kpiFundingVal');
    if (fEl) {
      if (m.fundingIsReal) {
        const fSign = m.fundingPct >= 0 ? '+' : '';
        fEl.textContent = fSign + m.fundingPct.toFixed(4) + '%';
        fEl.className = m.fundingPct < 0 ? 'text-rose' : 'text-emerald';
      } else {
        fEl.textContent = 'N/A';
        fEl.className = 'text-muted';
      }
    }

    const biasBadge = document.getElementById('kpiBiasBadge');
    if (biasBadge) {
      if (m.fundingPct <= -0.015 && m.oiToMcapPct >= 10.0) {
        biasBadge.textContent = 'Short Squeeze Risk';
        biasBadge.className = 'badge badge-rose';
      } else if (m.fundingPct >= 0.025 && m.oiToMcapPct >= 10.0) {
        biasBadge.textContent = 'Long Flush Risk';
        biasBadge.className = 'badge badge-cyan';
      } else if (m.fundingPct >= -0.01 && m.fundingPct <= 0.01) {
        biasBadge.textContent = 'Normal Market Positioning';
        biasBadge.className = 'badge badge-neutral';
      } else {
        biasBadge.textContent = 'Two-Way Balanced';
        biasBadge.className = 'badge badge-amber';
      }
    }
    document.getElementById('kpiDataSourceNote').textContent = m.sourceLabel;

    // High Squeeze Recommendation Alert Banner (Active Pair)
    const alertBanner = document.getElementById('highSqueezeAlertBanner');
    if (alertBanner) {
      if (m.isRecommended) {
        const isShort = m.recommendationType === 'SHORT_SQUEEZE';
        const isLong = m.recommendationType === 'LONG_FLUSH';
        const typeBadge = isShort
          ? '<span class="badge badge-rose">🚀 SHORT SQUEEZE — OI > 10% MCAP + Negative Funding</span>'
          : (isLong
            ? '<span class="badge badge-cyan">💥 LONG FLUSH — OI > 10% MCAP + High Funding</span>'
            : '<span class="badge badge-amber">⚡ OVERLEVERAGED — OI > 10% MCAP</span>');
        const lsText = m.hasRealLsData
          ? ('L/S Accounts: ' + ((m.longRatio || 0.5) * 100).toFixed(1) + '% / ' + ((m.shortRatio || 0.5) * 100).toFixed(1) + '%.')
          : 'L/S Accounts: No Data';
        const detailTxt = 'Open Interest (' + D.formatUsdCompact(m.oiM) + ') is <strong class="' + (isShort ? 'text-rose' : (isLong ? 'text-cyan' : 'text-amber')) + '">' + m.oiToMcapPct.toFixed(1) + '% of ' + m.baseAsset + ' Market Cap</strong> (' + D.formatRawUsdCompact(m.marketCap) + '). Funding: ' + (m.fundingIsReal ? ((m.fundingPct >= 0 ? '+' : '') + m.fundingPct.toFixed(4) + '%.') : 'N/A.') + ' ' + lsText;

        alertBanner.innerHTML =
          '<div class="squeeze-alert-box">' +
            '<div class="squeeze-alert-header">' +
              typeBadge +
              '<span class="mono font-bold" style="font-size: 13px;">' + m.baseAsset + ' OI is ' + m.oiToMcapPct.toFixed(1) + '% of its Market Cap</span>' +
            '</div>' +
            '<p class="squeeze-alert-desc">' + detailTxt + '</p>' +
          '</div>';
        alertBanner.classList.remove('hidden');
      } else {
        alertBanner.classList.add('hidden');
      }
    }

    // Configure Sweep Slider Bounds
    const stepSize = Math.max(0.000001, (m.maxPrice - m.minPrice) / 500);
    sweepSlider.min = m.minPrice;
    sweepSlider.max = m.maxPrice;
    sweepSlider.step = stepSize;
    sweepSlider.value = state.sweepPrice;

    document.getElementById('sweepMinLbl').textContent = 'Min: ' + D.formatPrice(m.minPrice);
    document.getElementById('sweepMidLbl').textContent = 'Spot: ' + D.formatPrice(m.currentPrice);
    document.getElementById('sweepMaxLbl').textContent = 'Max: ' + D.formatPrice(m.maxPrice);

    // Top 6 Liquidation Magnet Levels Table (includes % of 24h Perp Vol)
    const sortedMagnets = m.magnets.slice().sort(function (a, b) { return b.price - a.price; });
    const tbody = document.getElementById('magnetTableBody');
    let rowsHtml = '';

    for (let i = 0; i < sortedMagnets.length; i++) {
      const mag = sortedMagnets[i];
      const isShort = mag.side === 'SHORT';
      const distPct = ((mag.price - m.currentPrice) / m.currentPrice) * 100;
      const distSign = distPct >= 0 ? '+' : '';
      const adjVolM = mag.volM * tierMult;
      const pctOfPerpVol = ((adjVolM * 1e6) / vol24hUsd) * 100;

      rowsHtml +=
        '<tr data-jump-price="' + mag.price + '">' +
          '<td><span class="badge ' + (isShort ? 'badge-rose' : 'badge-cyan') + '">' + mag.type + '</span></td>' +
          '<td class="font-bold ' + (isShort ? 'text-rose' : 'text-cyan') + '">' + D.formatPrice(mag.price) + '</td>' +
          '<td class="text-right font-bold ' + (isShort ? 'text-amber' : 'text-emerald') + '">' + distSign + distPct.toFixed(2) + '%</td>' +
          '<td class="text-right font-bold">' + D.formatUsdCompact(adjVolM) + '</td>' +
          '<td class="text-right font-bold text-cyan">' + pctOfPerpVol.toFixed(1) + '%</td>' +
          '<td style="color: var(--text-secondary);">' + mag.tier + '</td>' +
        '</tr>';
    }
    tbody.innerHTML = rowsHtml;

    // Highlight active chip
    const chips = document.querySelectorAll('.pair-chip');
    for (let i = 0; i < chips.length; i++) {
      const sym = chips[i].getAttribute('data-symbol');
      chips[i].classList.toggle('active', sym === m.symbol);
    }

    // Highlight active recommendation card
    const recomCards = document.querySelectorAll('.recom-card');
    for (let i = 0; i < recomCards.length; i++) {
      const sym = recomCards[i].getAttribute('data-symbol');
      const isAct = sym === m.symbol;
      recomCards[i].classList.toggle('active', isAct);
      const btn = recomCards[i].querySelector('.btn-analyze-pair');
      if (btn) {
        btn.classList.toggle('active', isAct);
        btn.textContent = isAct ? '✓ Active Map' : 'Analyze Liquidation Map ↗';
      }
    }

    updateSweepSimulatorUi();
    H.drawHeatmapCanvas(canvas, stage, tooltip, state);
  }

  // ---------------------------------------------------------------------------
  // 4. PAIR LOADER CONTROLLER
  // ---------------------------------------------------------------------------
  async function loadPair(rawSymbol) {
    const symbol = D.normalizeSymbol(rawSymbol);
    state.activeSymbol = symbol;
    state.hoverPos = null;
    closeSearchDropdown();

    if (searchInput) {
      searchInput.value = symbol;
      if (clearSearchBtn) clearSearchBtn.style.display = 'block';
    }

    // Add to recent searches
    if (state.recentSearches.indexOf(symbol) === -1) {
      state.recentSearches.unshift(symbol);
      if (state.recentSearches.length > 8) state.recentSearches.pop();
    }

    // 1. Immediately render initial model from presets/catalog so UI never lags
    let marketMatch = null;
    for (let i = 0; i < state.availableMarkets.length; i++) {
      if (state.availableMarkets[i].symbol === symbol) {
        marketMatch = state.availableMarkets[i];
        break;
      }
    }

    const initialModel = H.buildLiquidationModel(symbol, state.timeframe, marketMatch ? {
      price: marketMatch.price,
      vol24hUsd: marketMatch.vol24hUsd,
      vol24hBase: marketMatch.vol24hBase,
      oiM: marketMatch.oiM || 0,
      fundingPct: marketMatch.fundingPct || 0,
      high24h: marketMatch.high24h || marketMatch.price * 1.04,
      low24h: marketMatch.low24h || marketMatch.price * 0.96,
      longRatio: marketMatch.longRatio,
      shortRatio: marketMatch.shortRatio,
      sourceLabel: 'Catalog Index'
    } : null);

    state.model = initialModel;
    state.sweepPrice = initialModel.currentPrice;
    renderDashboard();

    // 2. Fetch live data with 40 real candlesticks from exchange API
    const liveData = await API.fetchLivePairData(symbol, state.timeframe, state.coinglassKey);
    if (liveData && state.activeSymbol === symbol) {
      const liveModel = H.buildLiquidationModel(symbol, state.timeframe, liveData);
      state.model = liveModel;
      state.sweepPrice = liveModel.currentPrice;
      renderDashboard();
    }
  }

  // ---------------------------------------------------------------------------
  // 5. QUICK-SELECT FILTER CHIPS
  // ---------------------------------------------------------------------------
  function initCategoryChips() {
    const container = document.getElementById('quickChipsContainer');
    if (!container) return;

    const categories = [
      { id: 'top', label: 'Top Vol' },
      { id: 'meme', label: 'Memes' },
      { id: 'l1', label: 'Layer 1' },
      { id: 'ai', label: 'AI & Data' },
      { id: 'defi', label: 'DeFi' }
    ];

    let html = '';
    for (let c = 0; c < categories.length; c++) {
      const cat = categories[c];
      const items = D.PRESET_MARKETS.filter(function (m) { return m.category === cat.id; }).slice(0, 5);
      if (items.length > 0) {
        html += '<div class="chips-category-row">';
        html += '<span class="category-tag">' + cat.label + ':</span>';
        for (let i = 0; i < items.length; i++) {
          const sym = items[i].symbol;
          const base = items[i].baseAsset;
          html += '<button type="button" class="pair-chip' + (sym === state.activeSymbol ? ' active' : '') +
            '" data-symbol="' + sym + '">' + base + '/USDT</button>';
        }
        html += '</div>';
      }
    }

    container.innerHTML = html;

    container.addEventListener('click', function (e) {
      const btn = e.target.closest('.pair-chip');
      if (!btn) return;
      const sym = btn.getAttribute('data-symbol');
      if (sym) loadPair(sym);
    });
  }

  // ---------------------------------------------------------------------------
  // 6. REUSABLE CODE DISPLAY (TAB 2)
  // ---------------------------------------------------------------------------
  const JS_CODE_TEMPLATE = `// JavaScript Crypto Liquidation Map & 24h Perp Volume Scanner (Node 18+ / Browser)
async function scanCryptoPerp(rawPair, coinglassApiKey = "") {
  const baseAsset = rawPair.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/(USDT|USD)$/, "");
  const gateContract = \`\${baseAsset}_USDT\`;
  const binanceSymbol = \`\${baseAsset}USDT\`;

  // 1. Fetch 24h Perpetual Trading Volume, Price & Mark Price (Gate.io / Binance)
  let price = 0, vol24hUsd = 0, fundingPct = 0, oiM = 0;

  try {
    const res = await fetch(\`https://api.gateio.ws/api/v4/futures/usdt/tickers?contract=\${gateContract}\`);
    const data = await res.json();
    if (data && data[0]) {
      const t = data[0];
      price = parseFloat(t.last || t.mark_price);
      vol24hUsd = parseFloat(t.volume_24h_quote || t.volume_24h_settle || "0");
      fundingPct = parseFloat(t.funding_rate || "0") * 100;
      oiM = (parseFloat(t.total_size || "0") * parseFloat(t.quanto_multiplier || "1") * price) / 1e6;
    }
  } catch (err) {
    // Fallback to Binance Futures
    const [prem, oi, t24] = await Promise.all([
      fetch(\`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=\${binanceSymbol}\`).then(r => r.json()),
      fetch(\`https://fapi.binance.com/fapi/v1/openInterest?symbol=\${binanceSymbol}\`).then(r => r.json()),
      fetch(\`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=\${binanceSymbol}\`).then(r => r.json())
    ]);
    price = parseFloat(prem.markPrice);
    fundingPct = parseFloat(prem.lastFundingRate) * 100;
    oiM = (parseFloat(oi.openInterest) * price) / 1e6;
    vol24hUsd = parseFloat(t24.quoteVolume || "0");
  }

  // 2. Compute Leverage Liquidation Bands (100x, 50x, 25x, 10x)
  const tiers = [
    { leverage: "100x", dist: 0.009, weight: 0.18 },
    { leverage: "50x",  dist: 0.019, weight: 0.28 },
    { leverage: "25x",  dist: 0.038, weight: 0.32 },
    { leverage: "10x",  dist: 0.095, weight: 0.22 }
  ];

  const shortSkew = fundingPct < -0.015 ? 1.25 : (fundingPct > 0.025 ? 0.75 : 1.0);
  const clusters = tiers.flatMap(t => ([
    {
      side: "SHORT_SQUEEZE",
      leverage: t.leverage,
      triggerPrice: +(price * (1 + t.dist)).toFixed(6),
      estPoolUsd: Math.round(oiM * 1e6 * 0.05 * t.weight * shortSkew),
      pctOf24hVol: +(((oiM * 1e6 * 0.05 * t.weight * shortSkew) / Math.max(1, vol24hUsd)) * 100).toFixed(2)
    },
    {
      side: "LONG_LIQUIDATION",
      leverage: t.leverage,
      triggerPrice: +(price * (1 - t.dist)).toFixed(6),
      estPoolUsd: Math.round(oiM * 1e6 * 0.05 * t.weight / shortSkew),
      pctOf24hVol: +(((oiM * 1e6 * 0.05 * t.weight / shortSkew) / Math.max(1, vol24hUsd)) * 100).toFixed(2)
    }
  ]));

  return { symbol: binanceSymbol, price, vol24hUsd, fundingPct, oiM, clusters };
}

scanCryptoPerp("PEPE").then(console.log);`;

  const PY_CODE_TEMPLATE = `# Python Crypto Liquidation & 24h Perpetual Volume Scanner
import requests

def scan_crypto_perp(raw_pair: str, coinglass_key: str = "") -> dict:
    base = "".join(ch for ch in raw_pair.upper() if ch.isalnum()).replace("USDT", "").replace("USD", "")
    contract = f"{base}_USDT"
    symbol = f"{base}USDT"

    # 1. Fetch live 24h perp volume, price & open interest
    try:
        r = requests.get(f"https://api.gateio.ws/api/v4/futures/usdt/tickers?contract={contract}", timeout=4).json()
        t = r[0]
        price = float(t.get("last") or t.get("mark_price", 0))
        vol24h_usd = float(t.get("volume_24h_quote") or 0)
        funding_pct = float(t.get("funding_rate") or 0) * 100.0
        oi_m = (float(t.get("total_size", 0)) * float(t.get("quanto_multiplier", 1)) * price) / 1e6
    except Exception:
        # Binance fallback
        prem = requests.get(f"https://fapi.binance.com/fapi/v1/premiumIndex?symbol={symbol}", timeout=4).json()
        oi = requests.get(f"https://fapi.binance.com/fapi/v1/openInterest?symbol={symbol}", timeout=4).json()
        t24 = requests.get(f"https://fapi.binance.com/fapi/v1/ticker/24hr?symbol={symbol}", timeout=4).json()
        price = float(prem["markPrice"])
        funding_pct = float(prem["lastFundingRate"]) * 100.0
        vol24h_usd = float(t24.get("quoteVolume", 0))
        oi_m = (float(oi["openInterest"]) * price) / 1e6

    # 2. Leverage Tiers
    tiers = [("100x", 0.009, 0.18), ("50x", 0.019, 0.28), ("25x", 0.038, 0.32), ("10x", 0.095, 0.22)]
    skew = 1.25 if funding_pct < -0.015 else (0.75 if funding_pct > 0.025 else 1.0)
    clusters = []

    for lev, dist, wt in tiers:
        short_usd = round(oi_m * 1e6 * 0.05 * wt * skew, 2)
        long_usd = round(oi_m * 1e6 * 0.05 * wt / skew, 2)
        clusters.append({
            "side": "SHORT_SQUEEZE",
            "leverage": lev,
            "trigger_price": round(price * (1.0 + dist), 6),
            "est_pool_usd": short_usd,
            "pct_of_24h_vol": round((short_usd / max(1.0, vol24h_usd)) * 100.0, 2)
        })
        clusters.append({
            "side": "LONG_LIQUIDATION",
            "leverage": lev,
            "trigger_price": round(price * (1.0 - dist), 6),
            "est_pool_usd": long_usd,
            "pct_of_24h_vol": round((long_usd / max(1.0, vol24h_usd)) * 100.0, 2)
        })

    return {
        "symbol": symbol,
        "price": price,
        "vol24h_usd": vol24h_usd,
        "funding_pct": round(funding_pct, 4),
        "open_interest_m": round(oi_m, 2),
        "clusters": clusters
    }

if __name__ == "__main__":
    print(scan_crypto_perp("SOL"))`;

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function highlightCode(raw, lang) {
    let escaped = escapeHtml(raw);
    if (lang === 'js') {
      escaped = escaped
        .replace(/(\/\/[^\n]*)/g, '<span class="tok-com">$1</span>')
        .replace(/\b(async|function|const|let|return|if|await)\b/g, '<span class="tok-kw">$1</span>')
        .replace(/(&quot;[^&]*&quot;|"[^"]*"|`[^`]*`)/g, '<span class="tok-str">$1</span>');
    } else {
      escaped = escaped
        .replace(/(#[^\n]*)/g, '<span class="tok-com">$1</span>')
        .replace(/\b(import|def|return|if|for|in|not|except|try)\b/g, '<span class="tok-kw">$1</span>')
        .replace(/("[^"]*")/g, '<span class="tok-str">$1</span>');
    }
    return escaped;
  }

  function copyToClipboard(text, btnElement, label) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      btnElement.textContent = 'Copied!';
      setTimeout(function () { btnElement.textContent = label; }, 1600);
    } catch (e) {
      btnElement.textContent = 'Selected';
    }
    document.body.removeChild(textarea);
  }

  // ---------------------------------------------------------------------------
  // 7. EVENT BINDINGS
  // ---------------------------------------------------------------------------
  function bindUiEvents() {
    // Search Input Autocomplete Events
    if (searchInput) {
      searchInput.addEventListener('input', function (e) {
        const val = e.target.value;
        if (clearSearchBtn) clearSearchBtn.style.display = val ? 'block' : 'none';
        renderSearchSuggestions(val);
      });

      searchInput.addEventListener('focus', function () {
        renderSearchSuggestions(searchInput.value);
      });

      searchInput.addEventListener('keydown', function (e) {
        if (!searchDropdown || searchDropdown.classList.contains('hidden')) return;
        const items = searchDropdown.querySelectorAll('.search-item');
        if (items.length === 0) return;

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          state.selectedSuggestionIdx = (state.selectedSuggestionIdx + 1) % items.length;
          highlightSuggestion(items);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          state.selectedSuggestionIdx = (state.selectedSuggestionIdx - 1 + items.length) % items.length;
          highlightSuggestion(items);
        } else if (e.key === 'Enter') {
          if (state.selectedSuggestionIdx >= 0 && items[state.selectedSuggestionIdx]) {
            e.preventDefault();
            const sym = items[state.selectedSuggestionIdx].getAttribute('data-symbol');
            if (sym) loadPair(sym);
          }
        } else if (e.key === 'Escape') {
          closeSearchDropdown();
        }
      });
    }

    function highlightSuggestion(items) {
      for (let i = 0; i < items.length; i++) {
        items[i].classList.toggle('selected', i === state.selectedSuggestionIdx);
      }
      if (items[state.selectedSuggestionIdx]) {
        items[state.selectedSuggestionIdx].scrollIntoView({ block: 'nearest' });
      }
    }

    // Search Dropdown Item Click
    if (searchDropdown) {
      searchDropdown.addEventListener('click', function (e) {
        const item = e.target.closest('.search-item');
        if (!item) return;
        const sym = item.getAttribute('data-symbol');
        if (sym) loadPair(sym);
      });
    }

    // Close Dropdown on Outside Click
    document.addEventListener('click', function (e) {
      if (!e.target.closest('#pairSearchForm')) {
        closeSearchDropdown();
      }
    });

    // Clear Search Input Button
    if (clearSearchBtn) {
      clearSearchBtn.addEventListener('click', function () {
        searchInput.value = '';
        clearSearchBtn.style.display = 'none';
        searchInput.focus();
        renderSearchSuggestions('');
      });
    }

    // Search Form Submit
    document.getElementById('pairSearchForm').addEventListener('submit', function (e) {
      e.preventDefault();
      const val = searchInput.value;
      if (val) loadPair(val);
    });

    // API Config Drawer
    const drawer = document.getElementById('apiConfigDrawer');
    document.getElementById('btnToggleApiDrawer').addEventListener('click', function () {
      drawer.classList.toggle('hidden');
    });

    document.getElementById('btnSaveApiKey').addEventListener('click', function () {
      const val = document.getElementById('coinglassKeyInput').value.trim();
      state.coinglassKey = val;
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('coinglassKey', val);
      }
      const badge = document.getElementById('apiKeyStatusBadge');
      if (val) {
        badge.textContent = '? Coinglass V4 Active (Live Heatmap Connected)';
        badge.className = 'badge badge-emerald';
      } else {
        badge.textContent = 'No Coinglass Key Set (Using Public Feed + Presets)';
        badge.className = 'badge badge-neutral';
      }
      loadPair(state.activeSymbol);
    });

    document.getElementById('btnClearApiKey').addEventListener('click', function () {
      state.coinglassKey = '';
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('coinglassKey');
      }
      document.getElementById('coinglassKeyInput').value = '';
      const badge = document.getElementById('apiKeyStatusBadge');
      badge.textContent = 'No Coinglass Key Set (Using Public Feed + Presets)';
      badge.className = 'badge badge-neutral';
      loadPair(state.activeSymbol);
    });

    // Navigation Tabs
    const tabBtnScanner = document.getElementById('tabBtnScanner');
    const tabBtnCode = document.getElementById('tabBtnCode');
    const panelScanner = document.getElementById('panelScanner');
    const panelCode = document.getElementById('panelCode');

    tabBtnScanner.addEventListener('click', function () {
      tabBtnScanner.classList.add('active');
      tabBtnCode.classList.remove('active');
      panelScanner.classList.remove('hidden');
      panelCode.classList.add('hidden');
      H.drawHeatmapCanvas(canvas, stage, tooltip, state);
    });

    tabBtnCode.addEventListener('click', function () {
      tabBtnCode.classList.add('active');
      tabBtnScanner.classList.remove('active');
      panelCode.classList.remove('hidden');
      panelScanner.classList.add('hidden');
    });

    // Timeframe Horizon Pills (24H, 3D, 7D)
    const tfButtons = document.querySelectorAll('[data-tf]');
    for (let i = 0; i < tfButtons.length; i++) {
      tfButtons[i].addEventListener('click', function () {
        const tf = this.getAttribute('data-tf');
        if (!tf || tf === state.timeframe) return;
        state.timeframe = tf;
        for (let j = 0; j < tfButtons.length; j++) {
          tfButtons[j].className = tfButtons[j].getAttribute('data-tf') === tf ? 'btn-pill-active-cyan' : '';
        }
        loadPair(state.activeSymbol);
      });
    }

    // Leverage Filter Pills (All, High, Mid)
    const levButtons = document.querySelectorAll('[data-lev]');
    for (let i = 0; i < levButtons.length; i++) {
      levButtons[i].addEventListener('click', function () {
        const lev = this.getAttribute('data-lev');
        if (!lev || lev === state.leverageFilter) return;
        state.leverageFilter = lev;
        for (let j = 0; j < levButtons.length; j++) {
          levButtons[j].className = levButtons[j].getAttribute('data-lev') === lev ? 'btn-pill-active-amber' : '';
        }
        renderDashboard();
      });
    }

    // Sweep Simulator Slider & Reset
    sweepSlider.addEventListener('input', function (e) {
      state.sweepPrice = Number(e.target.value);
      updateSweepSimulatorUi();
      H.drawHeatmapCanvas(canvas, stage, tooltip, state);
    });

    document.getElementById('btnResetSweep').addEventListener('click', function () {
      if (!state.model) return;
      state.sweepPrice = state.model.currentPrice;
      sweepSlider.value = state.sweepPrice;
      updateSweepSimulatorUi();
      H.drawHeatmapCanvas(canvas, stage, tooltip, state);
    });

    // Magnet Table Row Click -> Jump Sweep Slider
    document.getElementById('magnetTableBody').addEventListener('click', function (e) {
      const row = e.target.closest('tr[data-jump-price]');
      if (!row) return;
      const jumpPrice = Number(row.getAttribute('data-jump-price'));
      if (Number.isFinite(jumpPrice)) {
        state.sweepPrice = jumpPrice;
        sweepSlider.value = jumpPrice;
        updateSweepSimulatorUi();
        H.drawHeatmapCanvas(canvas, stage, tooltip, state);
        stage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });

    // Canvas Pointer Crosshair Events (Mouse & Touch)
    function inspectPointer(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      state.hoverPos = {
        x: clientX - rect.left,
        y: clientY - rect.top
      };
      H.drawHeatmapCanvas(canvas, stage, tooltip, state);
    }

    canvas.addEventListener('mousemove', function (e) {
      inspectPointer(e.clientX, e.clientY);
    });
    canvas.addEventListener('mouseleave', function () {
      state.hoverPos = null;
      H.drawHeatmapCanvas(canvas, stage, tooltip, state);
    });
    canvas.addEventListener('click', function (e) {
      inspectPointer(e.clientX, e.clientY);
    });
    canvas.addEventListener('touchstart', function (e) {
      if (e.touches && e.touches[0]) {
        inspectPointer(e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive: true });
    canvas.addEventListener('touchmove', function (e) {
      if (e.touches && e.touches[0]) {
        inspectPointer(e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive: true });

    // Canvas Resize Observer
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(function () {
        H.drawHeatmapCanvas(canvas, stage, tooltip, state);
      });
      ro.observe(stage);
    } else {
      window.addEventListener('resize', function () {
        H.drawHeatmapCanvas(canvas, stage, tooltip, state);
      });
    }

    // Recommendations Card & Button Click -> Load Pair
    const recomGrid = document.getElementById('recommendationsGrid');
    if (recomGrid) {
      recomGrid.addEventListener('click', function (e) {
        const card = e.target.closest('.recom-card, .btn-analyze-pair');
        if (!card) return;
        const sym = card.getAttribute('data-symbol');
        if (sym) {
          loadPair(sym);
          const stageEl = document.getElementById('canvasStage');
          if (stageEl) stageEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      });
    }

    // Recommendations Filter Pills (All >10%, Short Squeeze, Long Flush)
    const recomFilterBtns = document.querySelectorAll('[data-recom-filter]');
    for (let i = 0; i < recomFilterBtns.length; i++) {
      recomFilterBtns[i].addEventListener('click', function () {
        const filterVal = this.getAttribute('data-recom-filter');
        for (let j = 0; j < recomFilterBtns.length; j++) {
          recomFilterBtns[j].className = recomFilterBtns[j].getAttribute('data-recom-filter') === filterVal
            ? 'btn-pill-active-cyan' : '';
        }
        renderRecommendations(filterVal);
      });
    }

    // Toggle Recommendations Section
    const btnToggleRecom = document.getElementById('btnToggleRecommendations');
    const recomContent = document.getElementById('recommendationsContent');
    if (btnToggleRecom && recomContent) {
      btnToggleRecom.addEventListener('click', function () {
        recomContent.classList.toggle('hidden');
        btnToggleRecom.textContent = recomContent.classList.contains('hidden') ? 'Show Recommendations' : 'Hide';
      });
    }

    // Populate Reusable Code Panels
    document.getElementById('jsCodeDisplay').innerHTML = highlightCode(JS_CODE_TEMPLATE, 'js');
    document.getElementById('pyCodeDisplay').innerHTML = highlightCode(PY_CODE_TEMPLATE, 'py');

    document.getElementById('btnCopyJs').addEventListener('click', function () {
      copyToClipboard(JS_CODE_TEMPLATE, this, 'Copy JS');
    });
    document.getElementById('btnCopyPy').addEventListener('click', function () {
      copyToClipboard(PY_CODE_TEMPLATE, this, 'Copy Python');
    });
  }

  // ---------------------------------------------------------------------------
  // 8. BOOTSTRAP
  // ---------------------------------------------------------------------------
  async function bootstrap() {
    state.availableMarkets = (D.PRESET_MARKETS || []).slice();
    initCategoryChips();
    bindUiEvents();
    renderRecommendations('all');

    // Start with default pair
    loadPair('AKEUSDT');

    // Asynchronously fetch live market caps (CoinGecko) and 1,050+ live markets (Gate.io)
    try {
      await API.fetchLiveMarketCaps();

      const fullCatalog = await API.fetchAllMarkets();
      if (Array.isArray(fullCatalog) && fullCatalog.length > 50) {
        state.availableMarkets = fullCatalog;
        const catalogBadge = document.getElementById('catalogCountBadge');
        if (catalogBadge) {
          catalogBadge.textContent = fullCatalog.length + '+ Perpetuals Indexed';
          catalogBadge.classList.remove('hidden');
        }
      }

      // Update existing availableMarkets with live market caps
      for (let i = 0; i < state.availableMarkets.length; i++) {
        const m = state.availableMarkets[i];
        m.marketCap = D.getMarketCap(m.symbol, m.price);
        if (m.marketCap > 0 && m.oiM > 0) {
          m.oiToMcapPct = ((m.oiM * 1e6) / m.marketCap) * 100;
        }
      }

      // Update active model with live market cap
      if (state.model) {
        const freshMcap = D.getMarketCap(state.model.symbol, state.model.currentPrice);
        if (freshMcap > 0) {
          state.model.marketCap = freshMcap;
          state.model.oiToMcapPct = ((state.model.oiM * 1e6) / freshMcap) * 100;
          renderDashboard();
        }
      }

      // Refresh recommendations with newly indexed markets and live market caps
      renderRecommendations(state.recommendationFilter);
    } catch (err) {
      console.warn('Background market catalog sync failed, using offline index:', err);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }

})(window);
