/**
 * Crypto Liquidation Heatmap Scanner - Mathematical Model & High-DPI Canvas Renderer
 * 80% Left Thermal Heatmap Matrix + 40 OHLC Candlesticks + 20% Right Liquidity Profile
 */
(function (global) {
  'use strict';

  const D = global.ScannerData;

  // ---------------------------------------------------------------------------
  // 1. THERMAL GRADIENT COLOR STOPS
  // Deep Navy/Purple -> Teal/Cyan -> Emerald -> Bright Yellow -> Amber/Crimson
  // ---------------------------------------------------------------------------
  const COLOR_STOPS = [
    { t: 0.00, r: 11,  g: 17,  b: 33,  a: 0.30 }, // #0b1121 deep navy
    { t: 0.20, r: 30,  g: 27,  b: 75,  a: 0.55 }, // #1e1b4b deep indigo-purple
    { t: 0.40, r: 6,   g: 182, b: 212, a: 0.72 }, // #06b6d4 teal/cyan
    { t: 0.62, r: 16,  g: 185, b: 129, a: 0.84 }, // #10b981 emerald green
    { t: 0.80, r: 250, g: 204, b: 21,  a: 0.92 }, // #facc15 bright yellow
    { t: 0.92, r: 249, g: 115, b: 22,  a: 0.96 }, // #f97316 dense amber-orange
    { t: 1.00, r: 244, g: 63,  b: 94,  a: 0.99 }  // #f43f5e extreme wall crimson
  ];

  function thermalRgba(norm) {
    const clamped = Math.max(0, Math.min(1, norm));
    for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
      const s0 = COLOR_STOPS[i];
      const s1 = COLOR_STOPS[i + 1];
      if (clamped >= s0.t && clamped <= s1.t) {
        const k = (clamped - s0.t) / (s1.t - s0.t);
        const r = Math.round(s0.r + (s1.r - s0.r) * k);
        const g = Math.round(s0.g + (s1.g - s0.g) * k);
        const b = Math.round(s0.b + (s1.b - s0.b) * k);
        const a = (s0.a + (s1.a - s0.a) * k).toFixed(3);
        return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
      }
    }
    return 'rgba(244, 63, 94, 0.99)';
  }

  // ---------------------------------------------------------------------------
  // 2. LIQUIDATION MODEL BUILDER
  // ---------------------------------------------------------------------------
  function buildLiquidationModel(symbol, timeframe, liveOverride) {
    const baseAsset = D.getBaseAsset(symbol);
    const preset = D.VERIFIED_PRESETS[symbol];
    const rng = D.createSeededRng(D.hashString(symbol + '_' + timeframe));

    const tfVolMult = timeframe === '24H' ? 1.0 : timeframe === '3D' ? 1.65 : 2.35;
    const tfSpanPct = timeframe === '24H' ? 0.14 : timeframe === '3D' ? 0.24 : 0.36;

    let currentPrice, oiM, vol24hUsd, vol24hBase, fundingPct, high24h, low24h, baseShortPoolM, baseLongPoolM, sourceLabel, isLive;

    if (liveOverride) {
      currentPrice = liveOverride.price;
      oiM = liveOverride.oiM;
      vol24hUsd = liveOverride.vol24hUsd;
      vol24hBase = liveOverride.vol24hBase;
      fundingPct = liveOverride.fundingPct;
      high24h = liveOverride.high24h;
      low24h = liveOverride.low24h;

      // Liquidation pool = estimated liquidatable positions (small fraction of OI)
      // Skew based on funding: negative funding → more shorts to liquidate overhead
      const skew = fundingPct < -0.01 ? 1.20 : fundingPct > 0.01 ? 0.82 : 1.0;
      baseShortPoolM = Math.max(0.01, oiM * 0.048 * skew);
      baseLongPoolM = Math.max(0.01, oiM * 0.048 / skew);
      sourceLabel = liveOverride.sourceLabel;
      isLive = true;
    } else if (preset) {
      currentPrice = preset.price;
      oiM = preset.oiM;
      vol24hUsd = (preset.vol24hM || (preset.oiM * 1.8)) * 1e6;
      vol24hBase = vol24hUsd / currentPrice;
      fundingPct = preset.fundingPct;
      high24h = currentPrice * 1.045;
      low24h = currentPrice * 0.955;
      // Compute liquidation pools from OI (not hardcoded)
      const skew = fundingPct < -0.01 ? 1.20 : fundingPct > 0.01 ? 0.82 : 1.0;
      baseShortPoolM = Math.max(0.01, oiM * 0.048 * skew);
      baseLongPoolM = Math.max(0.01, oiM * 0.048 / skew);
      sourceLabel = 'Verified Preset';
      isLive = false;
    } else {
      // Deterministic realistic simulation for any symbol in crypto
      const priceTier = rng();
      if (priceTier < 0.25) {
        currentPrice = Number((0.0015 + rng() * 0.045).toFixed(5));
      } else if (priceTier < 0.65) {
        currentPrice = Number((0.12 + rng() * 4.8).toFixed(4));
      } else {
        currentPrice = Number((12 + rng() * 420).toFixed(2));
      }
      oiM = Number((35 + rng() * 680).toFixed(2));
      vol24hUsd = oiM * (1.5 + rng() * 2.2) * 1e6;
      vol24hBase = vol24hUsd / currentPrice;
      fundingPct = Number((-0.038 + rng() * 0.056).toFixed(4));
      high24h = currentPrice * (1 + 0.03 + rng() * 0.04);
      low24h = currentPrice * (1 - 0.03 - rng() * 0.04);

      const skew = fundingPct < -0.008 ? 1.22 : 0.92;
      baseShortPoolM = Number((oiM * (0.038 + rng() * 0.025) * skew).toFixed(2));
      baseLongPoolM = Number((oiM * (0.038 + rng() * 0.025) / skew).toFixed(2));
      sourceLabel = 'Modeled Symbol';
      isLive = false;
    }

    const totalShortPoolM = baseShortPoolM * tfVolMult;
    const totalLongPoolM = baseLongPoolM * tfVolMult;

    // Market Capitalization & Squeeze Recommendation Calculations (>10% MCap Mechanism)
    const liveMcap = D.getMarketCap(symbol, currentPrice);
    const marketCap = (liveOverride && liveOverride.marketCap) || (liveMcap > 0 ? liveMcap : (preset && preset.marketCap)) || 10000000;

    // Real Long/Short Account Ratio from Coinglass / Contract Stats
    // NOTE: This is account sentiment ratio, NOT notional split.
    // In derivatives: Long Notional = Short Notional = Open Interest (every contract has a buyer & seller)
    const hasRealLsData = (liveOverride && liveOverride.hasRealLsData === true)
      || (preset && typeof preset.longRatio === 'number');
    const longRatio = (liveOverride && typeof liveOverride.longRatio === 'number')
      ? liveOverride.longRatio
      : (preset && typeof preset.longRatio === 'number' ? preset.longRatio : 0.50);
    const shortRatio = (liveOverride && typeof liveOverride.shortRatio === 'number')
      ? liveOverride.shortRatio
      : (preset && typeof preset.shortRatio === 'number' ? preset.shortRatio : (1.0 - longRatio));
    const fundingIsReal = (liveOverride && liveOverride.fundingIsReal === true)
      || (preset && preset.fundingPct !== undefined);

    // Derivatives accounting: Total Long Notional = Total Short Notional = Open Interest
    // Every futures contract has exactly one long and one short — the notional is always equal.
    const shortPositionM = oiM; // Total short notional = OI
    const longPositionM = oiM;  // Total long notional = OI
    const oiToMcapPct = marketCap > 0 ? ((oiM * 1e6) / marketCap) * 100 : 0;

    // Squeeze detection: requires BOTH extreme funding AND high OI/MCap
    // Short Squeeze: funding <= -0.015% AND OI/MCap >= 10%
    // Long Flush:    funding >= +0.025% AND OI/MCap >= 10%
    // Otherwise: Normal Market Positioning
    let isRecommended = false;
    let recommendationType = null;

    if (oiToMcapPct >= 10.0) {
      if (fundingPct <= -0.015) {
        isRecommended = true;
        recommendationType = 'SHORT_SQUEEZE';
      } else if (fundingPct >= 0.025) {
        isRecommended = true;
        recommendationType = 'LONG_FLUSH';
      } else {
        // High OI/MCap but normal funding = overleveraged, not a squeeze
        isRecommended = true;
        recommendationType = 'HYPER_LEVERAGED';
      }
    }

    // Generate 6 Key Magnet Levels (3 Overhead Short clusters + 3 Downside Long clusters)
    let magnets = [];
    if (preset && preset.customClusters && !liveOverride) {
      magnets = preset.customClusters.map(function (c) {
        return {
          type: c.type,
          side: c.price >= currentPrice ? 'SHORT' : 'LONG',
          price: c.price,
          volM: Number((c.volM * tfVolMult).toFixed(2)),
          tier: c.tier
        };
      });
    } else {
      const s1Dist = (0.018 + rng() * 0.015) * (timeframe === '24H' ? 1 : 1.35);
      const s2Dist = (0.052 + rng() * 0.028) * (timeframe === '24H' ? 1 : 1.45);
      const s3Dist = (0.105 + rng() * 0.045) * (timeframe === '24H' ? 1 : 1.55);

      const l1Dist = (0.017 + rng() * 0.015) * (timeframe === '24H' ? 1 : 1.35);
      const l2Dist = (0.050 + rng() * 0.028) * (timeframe === '24H' ? 1 : 1.45);
      const l3Dist = (0.102 + rng() * 0.045) * (timeframe === '24H' ? 1 : 1.55);

      const dec = D.getDecimalsForPrice(currentPrice);
      magnets = [
        {
          type: 'Short Squeeze (Ext)',
          side: 'SHORT',
          price: Number((currentPrice * (1 + s3Dist)).toFixed(dec)),
          volM: Number((totalShortPoolM * 0.44).toFixed(2)),
          tier: '10x – 20x'
        },
        {
          type: 'Short Squeeze (High)',
          side: 'SHORT',
          price: Number((currentPrice * (1 + s2Dist)).toFixed(dec)),
          volM: Number((totalShortPoolM * 0.36).toFixed(2)),
          tier: '20x – 50x'
        },
        {
          type: 'Short Trigger (Near)',
          side: 'SHORT',
          price: Number((currentPrice * (1 + s1Dist)).toFixed(dec)),
          volM: Number((totalShortPoolM * 0.20).toFixed(2)),
          tier: '50x – 100x'
        },
        {
          type: 'Long Trigger (Near)',
          side: 'LONG',
          price: Number((currentPrice * (1 - l1Dist)).toFixed(dec)),
          volM: Number((totalLongPoolM * 0.21).toFixed(2)),
          tier: '50x – 100x'
        },
        {
          type: 'Long Support (Mid)',
          side: 'LONG',
          price: Number((currentPrice * (1 - l2Dist)).toFixed(dec)),
          volM: Number((totalLongPoolM * 0.37).toFixed(2)),
          tier: '20x – 50x'
        },
        {
          type: 'Long Magnet (Deep)',
          side: 'LONG',
          price: Number((currentPrice * (1 - l3Dist)).toFixed(dec)),
          volM: Number((totalLongPoolM * 0.42).toFixed(2)),
          tier: '10x – 25x'
        }
      ];
    }

    // Determine Y-axis price boundaries encompassing all magnets and candles
    const allMagnetPrices = magnets.map(function (m) { return m.price; });
    const rawLow = Math.min(currentPrice * (1 - tfSpanPct), Math.min.apply(null, allMagnetPrices) * 0.965);
    const rawHigh = Math.max(currentPrice * (1 + tfSpanPct), Math.max.apply(null, allMagnetPrices) * 1.035);
    const minPrice = Math.max(currentPrice * 0.15, rawLow);
    const maxPrice = rawHigh;

    // 40 OHLC Candlesticks
    const numCols = 40;
    let candles = [];
    if (liveOverride && liveOverride.candles && liveOverride.candles.length === numCols) {
      candles = liveOverride.candles;
    } else {
      let walk = currentPrice * (0.94 + (rng() - 0.45) * 0.10);
      const stepVol = (maxPrice - minPrice) * 0.042;
      for (let c = 0; c < numCols; c++) {
        const open = c === 0 ? walk : candles[c - 1].close;
        const pullToSpot = (currentPrice - open) * ((c + 1) / numCols) * 0.32;
        const delta = (rng() - 0.49) * stepVol + pullToSpot;
        const close = c === numCols - 1 ? currentPrice : Math.max(minPrice * 1.03, Math.min(maxPrice * 0.97, open + delta));
        const wickUp = Math.abs(rng()) * stepVol * 0.65;
        const wickDn = Math.abs(rng()) * stepVol * 0.65;
        candles.push({
          index: c,
          open: open,
          high: Math.min(maxPrice * 0.99, Math.max(open, close) + wickUp),
          low: Math.max(minPrice * 1.01, Math.min(open, close) - wickDn),
          close: close
        });
      }
    }

    // 96 Price Bins
    const numBins = 96;
    const binStep = (maxPrice - minPrice) / numBins;
    const bins = [];

    for (let b = 0; b < numBins; b++) {
      const binPrice = minPrice + (b + 0.5) * binStep;
      const side = binPrice >= currentPrice ? 'SHORT' : 'LONG';

      let highLevM = (0.015 + 0.018 * rng()) * tfVolMult;
      let midLevM  = (0.025 + 0.024 * rng()) * tfVolMult;
      let lowLevM  = (0.018 + 0.020 * rng()) * tfVolMult;

      for (let m = 0; m < magnets.length; m++) {
        const mag = magnets[m];
        const distRatio = Math.abs(binPrice - mag.price) / (binStep * 2.2);
        if (distRatio < 2.6) {
          const weight = Math.exp(-0.5 * distRatio * distRatio);
          const addedM = (mag.volM * 0.34) * weight;
          if (mag.tier.indexOf('50x') !== -1) {
            highLevM += addedM * 0.72;
            midLevM  += addedM * 0.22;
            lowLevM  += addedM * 0.06;
          } else if (mag.tier.indexOf('20x') !== -1) {
            highLevM += addedM * 0.22;
            midLevM  += addedM * 0.63;
            lowLevM  += addedM * 0.15;
          } else {
            highLevM += addedM * 0.08;
            midLevM  += addedM * 0.32;
            lowLevM  += addedM * 0.60;
          }
        }
      }

      let domTier = '20x – 50x';
      if (highLevM >= midLevM && highLevM >= lowLevM) domTier = '50x – 100x';
      else if (lowLevM > midLevM && lowLevM > highLevM) domTier = '10x – 20x';

      const rowSeries = new Float32Array(numCols);
      for (let c = 0; c < numCols; c++) {
        const ageFactor = 0.32 + (c / (numCols - 1)) * 0.68;
        const candle = candles[c];
        const sweptEarlier = c < numCols - 4 && binPrice >= candle.low && binPrice <= candle.high;
        const wickAtten = sweptEarlier ? 0.38 : 1.0;
        const wave = 0.88 + 0.12 * Math.sin(c * 0.4 + b * 0.7);
        rowSeries[c] = ageFactor * wickAtten * wave;
      }

      bins.push({
        index: b,
        price: binPrice,
        side: side,
        highLevM: highLevM,
        midLevM: midLevM,
        lowLevM: lowLevM,
        domTier: domTier,
        rowSeries: rowSeries
      });
    }

    return {
      symbol: symbol,
      baseAsset: baseAsset,
      timeframe: timeframe,
      currentPrice: currentPrice,
      oiM: oiM,
      vol24hUsd: vol24hUsd,
      vol24hBase: vol24hBase,
      marketCap: marketCap,
      shortPositionM: shortPositionM,  // = OI (Long Notional = Short Notional = OI)
      longPositionM: longPositionM,    // = OI
      longRatio: longRatio,            // Account sentiment ratio
      shortRatio: shortRatio,          // Account sentiment ratio
      hasRealLsData: hasRealLsData,    // Whether L/S data is real or default 50/50
      fundingIsReal: fundingIsReal,    // Whether funding rate is real or zero default
      oiToMcapPct: oiToMcapPct,
      isRecommended: isRecommended,
      recommendationType: recommendationType,
      fundingPct: fundingPct,
      high24h: high24h,
      low24h: low24h,
      totalShortPoolM: totalShortPoolM,  // Overhead short liquidation pool (NOT notional)
      totalLongPoolM: totalLongPoolM,    // Downside long liquidation pool (NOT notional)
      magnets: magnets,
      minPrice: minPrice,
      maxPrice: maxPrice,
      binStep: binStep,
      candles: candles,
      bins: bins,
      sourceLabel: sourceLabel,
      isLive: isLive
    };
  }

  function getBinPoolM(bin, levFilter) {
    if (levFilter === 'high') return bin.highLevM;
    if (levFilter === 'mid')  return bin.midLevM;
    return bin.highLevM + bin.midLevM + bin.lowLevM;
  }

  // ---------------------------------------------------------------------------
  // 3. CANVAS RENDERER
  // ---------------------------------------------------------------------------
  function drawHeatmapCanvas(canvas, stage, tooltip, appState) {
    const m = appState.model;
    if (!canvas || !stage || !m) return;

    const rect = stage.getBoundingClientRect();
    const width = Math.max(280, Math.floor(rect.width));
    const height = Math.max(240, Math.floor(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 3);

    if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
    }

    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const padLeft = width < 480 ? 58 : 72;
    const padRight = 10;
    const padTop = 18;
    const padBottom = 28;
    const splitGap = 6;

    const innerW = Math.max(120, width - padLeft - padRight);
    const heatmapW = Math.floor((innerW - splitGap) * 0.80);
    const profileW = Math.max(38, innerW - splitGap - heatmapW);
    const profileX = padLeft + heatmapW + splitGap;
    const plotH = Math.max(100, height - padTop - padBottom);

    const minP = m.minPrice;
    const maxP = m.maxPrice;
    const spanP = Math.max(1e-9, maxP - minP);

    function priceToY(p) {
      return padTop + plotH - ((p - minP) / spanP) * plotH;
    }

    function yToPrice(y) {
      const ratio = 1 - (y - padTop) / plotH;
      return minP + ratio * spanP;
    }

    // Determine max intensity for normalization
    let maxBinVal = 0.01;
    for (let b = 0; b < m.bins.length; b++) {
      const val = getBinPoolM(m.bins[b], appState.leverageFilter);
      if (val > maxBinVal) maxBinVal = val;
    }

    // 1. THERMAL MATRIX (LEFT 80%)
    const numCols = m.candles.length;
    const colW = heatmapW / numCols;

    ctx.save();
    ctx.beginPath();
    ctx.rect(padLeft, padTop, heatmapW, plotH);
    ctx.clip();

    for (let b = 0; b < m.bins.length; b++) {
      const bin = m.bins[b];
      const topP = bin.price + m.binStep * 0.5;
      const botP = bin.price - m.binStep * 0.5;
      const yTop = priceToY(topP);
      const cellH = Math.max(1, priceToY(botP) - yTop);

      const poolM = getBinPoolM(bin, appState.leverageFilter);
      const normIntensity = Math.pow(poolM / maxBinVal, 0.68);

      const isSwept = (appState.sweepPrice > m.currentPrice && bin.price > m.currentPrice && bin.price <= appState.sweepPrice) ||
                      (appState.sweepPrice < m.currentPrice && bin.price < m.currentPrice && bin.price >= appState.sweepPrice);

      for (let c = 0; c < numCols; c++) {
        const xLeft = padLeft + c * colW;
        if (isSwept && c >= numCols - 5) {
          ctx.fillStyle = 'rgba(248, 250, 252, 0.25)';
        } else {
          ctx.fillStyle = thermalRgba(normIntensity * bin.rowSeries[c]);
        }
        ctx.fillRect(xLeft, yTop, colW + 0.4, cellH + 0.4);
      }
    }

    // Sweep Zone Shading
    if (Math.abs(appState.sweepPrice - m.currentPrice) > m.binStep * 0.15) {
      const ySpot = priceToY(m.currentPrice);
      const yTarget = priceToY(appState.sweepPrice);
      ctx.fillStyle = appState.sweepPrice > m.currentPrice
        ? 'rgba(244, 63, 94, 0.18)'
        : 'rgba(6, 182, 212, 0.18)';
      ctx.fillRect(padLeft, Math.min(ySpot, yTarget), heatmapW, Math.abs(yTarget - ySpot));
    }

    // 2. OVERLAY 40 OHLC CANDLESTICKS
    for (let c = 0; c < numCols; c++) {
      const candle = m.candles[c];
      const cx = padLeft + (c + 0.5) * colW;
      const yH = priceToY(candle.high);
      const yL = priceToY(candle.low);
      const yO = priceToY(candle.open);
      const yC = priceToY(candle.close);
      const isUp = candle.close >= candle.open;

      // Wick
      ctx.strokeStyle = isUp ? 'rgba(52, 211, 153, 0.85)' : 'rgba(251, 113, 133, 0.85)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(cx, yH);
      ctx.lineTo(cx, yL);
      ctx.stroke();

      // Candle Body
      const bTop = Math.min(yO, yC);
      const bH = Math.max(1.8, Math.abs(yC - yO));
      const bW = Math.max(2.2, colW * 0.58);
      ctx.fillStyle = isUp ? '#10b981' : '#f43f5e';
      ctx.fillRect(cx - bW / 2, bTop, bW, bH);
    }
    ctx.restore();

    // 3. RIGHT PANEL (20%): LIQUIDITY PROFILE HISTOGRAM
    ctx.save();
    ctx.fillStyle = 'rgba(9, 14, 26, 0.88)';
    ctx.fillRect(profileX, padTop, profileW, plotH);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    ctx.strokeRect(profileX, padTop, profileW, plotH);

    ctx.beginPath();
    ctx.rect(profileX, padTop, profileW, plotH);
    ctx.clip();

    for (let b = 0; b < m.bins.length; b++) {
      const bin = m.bins[b];
      const topP = bin.price + m.binStep * 0.5;
      const botP = bin.price - m.binStep * 0.5;
      const yTop = priceToY(topP);
      const barH = Math.max(1.2, priceToY(botP) - yTop - 0.5);
      const poolM = getBinPoolM(bin, appState.leverageFilter);
      const barW = Math.max(2, (poolM / maxBinVal) * (profileW - 6));

      const isSwept = (appState.sweepPrice > m.currentPrice && bin.price > m.currentPrice && bin.price <= appState.sweepPrice) ||
                      (appState.sweepPrice < m.currentPrice && bin.price < m.currentPrice && bin.price >= appState.sweepPrice);

      if (isSwept) {
        ctx.fillStyle = 'rgba(248, 250, 252, 0.82)';
      } else if (bin.side === 'SHORT') {
        ctx.fillStyle = poolM > maxBinVal * 0.62 ? '#f43f5e' : '#f59e0b';
      } else {
        ctx.fillStyle = poolM > maxBinVal * 0.62 ? '#34d399' : '#06b6d4';
      }
      ctx.fillRect(profileX + 2, yTop, barW, barH);
    }
    ctx.restore();

    // 4. HORIZONTAL Y-AXIS GRIDLINES & LABELS
    const ySteps = 6;
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    for (let s = 0; s <= ySteps; s++) {
      const ratio = s / ySteps;
      const pVal = minP + ratio * spanP;
      const yPos = priceToY(pVal);

      ctx.strokeStyle = 'rgba(30, 41, 59, 0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padLeft, yPos);
      ctx.lineTo(padLeft + heatmapW, yPos);
      ctx.stroke();

      ctx.fillStyle = '#94a3b8';
      ctx.fillText(D.formatAxisPrice(pVal), padLeft - 6, yPos);
    }

    // X-axis timeline labels
    const tfTags = m.timeframe === '24H'
      ? ['-24h', '-18h', '-12h', '-6h', 'Now']
      : m.timeframe === '3D'
      ? ['-72h', '-54h', '-36h', '-18h', 'Now']
      : ['-7d', '-5d', '-3.5d', '-1.5d', 'Now'];

    ctx.fillStyle = '#94a3b8';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let i = 0; i < tfTags.length; i++) {
      const lx = padLeft + (i / (tfTags.length - 1)) * heatmapW;
      ctx.fillText(tfTags[i], lx, padTop + plotH + 8);
    }

    // Right histogram header label
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 9px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('LIQ POOL', profileX + profileW / 2, 5);

    // 5. CURRENT PRICE LINE & SWEEP PRICE LINE
    const ySpotLine = priceToY(m.currentPrice);
    if (ySpotLine >= padTop && ySpotLine <= padTop + plotH) {
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = '#f8fafc';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(padLeft, ySpotLine);
      ctx.lineTo(profileX + profileW, ySpotLine);
      ctx.stroke();
      ctx.restore();

      // Spot Price Pill on Left Y-Axis
      ctx.fillStyle = '#10b981';
      ctx.fillRect(3, ySpotLine - 9, padLeft - 6, 18);
      ctx.fillStyle = '#04130d';
      ctx.font = 'bold 9.5px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(D.formatAxisPrice(m.currentPrice), 3 + (padLeft - 6) / 2, ySpotLine);
    }

    if (Math.abs(appState.sweepPrice - m.currentPrice) > m.binStep * 0.15) {
      const ySweepLine = priceToY(appState.sweepPrice);
      if (ySweepLine >= padTop && ySweepLine <= padTop + plotH) {
        const sweepCol = appState.sweepPrice > m.currentPrice ? '#fb7185' : '#22d3ee';
        ctx.save();
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = sweepCol;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(padLeft, ySweepLine);
        ctx.lineTo(profileX + profileW, ySweepLine);
        ctx.stroke();
        ctx.restore();

        ctx.fillStyle = sweepCol;
        ctx.fillRect(3, ySweepLine - 9, padLeft - 6, 18);
        ctx.fillStyle = '#060912';
        ctx.font = 'bold 9.5px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(D.formatAxisPrice(appState.sweepPrice), 3 + (padLeft - 6) / 2, ySweepLine);
      }
    }

    appState.layoutCache = {
      width: width,
      height: height,
      padLeft: padLeft,
      padTop: padTop,
      heatmapW: heatmapW,
      profileX: profileX,
      profileW: profileW,
      plotH: plotH,
      yToPrice: yToPrice
    };

    // 6. CROSSHAIR & FLOATING TOOLTIP
    if (appState.hoverPos && appState.layoutCache && tooltip) {
      renderCrosshairTooltip(ctx, appState.hoverPos, appState.layoutCache, tooltip, appState);
    } else if (tooltip) {
      tooltip.classList.add('hidden');
    }

    ctx.restore();
  }

  function renderCrosshairTooltip(ctx, pos, layout, tooltip, appState) {
    const m = appState.model;
    const cx = Math.max(layout.padLeft, Math.min(layout.profileX + layout.profileW, pos.x));
    const cy = Math.max(layout.padTop, Math.min(layout.padTop + layout.plotH, pos.y));
    const hoverPrice = layout.yToPrice(cy);

    let nearestBin = m.bins[0];
    let bestDist = Infinity;
    for (let b = 0; b < m.bins.length; b++) {
      const d = Math.abs(m.bins[b].price - hoverPrice);
      if (d < bestDist) {
        bestDist = d;
        nearestBin = m.bins[b];
      }
    }

    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = 'rgba(248, 250, 252, 0.72)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(layout.padLeft, cy);
    ctx.lineTo(layout.profileX + layout.profileW, cy);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(cx, layout.padTop);
    ctx.lineTo(cx, layout.padTop + layout.plotH);
    ctx.stroke();
    ctx.restore();

    const poolM = getBinPoolM(nearestBin, appState.leverageFilter);
    const tokenQty = (poolM * 1e6) / Math.max(1e-8, hoverPrice);
    const isShort = hoverPrice >= m.currentPrice;
    const pctFromSpot = ((hoverPrice - m.currentPrice) / m.currentPrice) * 100;
    const sign = pctFromSpot >= 0 ? '+' : '';

    // Calculate percentage of 24h Perpetual Volume and Market Cap
    const vol24hUsd = m.vol24hUsd || 1e6;
    const pctOfPerpVol = ((poolM * 1e6) / vol24hUsd) * 100;
    const mcapUsd = m.marketCap || 1e6;
    const pctOfMcap = ((poolM * 1e6) / mcapUsd) * 100;

    let tierText = nearestBin.domTier;
    if (appState.leverageFilter === 'high') tierText = '50x – 100x';
    if (appState.leverageFilter === 'mid')  tierText = '10x – 25x';

    tooltip.innerHTML =
      '<div class="tip-title mono">' +
        '<span>' + D.formatPrice(hoverPrice) + '</span>' +
        '<span class="' + (isShort ? 'text-rose' : 'text-cyan') + '">' + sign + pctFromSpot.toFixed(2) + '%</span>' +
      '</div>' +
      '<div class="tip-line">' +
        '<span style="color: var(--text-secondary);">Cluster Type:</span>' +
        '<span class="' + (isShort ? 'text-rose' : 'text-cyan') + ' font-bold">' + (isShort ? 'Short Liq (Overhead)' : 'Long Liq (Downside)') + '</span>' +
      '</div>' +
      '<div class="tip-line mono">' +
        '<span style="color: var(--text-secondary);">Liq Density:</span>' +
        '<span class="text-amber font-bold">' + D.formatUsdCompact(poolM) + ' (' + D.formatTokenCompact(tokenQty, m.baseAsset) + ')</span>' +
      '</div>' +
      '<div class="tip-line mono">' +
        '<span style="color: var(--text-secondary);">% of 24h Perp Vol:</span>' +
        '<span class="text-cyan font-bold">' + pctOfPerpVol.toFixed(2) + '%</span>' +
      '</div>' +
      '<div class="tip-line mono">' +
        '<span style="color: var(--text-secondary);">% of Market Cap:</span>' +
        '<span class="' + (pctOfMcap >= 5 ? 'text-rose font-bold' : 'text-emerald') + '">' + pctOfMcap.toFixed(2) + '%</span>' +
      '</div>' +
      '<div class="tip-line mono">' +
        '<span style="color: var(--text-secondary);">Dominant Lev:</span>' +
        '<span class="font-bold">' + tierText + '</span>' +
      '</div>';

    tooltip.classList.remove('hidden');

    const tipW = tooltip.offsetWidth || 250;
    const tipH = tooltip.offsetHeight || 125;
    let left = cx + 14;
    if (left + tipW > layout.width - 10) {
      left = Math.max(layout.padLeft + 6, cx - tipW - 14);
    }
    let top = cy - tipH / 2;
    top = Math.max(10, Math.min(layout.height - tipH - 10, top));
    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
  }

  // Expose to global namespace
  global.ScannerHeatmap = {
    buildLiquidationModel: buildLiquidationModel,
    getBinPoolM: getBinPoolM,
    drawHeatmapCanvas: drawHeatmapCanvas
  };

})(window);
