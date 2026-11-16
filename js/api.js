/**
 * Crypto Liquidation Heatmap Scanner - Exchange API Client
 * Supports Gate.io (1,050+ perpetual pairs with live 24h volume & klines),
 * Binance Futures, OKX, and optional Coinglass v3.
 */
(function (global) {
  'use strict';

  async function fetchWithTimeout(url, options, timeoutMs) {
    const timeout = timeoutMs || 3000;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(function () { controller.abort(); }, timeout) : null;
    const fetchOpts = Object.assign({}, options || {});
    if (controller) fetchOpts.signal = controller.signal;
    try {
      const res = await fetch(url, fetchOpts);
      if (timer) clearTimeout(timer);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (err) {
      if (timer) clearTimeout(timer);
      throw err;
    }
  }

  /**
   * Fetches the complete perpetual markets directory (1,050+ pairs)
   * Populates symbol, price, 24h perpetual volume, and 24h price change.
   * Filters out synthetic stock/ETF tokens and low-quality tickers.
   */

  // Blacklist: synthetic stock/ETF tokens and known non-crypto tickers on Gate.io
  const STOCK_ETF_BLACKLIST = {
    'NVDA':1,'TSLA':1,'AAPL':1,'AMZN':1,'GOOGL':1,'GOOG':1,'MSFT':1,'META':1,
    'NFLX':1,'AMD':1,'INTC':1,'COIN':1,'MSTR':1,'PLTR':1,'GME':1,'AMC':1,
    'BABA':1,'PYPL':1,'DIS':1,'BA':1,'PFE':1,'NKE':1,'UBER':1,'ABNB':1,
    'SNAP':1,'RBLX':1,'SQ':1,'SHOP':1,'SPOT':1,'PINS':1,'ROKU':1,'TWLO':1,
    'ZM':1,'DOCU':1,'CRWD':1,'NET':1,'DDOG':1,'SNOW':1,'U':1,'HOOD':1,
    'SOFI':1,'RIVN':1,'LCID':1,'NIO':1,'XPEV':1,'LI':1,'F':1,'GM':1,
    'QQQ':1,'SPY':1,'TQQQ':1,'SQQQ':1,'IWM':1,'DIA':1,'VTI':1,'VOO':1,
    'XLF':1,'XLE':1,'XLK':1,'GLD':1,'SLV':1,'USO':1,'TLT':1,'HYG':1,
    // Gate.io ON-suffixed synthetic stock wrappers
    'NVDAON':1,'TSLAON':1,'AAPLON':1,'AMZNON':1,'GOOGLON':1,'MSFTON':1,
    'NFLXON':1,'COINON':1,'MSTRON':1,'HOODON':1,'SBETON':1,'CVXON':1,
    'TSLAX':1,'AAPLX':1,'AMZNX':1,'NVDAX':1,'GOOGX':1,'NFLXX':1,
    'TQQQX':1,'QQQX':1,'QQQON':1,'SPCXON':1,'SPCX':1,'SPCXX':1,
    'SPYON':1,'SPYX':1,'HOODX':1,'IEFAON':1,'AGGON':1,'CRCLX':1,
    'YLD8ON':1,'YLD5ON':1,'ACNON':1,'ACNX':1,'ACN1':1,'CMCSAX':1,
    'BLKDIGON':1,'BLKHION':1,'BLKGRWON':1,'BTGOON':1,'CRCLON':1,
    'MAG7XON':1,'MAG7SSI':1,'SLVON':1,'GLDX':1,'ABBVX':1,'IAUON':1,
    'PGON':1,'METAON':1,'MAON':1,'BABAON':1,'CVAULTCORE':1,
    'PLTRON':1,'LLYON':1,'LMTON':1,'UNHON':1,'UNHX':1,'OPENAI':1,
    'JPMON':1,'PEPON':1,'AZNX':1,'ABTX':1,'DHRX':1,'VTIX':1
  };

  function isBlacklistedTicker(baseAsset) {
    if (STOCK_ETF_BLACKLIST[baseAsset]) return true;
    // Also filter common patterns: ends with ON/X and is a known stock pattern
    if (/^[A-Z]{2,5}(ON|X)$/.test(baseAsset) && STOCK_ETF_BLACKLIST[baseAsset.replace(/(ON|X)$/, '')]) return true;
    return false;
  }

  async function fetchAllMarkets() {
    // 1. Primary: Gate.io Futures Public API (CORS enabled, 1,050+ perpetual contracts)
    try {
      const gateTickers = await fetchWithTimeout('https://api.gateio.ws/api/v4/futures/usdt/tickers', {}, 3500);
      if (Array.isArray(gateTickers) && gateTickers.length > 50) {
        const catalog = [];
        for (let i = 0; i < gateTickers.length; i++) {
          const t = gateTickers[i];
          const contract = t.contract || '';
          if (!contract.endsWith('_USDT')) continue;

          const baseAsset = contract.replace('_USDT', '');
          const symbol = baseAsset + 'USDT';

          // Skip synthetic stock/ETF tokens
          if (isBlacklistedTicker(baseAsset)) continue;

          const price = parseFloat(t.last || t.mark_price || '0');
          const vol24hUsd = parseFloat(t.volume_24h_quote || t.volume_24h_settle || '0');
          const vol24hBase = parseFloat(t.volume_24h_base || '0');
          const changePct = parseFloat(t.change_percentage || '0');
          const high24h = parseFloat(t.high_24h || '0');
          const low24h = parseFloat(t.low_24h || '0');
          const fundingRate = parseFloat(t.funding_rate || t.funding_rate_indicative || '0');

          if (price > 0) {
            const mcap = global.ScannerData.getMarketCap(symbol, price);
            const oiEstimatedM = t.total_size ? (parseFloat(t.total_size) * parseFloat(t.quanto_multiplier || '1') * price) / 1e6 : 0;
            const oiToMcap = mcap > 0 ? ((oiEstimatedM * 1e6) / mcap) * 100 : 0;

            catalog.push({
              symbol: symbol,
              contract: contract,
              baseAsset: baseAsset,
              name: baseAsset,
              price: price,
              vol24hUsd: vol24hUsd,
              vol24hBase: vol24hBase,
              change24h: changePct,
              high24h: high24h,
              low24h: low24h,
              fundingPct: fundingRate * 100,
              fundingIsReal: (t.funding_rate !== undefined && t.funding_rate !== null && t.funding_rate !== ''),
              oiM: oiEstimatedM,
              marketCap: mcap,
              oiToMcapPct: oiToMcap,
              source: 'gate'
            });
          }
        }

        // Sort descending by 24h perpetual volume
        catalog.sort(function (a, b) {
          return b.vol24hUsd - a.vol24hUsd;
        });

        if (catalog.length > 0) {
          return catalog;
        }
      }
    } catch (gateErr) {
      // Fallback to Binance
    }

    // 2. Secondary: Binance Futures 24hr Ticker API
    try {
      const binanceTickers = await fetchWithTimeout('https://fapi.binance.com/fapi/v1/ticker/24hr', {}, 3500);
      if (Array.isArray(binanceTickers) && binanceTickers.length > 30) {
        const catalog = [];
        for (let i = 0; i < binanceTickers.length; i++) {
          const t = binanceTickers[i];
          const symbol = t.symbol || '';
          if (!symbol.endsWith('USDT')) continue;

          const baseAsset = symbol.replace('USDT', '');
          const price = parseFloat(t.lastPrice || '0');
          const vol24hUsd = parseFloat(t.quoteVolume || '0');
          const vol24hBase = parseFloat(t.volume || '0');
          const changePct = parseFloat(t.priceChangePercent || '0');
          const high24h = parseFloat(t.highPrice || '0');
          const low24h = parseFloat(t.lowPrice || '0');

          if (price > 0) {
            const mcap = global.ScannerData.getMarketCap(symbol, price);
            const oiEstimatedM = 0; // No OI data from Binance ticker, will be enriched by openInterest endpoint
            const oiToMcap = mcap > 0 ? ((oiEstimatedM * 1e6) / mcap) * 100 : 0;

            catalog.push({
              symbol: symbol,
              contract: baseAsset + '_USDT',
              baseAsset: baseAsset,
              name: baseAsset,
              price: price,
              vol24hUsd: vol24hUsd,
              vol24hBase: vol24hBase,
              change24h: changePct,
              high24h: high24h,
              low24h: low24h,
              fundingPct: 0,
              oiM: oiEstimatedM,
              marketCap: mcap,
              oiToMcapPct: oiToMcap,
              source: 'binance'
            });
          }
        }

        catalog.sort(function (a, b) {
          return b.vol24hUsd - a.vol24hUsd;
        });

        if (catalog.length > 0) {
          return catalog;
        }
      }
    } catch (binanceErr) {
      // Fallback to offline catalog
    }

    // 3. Fallback: Pre-bundled catalog from ScannerData
    return (global.ScannerData && global.ScannerData.PRESET_MARKETS) || [];
  }

  /**
   * Fetches detailed perpetual data for a specific pair:
   * Price, 24h Volume, Open Interest, Funding Rate, and 40 Candlesticks.
   */
  /**
   * Fetches official liquidation heatmap & cluster data from Coinglass API (V4 / V2).
   * Supports aggregated & exchange-specific endpoints (Binance, OKX).
   */
  async function fetchCoinglassLiquidationMap(symbol, timeframe, apiKey) {
    if (!apiKey) return null;
    const baseAsset = global.ScannerData.getBaseAsset(symbol);
    const range = timeframe === '24H' ? '24h' : timeframe === '3D' ? '3d' : '7d';

    const headers = {
      'coinglassSecret': apiKey,
      'CG-API-KEY': apiKey,
      'accept': 'application/json'
    };

    // 1. Try Coinglass V4 Heatmap Model 2 (Official high-res array format)
    try {
      const url = 'https://open-api-v4.coinglass.com/api/futures/liquidation/heatmap/model2?exchange=Binance&symbol=' + symbol + '&range=' + range;
      const res = await fetchWithTimeout(url, { headers: headers }, 4000);
      if (res && res.code === '0' && res.data) {
        return parseCoinglassResponse(res.data, symbol, baseAsset, timeframe);
      }
    } catch (e1) {}

    // 2. Try Coinglass V2 liqHeatmap fallback
    try {
      const urlV2 = 'https://open-api.coinglass.com/public/v2/liqHeatmap?exchange=Binance&symbol=' + symbol + '&type=' + range;
      const resV2 = await fetchWithTimeout(urlV2, { headers: headers }, 4000);
      if (resV2 && (resV2.code === '0' || resV2.success) && resV2.data) {
        return parseCoinglassResponse(resV2.data, symbol, baseAsset, timeframe);
      }
    } catch (e2) {}

    // 3. Try Coinglass V4 Aggregated Model 1
    try {
      const urlAgg = 'https://open-api-v4.coinglass.com/api/futures/liquidation/aggregated-heatmap/model1?symbol=' + baseAsset + '&range=' + range;
      const resAgg = await fetchWithTimeout(urlAgg, { headers: headers }, 4000);
      if (resAgg && resAgg.code === '0' && resAgg.data) {
        return parseCoinglassResponse(resAgg.data, symbol, baseAsset, timeframe);
      }
    } catch (e3) {}

    return null;
  }

  function parseCoinglassResponse(data, symbol, baseAsset, timeframe) {
    const yAxis = data.y_axis || [];
    const liqData = data.liquidation_leverage_data || [];
    const candlesRaw = data.price_candlesticks || [];

    const candles = candlesRaw.map(function (c, idx) {
      return {
        index: idx,
        time: (c[0] > 1e11 ? c[0] : c[0] * 1000),
        open: parseFloat(c[1] || '0'),
        high: parseFloat(c[2] || '0'),
        low: parseFloat(c[3] || '0'),
        close: parseFloat(c[4] || '0'),
        volBase: 0,
        volUsd: parseFloat(c[5] || '0')
      };
    });

    const currentPrice = candles.length > 0
      ? candles[candles.length - 1].close
      : (yAxis.length > 0 ? yAxis[Math.floor(yAxis.length / 2)] : 1);

    let shortPoolUsd = 0;
    let longPoolUsd = 0;
    const priceBuckets = {};

    liqData.forEach(function (node) {
      const yIdx = node[1];
      const intensity = parseFloat(node[2] || '0');
      const p = yAxis[yIdx] || 0;
      if (p > 0 && intensity > 0) {
        if (p > currentPrice) {
          shortPoolUsd += intensity;
        } else {
          longPoolUsd += intensity;
        }
        priceBuckets[p] = (priceBuckets[p] || 0) + intensity;
      }
    });

    const sortedPrices = Object.keys(priceBuckets).sort(function (a, b) {
      return priceBuckets[b] - priceBuckets[a];
    });

    const topClusters = sortedPrices.slice(0, 6).map(function (pStr) {
      const p = parseFloat(pStr);
      const isShort = p > currentPrice;
      const volM = priceBuckets[p] / 1e6;
      return {
        type: isShort ? 'Short Liquidation Magnet' : 'Long Liquidation Magnet',
        side: isShort ? 'SHORT' : 'LONG',
        price: p,
        volM: Number(volM.toFixed(2)),
        tier: 'Coinglass V4 Live'
      };
    });

    const oiM = (shortPoolUsd + longPoolUsd) > 0 ? (shortPoolUsd + longPoolUsd) / 1e6 : 100;

    return {
      symbol: symbol,
      baseAsset: baseAsset,
      price: currentPrice,
      vol24hUsd: (shortPoolUsd + longPoolUsd) * 2.5,
      oiM: oiM,
      marketCap: global.ScannerData.getMarketCap(symbol, currentPrice),
      fundingPct: -0.005,
      high24h: currentPrice * 1.04,
      low24h: currentPrice * 0.96,
      candles: candles,
      customClusters: topClusters,
      totalShortPoolM: shortPoolUsd / 1e6,
      totalLongPoolM: longPoolUsd / 1e6,
      sourceLabel: 'Coinglass V4 Live Heatmap',
      isLive: true,
      isCoinglass: true
    };
  }

  /**
   * Fetches real-time Long/Short position ratios from Coinglass (V4 / V2) or Exchange Contract Stats.
   */
  async function fetchCoinglassLongShortRatio(symbol, apiKey) {
    const baseAsset = global.ScannerData.getBaseAsset(symbol);

    // 1. If Coinglass API Key provided, query Coinglass V4 top-trader long/short position ratio
    if (apiKey) {
      const headers = {
        'coinglassSecret': apiKey,
        'CG-API-KEY': apiKey,
        'accept': 'application/json'
      };

      try {
        const urlV4 = 'https://open-api-v4.coinglass.com/api/futures/top-long-short-position-ratio/history?exchange=Binance&symbol=' + symbol + '&interval=1h&limit=1';
        const res = await fetchWithTimeout(urlV4, { headers: headers }, 3500);
        if (res && res.code === '0' && Array.isArray(res.data) && res.data[0]) {
          const item = res.data[0];
          let lRatio = parseFloat(item.longRatio || item.long_ratio || '0.5');
          let sRatio = parseFloat(item.shortRatio || item.short_ratio || '0.5');
          if (lRatio > 1) lRatio /= 100.0;
          if (sRatio > 1) sRatio /= 100.0;
          return { longRatio: lRatio, shortRatio: sRatio, source: 'Coinglass V4 Top Position Ratio' };
        }
      } catch (e1) {}

      try {
        const urlGlobal = 'https://open-api-v4.coinglass.com/api/futures/global-long-short-account-ratio/history?exchange=Binance&symbol=' + symbol + '&interval=1h&limit=1';
        const resG = await fetchWithTimeout(urlGlobal, { headers: headers }, 3500);
        if (resG && resG.code === '0' && Array.isArray(resG.data) && resG.data[0]) {
          const item = resG.data[0];
          let lRatio = parseFloat(item.longRatio || item.long_ratio || '0.5');
          let sRatio = parseFloat(item.shortRatio || item.short_ratio || '0.5');
          if (lRatio > 1) lRatio /= 100.0;
          if (sRatio > 1) sRatio /= 100.0;
          return { longRatio: lRatio, shortRatio: sRatio, source: 'Coinglass V4 Global Account Ratio' };
        }
      } catch (e2) {}

      try {
        const urlV2 = 'https://open-api.coinglass.com/public/v2/long_short?symbol=' + baseAsset + '&time_type=h1';
        const resV2 = await fetchWithTimeout(urlV2, { headers: headers }, 3500);
        if (resV2 && (resV2.code === '0' || resV2.success) && Array.isArray(resV2.data) && resV2.data[0]) {
          const item = resV2.data[0];
          let lRatio = parseFloat(item.longRate || item.longRatio || '50') / 100.0;
          let sRatio = parseFloat(item.shortRate || item.shortRatio || '50') / 100.0;
          return { longRatio: lRatio, shortRatio: sRatio, source: 'Coinglass V2 Long/Short Feed' };
        }
      } catch (e3) {}
    }

    // 2. Real-time Exchange Contract Stats (Gate.io Public Perpetual Contract Stats)
    try {
      const statsRes = await fetchWithTimeout('https://api.gateio.ws/api/v4/futures/usdt/contract_stats?contract=' + baseAsset + '_USDT&limit=1', {}, 3000);
      if (Array.isArray(statsRes) && statsRes[0]) {
        const s = statsRes[0];
        const topLong = parseFloat(s.top_long_size || '0');
        const topShort = parseFloat(s.top_short_size || '0');
        const tot = topLong + topShort;
        if (tot > 0) {
          const lRatio = topLong / tot;
          const sRatio = topShort / tot;
          return {
            longRatio: lRatio,
            shortRatio: sRatio,
            openInterestUsd: parseFloat(s.open_interest_usd || '0'),
            source: 'Live Exchange Contract Stats'
          };
        }
      }
    } catch (eStats) {}

    return null;
  }

  async function fetchLivePairData(symbol, timeframe, coinglassKey) {
    // 0. If Coinglass API key is provided, query Coinglass V4/V2 Liquidation Heatmap first
    if (coinglassKey) {
      try {
        const cgData = await fetchCoinglassLiquidationMap(symbol, timeframe, coinglassKey);
        if (cgData) return cgData;
      } catch (cgErr) {
        console.warn('Coinglass live query failed, falling back to exchange live feed:', cgErr);
      }
    }
    const baseAsset = global.ScannerData.getBaseAsset(symbol);
    const gateContract = baseAsset + '_USDT';
    const interval = timeframe === '24H' ? '1h' : timeframe === '3D' ? '2h' : '4h';

    // 1. Try Gate.io Futures (Fast, CORS unblocked, 1,000+ pairs)
    try {
      const [tickerRes, candleRes, lsData] = await Promise.all([
        fetchWithTimeout('https://api.gateio.ws/api/v4/futures/usdt/tickers?contract=' + gateContract, {}, 2500),
        fetchWithTimeout('https://api.gateio.ws/api/v4/futures/usdt/candlesticks?contract=' + gateContract + '&interval=' + interval + '&limit=40', {}, 2500),
        fetchCoinglassLongShortRatio(symbol, coinglassKey)
      ]);

      const tItem = Array.isArray(tickerRes) ? tickerRes[0] : null;
      if (tItem) {
        const lastPrice = parseFloat(tItem.last || tItem.mark_price || '0');
        if (lastPrice > 0) {
          const vol24hUsd = parseFloat(tItem.volume_24h_quote || tItem.volume_24h_settle || '0');
          const vol24hBase = parseFloat(tItem.volume_24h_base || '0');
          const fundingRate = parseFloat(tItem.funding_rate || tItem.funding_rate_indicative || '0');
          const high24h = parseFloat(tItem.high_24h || '0');
          const low24h = parseFloat(tItem.low_24h || '0');

          // Estimate Open Interest USD
          let oiM = 0;
          if (tItem.total_size) {
            const multiplier = parseFloat(tItem.quanto_multiplier || '1');
            const oiTokens = parseFloat(tItem.total_size) * multiplier;
            oiM = (oiTokens * lastPrice) / 1e6;
          }
          if (oiM <= 0) {
            // Fallback: try Gate.io contract stats for real OI
            try {
              const statsRes = await fetchWithTimeout('https://api.gateio.ws/api/v4/futures/usdt/contract_stats?contract=' + gateContract + '&limit=1', {}, 2500);
              if (Array.isArray(statsRes) && statsRes[0] && statsRes[0].open_interest_usd) {
                oiM = parseFloat(statsRes[0].open_interest_usd) / 1e6;
              }
            } catch (e) {}
          }
          if (oiM <= 0) {
            oiM = 0; // No real OI available — do not fabricate
          }

          let candles = null;
          if (Array.isArray(candleRes) && candleRes.length >= 10) {
            candles = candleRes.map(function (c, idx) {
              return {
                index: idx,
                time: (c.t || 0) * 1000,
                open: parseFloat(c.o || '0'),
                high: parseFloat(c.h || '0'),
                low: parseFloat(c.l || '0'),
                close: parseFloat(c.c || '0'),
                volBase: parseFloat(c.v || '0'),
                volUsd: parseFloat(c.sum || '0')
              };
            });
          }

          const longRatio = (lsData && lsData.longRatio) ? lsData.longRatio : null;
          const shortRatio = (lsData && lsData.shortRatio) ? lsData.shortRatio : null;
          const hasRealLsData = (longRatio !== null);

          return {
            symbol: symbol,
            baseAsset: baseAsset,
            price: lastPrice,
            vol24hUsd: vol24hUsd,
            vol24hBase: vol24hBase,
            oiM: oiM,
            longRatio: hasRealLsData ? longRatio : 0.50,
            shortRatio: hasRealLsData ? shortRatio : 0.50,
            hasRealLsData: hasRealLsData,
            fundingIsReal: (fundingRate !== 0),
            marketCap: global.ScannerData.getMarketCap(symbol, lastPrice),
            fundingPct: fundingRate * 100,
            high24h: high24h || lastPrice * 1.03,
            low24h: low24h || lastPrice * 0.97,
            candles: candles,
            sourceLabel: lsData ? lsData.source : 'Gate.io Perpetual Live',
            isLive: true
          };
        }
      }
    } catch (gateErr) {
      // Continue to next provider
    }

    // 2. Try Binance Futures (fapi.binance.com)
    try {
      const [premData, oiData, klinesData, ticker24h] = await Promise.all([
        fetchWithTimeout('https://fapi.binance.com/fapi/v1/premiumIndex?symbol=' + symbol, {}, 2500),
        fetchWithTimeout('https://fapi.binance.com/fapi/v1/openInterest?symbol=' + symbol, {}, 2500),
        fetchWithTimeout('https://fapi.binance.com/fapi/v1/klines?symbol=' + symbol + '&interval=' + interval + '&limit=40', {}, 2500),
        fetchWithTimeout('https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=' + symbol, {}, 2500)
      ]);

      const markPrice = Number(premData && premData.markPrice);
      const fundingRate = Number(premData && premData.lastFundingRate);
      const oiContracts = Number(oiData && oiData.openInterest);

      if (Number.isFinite(markPrice) && markPrice > 0) {
        const oiM = Number.isFinite(oiContracts) && oiContracts > 0
          ? (oiContracts * markPrice) / 1e6
          : 0;

        const vol24hUsd = ticker24h ? parseFloat(ticker24h.quoteVolume || '0') : oiM * 2.5 * 1e6;
        const vol24hBase = ticker24h ? parseFloat(ticker24h.volume || '0') : (vol24hUsd / markPrice);
        const high24h = ticker24h ? parseFloat(ticker24h.highPrice || '0') : markPrice * 1.04;
        const low24h = ticker24h ? parseFloat(ticker24h.lowPrice || '0') : markPrice * 0.96;

        let candles = null;
        if (Array.isArray(klinesData) && klinesData.length >= 10) {
          candles = klinesData.map(function (k, idx) {
            return {
              index: idx,
              time: Number(k[0]),
              open: Number(k[1]),
              high: Number(k[2]),
              low: Number(k[3]),
              close: Number(k[4]),
              volBase: Number(k[5]),
              volUsd: Number(k[7])
            };
          });
        }

        return {
          symbol: symbol,
          baseAsset: baseAsset,
          price: markPrice,
          vol24hUsd: vol24hUsd,
          vol24hBase: vol24hBase,
          oiM: oiM,
          marketCap: global.ScannerData.getMarketCap(symbol, markPrice),
          fundingPct: Number.isFinite(fundingRate) ? fundingRate * 100 : -0.005,
          high24h: high24h,
          low24h: low24h,
          candles: candles,
          sourceLabel: 'Binance Futures Live',
          isLive: true
        };
      }
    } catch (binanceErr) {
      // Continue to OKX
    }

    // 3. Try OKX Swap (okx.com)
    try {
      const instId = baseAsset + '-USDT-SWAP';
      const bar = timeframe === '24H' ? '1H' : timeframe === '3D' ? '2H' : '4H';
      const [tickerRes, oiRes, fundRes, candleRes] = await Promise.all([
        fetchWithTimeout('https://www.okx.com/api/v5/market/ticker?instId=' + instId, {}, 2500),
        fetchWithTimeout('https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=' + instId, {}, 2500),
        fetchWithTimeout('https://www.okx.com/api/v5/public/funding-rate?instId=' + instId, {}, 2500),
        fetchWithTimeout('https://www.okx.com/api/v5/market/candles?instId=' + instId + '&bar=' + bar + '&limit=40', {}, 2500)
      ]);

      const tItem = tickerRes && tickerRes.data && tickerRes.data[0];
      const lastPrice = Number(tItem && tItem.last);
      if (Number.isFinite(lastPrice) && lastPrice > 0) {
        const oiItem = oiRes && oiRes.data && oiRes.data[0];
        const oiUsd = Number(oiItem && (oiItem.oiUsd || (Number(oiItem.oiCcy) * lastPrice)));
        const oiM = Number.isFinite(oiUsd) && oiUsd > 0 ? oiUsd / 1e6 : 0;

        const fItem = fundRes && fundRes.data && fundRes.data[0];
        const fRate = Number(fItem && fItem.fundingRate);
        const vol24hUsd = tItem.volCcy24h ? parseFloat(tItem.volCcy24h) : oiM * 2.2 * 1e6;
        const vol24hBase = tItem.vol24h ? parseFloat(tItem.vol24h) : (vol24hUsd / lastPrice);

        let candles = null;
        if (candleRes && Array.isArray(candleRes.data) && candleRes.data.length >= 10) {
          candles = candleRes.data.slice().reverse().map(function (c, idx) {
            return {
              index: idx,
              time: Number(c[0]),
              open: Number(c[1]),
              high: Number(c[2]),
              low: Number(c[3]),
              close: Number(c[4]),
              volBase: Number(c[5]),
              volUsd: Number(c[6])
            };
          });
        }

        return {
          symbol: symbol,
          baseAsset: baseAsset,
          price: lastPrice,
          vol24hUsd: vol24hUsd,
          vol24hBase: vol24hBase,
          oiM: oiM,
          marketCap: global.ScannerData.getMarketCap(symbol, lastPrice),
          fundingPct: Number.isFinite(fRate) ? fRate * 100 : -0.004,
          high24h: Number(tItem.high24h) || lastPrice * 1.04,
          low24h: Number(tItem.low24h) || lastPrice * 0.96,
          candles: candles,
          sourceLabel: 'OKX Perpetual Live',
          isLive: true
        };
      }
    } catch (okxErr) {
      // Offline fallback
    }

    return null;
  }

  /**
   * Fetches live market capitalizations from Gate.io spot currencies API.
   * Uses /api/v4/spot/currencies which returns per-token accurate MCaps
   * (1930+ coins, CORS-enabled, no symbol collision issues unlike CoinGecko).
   * Enriches global.ScannerData.liveMarketCaps
   */
  /**
   * Fetches live market capitalizations & circulating supplies directly from CoinGecko.
   * Uses CoinGecko markets API (top 750 coins) with Gate.io spot currency backup.
   * Enriches global.ScannerData.liveMarketCaps & global.ScannerData.CIRCULATING_SUPPLIES
   */
  async function fetchLiveMarketCaps() {
    try {
      const p1 = fetchWithTimeout('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1', {}, 6000);
      const p2 = fetchWithTimeout('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=2', {}, 6000);
      const p3 = fetchWithTimeout('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=3', {}, 6000);

      const results = await Promise.allSettled([p1, p2, p3]);
      results.forEach(function (res) {
        if (res.status === 'fulfilled' && Array.isArray(res.value)) {
          res.value.forEach(function (c) {
            const sym = (c.symbol || '').toUpperCase();
            const cid = (c.id || '').toLowerCase();
            const mcap = parseFloat(c.market_cap || '0');
            const supp = parseFloat(c.circulating_supply || '0');

            // Prevent ticker collisions
            if (sym === 'ONE' && cid !== 'harmony') return;
            if (sym === 'TON' && cid !== 'the-open-network') return;

            if (sym && mcap > 0) {
              global.ScannerData.liveMarketCaps[sym] = mcap;
            }
            if (sym && supp > 0) {
              global.ScannerData.CIRCULATING_SUPPLIES[sym] = supp;
            }
          });
        }
      });
    } catch (err) {
      console.warn('CoinGecko live sync error, using verified offline registry:', err);
    }

    // Always guarantee BERA CoinGecko supply and market cap
    if (!global.ScannerData.CIRCULATING_SUPPLIES['BERA']) {
      global.ScannerData.CIRCULATING_SUPPLIES['BERA'] = 365953551;
    }
  }

  // Expose to global namespace
  global.ScannerApi = {
    fetchAllMarkets: fetchAllMarkets,
    fetchLivePairData: fetchLivePairData,
    fetchLiveMarketCaps: fetchLiveMarketCaps,
    _isBlacklisted: isBlacklistedTicker
  };

})(window);
