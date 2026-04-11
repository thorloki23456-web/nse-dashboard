# Deploy For Free

This project can be deployed for free if you keep the scope simple:

- Use a free Vercel preview or Hobby deployment.
- Use only the live NSE-backed dashboard routes.
- Skip Supabase write routes and Telegram alerts unless you already have those set up.

## What works without paid services

These routes do not need Supabase:

- `/`
- `/api/symbols`
- `/api/expiry-dates`
- `/api/option-chain`
- `/api/technical-analysis`
- `/api/term-structure`

These features are optional:

- `/api/trading/signal` needs `SUPABASE_SERVICE_KEY` only if you want to persist signals/orders.
- Telegram alerts need `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.

## Zero-cost path

1. Keep the main dashboard only.
2. Do not configure `SUPABASE_SERVICE_KEY`.
3. Do not configure Telegram keys.
4. Deploy with the default `vercel.app` URL.

## Why localhost works but deploy fails

Common causes in this repo:

- `next dev` is more forgiving than a production build, so type errors can slip through locally.
- Cloud builds do not get your local `.env` file unless you add those variables in the hosting platform.
- Uploading local artifacts like `.next/` or coverage files can make deployment packages too large.
- NSE upstream requests can behave differently in the cloud because of rate limits or bot protection.

## Which env vars matter

For the free live dashboard:

- No extra env vars are required for the core NSE routes.

Optional only:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_KEY`
- `POSTGRES_URL`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `TRADING_DRY_RUN`
- `INITIAL_CAPITAL`

## Safe rule

If you only want the live dashboard, leave Supabase and Telegram unset.
Start with the read-only analytics routes first, then add optional services later if you need them.
