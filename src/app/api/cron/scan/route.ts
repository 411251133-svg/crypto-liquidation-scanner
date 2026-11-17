import { NextResponse } from "next/server";
import { dataFetcher, normalizeSymbol } from "@/lib/adapters";
import { ScanResult } from "@/lib/types";
import { checkCooldown, recordAlert } from "@/lib/redis";

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization");
    const secret = process.env.CRON_SECRET || "super-secret-cron-token-123";
    if (!authHeader || authHeader !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized: Invalid CRON_SECRET" }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const symbols = body.symbols || ["BTC", "ETH", "SOL", "PEPE", "DOGE", "AVAX", "LINK", "NEAR", "RENDER", "SUI", "AR", "FET", "INJ", "TIA"];
    const results: ScanResult[] = [];
    const errors: { symbol: string; message: string }[] = [];
    for (const rawSym of symbols) {
      try {
        const symbol = normalizeSymbol(rawSym);
        const [fundingInfo, markPrice] = await Promise.all([dataFetcher.getFundingInfo(symbol), dataFetcher.getMarkPrice(symbol)]);
        const fundingRateNum = fundingInfo.fundingRate24h;
        if (fundingRateNum <= 0.0005) continue;
        const [oi, oiHist, mcap, spotInfo, positioning] = await Promise.all([dataFetcher.getOpenInterest(symbol), dataFetcher.getOiHistory(symbol), dataFetcher.getMarketCap(symbol), dataFetcher.getSpotVolume(symbol), dataFetcher.getPositioning(symbol)]);
        if (mcap === null) continue;
        const prevOi = oiHist.length > 24 ? oiHist[oiHist.length - 25] : (oiHist[0] || oi);
        const oi24hChange = prevOi ? ((oi - prevOi) / prevOi) * 100 : 0;
        const oiToMarketCap = ((oi * markPrice) / mcap) * 100;
        if (oiToMarketCap > 25 && oi24hChange > 100) {
          if (await checkCooldown(symbol, oi24hChange, fundingRateNum * 100)) continue;
          await recordAlert(symbol);
          const result: ScanResult = { symbol, oiToMarketCap, oi24hChange, fundingRate: fundingRateNum * 100, fundingInterval: fundingInfo.interval, perpSpotRatio: spotInfo.volume > 0 ? (oi * markPrice) / spotInfo.volume : 1, whaleRatio: positioning.whale, topTraderRatio: positioning.topTrader, retailRatio: positioning.retail, nearestSqueeze: markPrice * 1.03, furthestSqueeze: markPrice * 1.09, longFlush: markPrice * 0.95, setupTag: positioning.topTrader > 1.2 ? "Short Squeeze Fuel" : "Long Flush Risk", timestamp: Date.now() };
          results.push(result);
          await dispatchWebhooks(result);
        }
      } catch (e) {
        errors.push({ symbol: String(rawSym), message: e instanceof Error ? e.message : "Upstream data unavailable" });
      }
    }
    return NextResponse.json({ success: errors.length === 0, count: results.length, results, errors, dataStatus: errors.length ? "degraded" : "live" }, { status: errors.length && results.length === 0 ? 503 : 200 });
  } catch (e: any) { return NextResponse.json({ error: e.message || "Internal Server Error" }, { status: 500 }); }
}

async function dispatchWebhooks(r: ScanResult) {
  const discordUrl = process.env.DISCORD_WEBHOOK_URL;
  const tgToken = process.env.TELEGRAM_BOT_TOKEN;
  const tgChat = process.env.TELEGRAM_CHAT_ID;
  const text = `🚨 *${r.setupTag}* (${r.symbol}USDT)\n• OI / MCap: *${r.oiToMarketCap.toFixed(1)}%*\n• 24h OI Jump: *+${r.oi24hChange.toFixed(1)}%*\n• Funding: *+${r.fundingRate.toFixed(4)}%* (${r.fundingInterval})\n• Whale Ratio: *${r.whaleRatio.toFixed(2)}*\n• Nearest Squeeze: *$${r.nearestSqueeze.toFixed(2)}*\n[Open Binance Futures](https://www.binance.com/en/futures/${r.symbol}USDT)`;
  if (discordUrl) try { await fetch(discordUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ embeds: [{ title: `🚨 ${r.setupTag}: ${r.symbol}USDT`, color: 16761035, description: text.replace(/\*/g, "**"), timestamp: new Date().toISOString() }] }) }); } catch {}
  if (tgToken && tgChat) try { await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: tgChat, text, parse_mode: "Markdown" }) }); } catch {}
}
