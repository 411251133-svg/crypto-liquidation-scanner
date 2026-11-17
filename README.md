# PerpSqueeze Analytics & Scanner

Next.js 14 dashboard for perpetual-futures analytics, modeled liquidation levels, positioning metrics, and scanner alerts.

## Run locally

```powershell
npm install
npm run dev
```

Open http://localhost:3000.

## Production

```powershell
npm run build
npm start
```

This app is ready to deploy with Vercel. Import this GitHub repository at https://vercel.com/new, select the repository, and deploy with the default Next.js settings. Add values from `.env.example` in Vercel Project Settings when needed.

Exchange data is public; the dashboard uses modeled fallback values when an endpoint is unavailable.
