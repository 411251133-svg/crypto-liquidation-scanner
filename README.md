# PerpSqueeze Analytics & Scanner

A Next.js 14 dashboard for perpetual-futures analytics, modeled liquidation levels, positioning metrics, and scanner alerts.

## Run locally

```powershell
npm install
npm run dev
```

Open http://localhost:3000.

## Validate and build

```powershell
npm run build
npm start
```

This project is ready for Vercel. `vercel.json` uses Frankfurt (`fra1`) to avoid Binance Futures geo-blocking observed from Singapore. The scanner reports degraded upstream data instead of treating failed requests as a healthy zero-signal result.
