# TradingView Watchlist Dashboard

A self-hosted TradingView-style chart page with a right-side watchlist and a separate dashboard for managing symbols, categories, tags, and order.

This is a lightweight Node.js app: no database, no build step, no framework. Watchlist state is stored in `data/watchlist.json`.

## Features

- Embedded TradingView Advanced Chart widget
- Compact TradingView-like watchlist sidebar
- Live/delayed quotes via TradingView scanner endpoints
- Symbol search using TradingView symbol search
- Add, remove, import, and export watchlists
- Categories and tags
- Drag-and-drop ticker reorder within categories
- Drag-and-drop ticker moves between categories
- Drag-and-drop category reorder
- Bulk management dashboard at `/dashboard.html`
- Optional Google OAuth gate for private deployments
- Local unauthenticated mode by default for easy testing

## Screens

- `/` — chart + compact watchlist
- `/dashboard.html` — bulk watchlist/category/tag management
- `/health` — JSON health check

## Quick start

```bash
git clone https://github.com/00anon0X/tradingview-watchlist-dashboard.git
cd tradingview-watchlist-dashboard
npm install
npm start
```

Open `http://localhost:3000`.

No auth is required unless you configure Google OAuth environment variables.

## Configuration

Copy the example env file if you want to customize runtime settings:

```bash
cp .env.example .env
```

Environment variables:

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `PUBLIC_HOST` | `localhost` | Display/health host label |
| `BASE_URL` | `http://<host>:<port>` | Public URL used for OAuth callback links |
| `GOOGLE_CLIENT_ID` | empty | Optional Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | empty | Optional Google OAuth secret |
| `AUTH_COOKIE_SECRET` | empty | Random string used to sign auth cookies |
| `ALLOWED_GOOGLE_EMAIL` | empty | Email allowed to access the app when OAuth is configured |

If all Google OAuth variables are present, the app requires login. If any are missing, it runs in local open mode.

## Watchlist data

The default sample watchlist lives at:

```text
data/watchlist.json
```

Shape:

```json
{
  "version": 1,
  "updatedAt": "2026-01-01T00:00:00.000Z",
  "categories": ["Indexes", "Crypto"],
  "symbols": [
    {
      "symbol": "NASDAQ:AAPL",
      "name": "Apple Inc.",
      "category": "Indexes",
      "tags": ["tech"]
    }
  ]
}
```

Use canonical TradingView symbols when possible, e.g. `NASDAQ:AAPL`, `BINANCE:BTCUSDT`, `AMEX:SPY`.

## Development

```bash
npm run check
npm test
```

The app intentionally uses plain HTML/CSS/JS and Node built-ins so it can be deployed almost anywhere.

## Deployment notes

- Put the app behind HTTPS if enabling Google OAuth.
- Set `BASE_URL` to your public origin, e.g. `https://watchlist.example.com`.
- Configure your Google OAuth callback as `<BASE_URL>/auth/callback`.
- Persist or back up `data/watchlist.json` if deploying to ephemeral infrastructure.

## Privacy and safety

This repo includes only sample/demo watchlist data. Do not commit real `.env` files, credentials, private watchlists, logs, or deployment backups.

Quotes and charts are provided by TradingView endpoints/widgets and may be delayed or unavailable for some symbols. This is a watchlist UI, not financial advice or a trading system.

## License

MIT
