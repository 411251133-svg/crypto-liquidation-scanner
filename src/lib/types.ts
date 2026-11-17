// TypeScript interfaces for the application

export interface FundingInfo {
  symbol: string;
  lastFundingRate: string;
  nextFundingTimestamp: number;
  interval: string;
  intervalHours: number;
  fundingRate24h: number;
}

/** Binance USDS-M liquidation price using maintenance margin and cumB. */
export function calcBinanceLiqPrice(params: {
  side: "LONG" | "SHORT";
  entryPrice: number;
  leverage: number;
  qty: number;
  mmr: number;
  cumB: number;
}): number {
  const { side, entryPrice, leverage, qty, mmr, cumB } = params;
  if (leverage <= 0 || qty <= 0 || mmr < 0 || mmr >= 1) {
    throw new Error("Invalid liquidation formula parameters");
  }
  const imr = 1 / leverage;
  return side === "LONG"
    ? (entryPrice * (1 - imr) + cumB / qty) / (1 - mmr)
    : (entryPrice * (1 + imr) - cumB / qty) / (1 + mmr);
}

export interface KpiData {
  markPrice: number;
  priceChange24h: number;
  marketCap: number | null;
  oiToMarketCap: number | null;
  openInterest: number;
  oiChange24h: number;
  futuresVolume24h: number;
  spotVolume24h: number;
  perpSpotRatio: number;
  volumeChange24h: number;
  fundingRate: number;
  fundingInterval: string;
  countdownMs: number;
  hasSpot: boolean;
}

export interface HeatmapLevel { price: number; intensity: number; type: 'purple' | 'green' | 'yellow'; }
export interface PositioningMetrics { whalePositionRatio: number; topTraderAccountRatio: number; retailGlobalRatio: number; divergenceBadge: string | null; }
export interface ScanResult { symbol: string; oiToMarketCap: number; oi24hChange: number; fundingRate: number; fundingInterval: string; perpSpotRatio: number; whaleRatio: number; topTraderRatio: number; retailRatio: number; nearestSqueeze: number; furthestSqueeze: number; longFlush: number; setupTag: "Short Squeeze Fuel" | "Long Flush Risk"; timestamp: number; }
