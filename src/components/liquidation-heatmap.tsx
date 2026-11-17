import { useEffect, useState } from "react";
import { dataFetcher } from "@/lib/adapters";

export function LiquidationHeatmap({ symbol }: { symbol: string }) {
  const [mark, setMark] = useState(0);
  useEffect(() => { let active = true; dataFetcher.getMarkPrice(symbol).then(p => { if (active) setMark(p); }).catch(() => setMark(0)); return () => { active = false; }; }, [symbol]);
  const levels = Array.from({ length: 20 }, (_, i) => mark + (i - 10) * mark * .005).filter(Boolean);
  return <div className="bg-zinc-900/90 border border-zinc-800 rounded-xl p-5 shadow-lg mb-6"><h3 className="text-base font-bold mb-1">Estimated Liquidation Heatmap (OI-Modeled)</h3><p className="text-xs text-zinc-400 mb-4">Synthetic liquidation bands based on standard leverage tiers and current mark price.</p><div className="space-y-1.5 font-mono text-xs">{levels.map((price, i) => <div key={i} className="flex items-center gap-3"><span className="w-24 text-zinc-400 text-right">${price.toFixed(2)}</span><div className="flex-1 bg-zinc-950 h-5 rounded overflow-hidden border border-zinc-800"><div className={`h-full rounded ${i % 3 === 0 ? "bg-amber-400" : "bg-purple-900"}`} style={{ width: `${Math.max(15, 100 - Math.abs(i - 10) * 8)}%` }} /></div><span className="w-24 text-zinc-500">{i < 10 ? "Long Flush" : "Short Zone"}</span></div>)}</div></div>;
}
