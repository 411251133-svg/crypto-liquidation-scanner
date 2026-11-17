"use client";

import { useState } from "react";
import { KpiHeaderBar } from "@/components/kpi-header";
import { LiquidationHeatmap } from "@/components/liquidation-heatmap";
import { PositioningPanel } from "@/components/positioning-panel";
import { ScannerPanel } from "@/components/scanner-panel";

const POPULAR_PAIRS = ["BTC", "ETH", "SOL", "PEPE", "DOGE", "AVAX", "RENDER", "SUI", "NEAR", "FET", "INJ"];

export default function Home() {
  const [symbol, setSymbol] = useState("BTC");
  const [customInput, setCustomInput] = useState("");
  const submit = (e: React.FormEvent) => { e.preventDefault(); if (customInput.trim()) { setSymbol(customInput.trim().toUpperCase().replace(/USDT$/, "")); setCustomInput(""); } };
  return <main className="min-h-screen bg-[#07070a] text-zinc-100 p-4 md:p-8 font-sans"><div className="max-w-7xl mx-auto mb-8">
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-zinc-800/80"><div><div className="flex items-center gap-2"><span className="text-2xl font-bold bg-gradient-to-r from-purple-400 via-indigo-400 to-emerald-400 bg-clip-text text-transparent">PerpSqueeze // Analytics & Scanner</span><span className="bg-purple-950 text-purple-300 px-2.5 py-0.5 rounded-full text-xs font-semibold border border-purple-800/80 font-mono">v2.4 Pro</span></div><p className="text-xs text-zinc-400 mt-1">Dark-mode perpetual futures analytics, OI-modeled liquidation heatmaps, &amp; automated Telegram/Discord webhook alerts.</p></div><div className="flex flex-wrap items-center gap-2"><div className="flex flex-wrap bg-zinc-900 border border-zinc-800 rounded-xl p-1 gap-1">{POPULAR_PAIRS.map(p => <button key={p} onClick={() => setSymbol(p)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold font-mono transition ${symbol === p ? "bg-purple-600 text-white shadow" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"}`}>{p}</button>)}</div><form onSubmit={submit}><input value={customInput} onChange={e => setCustomInput(e.target.value)} placeholder="Custom symbol" className="bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-1.5 text-xs text-zinc-200 w-32 font-mono" /></form></div></div>
    <div className="flex items-center justify-between mb-4"><h2 className="text-xl font-bold font-mono tracking-wide text-zinc-200">{symbol}USDT <span className="text-xs font-sans text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 px-2 py-0.5 rounded">Perpetual Live</span></h2><span className="text-xs text-zinc-500 font-mono">Binance USDS-M // Singapore Pin (sin1)</span></div>
    <KpiHeaderBar symbol={symbol} /><LiquidationHeatmap symbol={symbol} /><PositioningPanel symbol={symbol} /><ScannerPanel />
  </div></main>;
}
