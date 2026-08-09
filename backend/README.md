# MORDERN MAGIC Drama Backend — v3.0 Phase 2

## What's New (Phase 2)

Full backend implementation with Prisma + PostgreSQL + Express + TypeScript.

### 8 API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | No | Health check |
| POST | `/api/auth/send-otp` | No | Send 6-digit OTP via Resend |
| POST | `/api/auth/verify-otp` | No | Verify OTP, return JWT (7d) |
| GET | `/api/dramas` | No | List all dramas |
| GET | `/api/dramas/:slug` | No | Drama detail + episodes |
| GET | `/api/dramas/:slug/episodes` | No | Episode list |
| POST | `/api/payment/create-checkout` | Yes | Stripe checkout session |
| POST | `/api/webhook/stripe` | No | Stripe webhook (raw body) |
| GET | `/api/watch-history` | Yes | User watch history |
| POST | `/api/watch-history` | Yes | Upsert watch position |

### Database Schema (5 tables)

- `User` — email, OTP, timestamps
- `Drama` — slug, title, cover, description, totalEpisodes, priceCents
- `Episode` — dramaId, episodeNumber, s3Key, durationSec
- `Order` — userId, dramaId, stripeSessionId, amountCents, status
- `WatchHistory` — userId, dramaId, episodeId, positionSec

## Setup Instructions

### 1. Merge into your repo

Copy the `backend/` directory into your `mordernmagic-drama` repo (replace the existing Phase 0 backend).

### 2. Configure Railway Postgres URL

In Railway dashboard → your Postgres service → "Connect" tab → copy the `DATABASE_URL`.

Add it to Railway environment variables (if not already auto-injected):
```
DATABASE_URL=postgresql://...
```

Also add these env vars in Railway:
```
JWT_SECRET=mordernmagic-drama-secret-key-2026-v3
RESEND_API_KEY=re_RzA8DeKX_GaXRayeEuPadn5XcbkiBb6Y4
RESEND_FROM_EMAIL=noreply@mordernmagic.com
STRIPE_SECRET_KEY=sk_test_51U2CbILWZjJo0DgjsXhymRVIPsfKfVA78OrPu6TTzxsT0u1EiNEzCWPFDxcg9hQdqzg6fnLAoctW8UTKq22Qp2I800DbjU6m1T
STRIPE_WEBHOOK_SECRET=whsec_TtOgdtH9yI6hI2vD8rdtWNCNez588Ut2
FRONTEND_URL=https://drama.mordernmagic.com
```

### 3. Local development (optional)

```bash
cd backend
npm install
# Set DATABASE_URL in .env
npx prisma migrate dev --name init
npx ts-node prisma/seed.ts
npm run dev
```

### 4. Deploy to Railway

Push to GitHub main branch — Railway auto-deploys:
```bash
git add backend/
git commit -m "v3.0 Phase 2: backend + database"
git push origin main
```

Railway runs `npm run start` which does:
1. `prisma migrate deploy` — apply migrations
2. `node dist/index.js` — start server

### 5. Seed test data

After first deploy, seed the demo drama:
```bash
# SSH into Railway or run locally with Railway DATABASE_URL
npx ts-node prisma/seed.ts
```

### 6. Configure Stripe Webhook

In Stripe Dashboard → Webhooks → Add endpoint:
- URL: `https://api.drama.mordernmagic.com/api/webhook/stripe`
- Events: `checkout.session.completed`
- Copy the webhook signing secret to `STRIPE_WEBHOOK_SECRET`

### 7. Test APIs

```bash
cd backend
chmod +x test-api.sh
BASE_URL=https://api.drama.mordernmagic.com EMAIL=your@email.com ./test-api.sh
```

## File Structure

```
backend/
├── src/
│   └── index.ts          # All routes + middleware
├── prisma/
│   ├── schema.prisma     # 5-table schema
│   └── seed.ts           # Demo drama data
├── package.json
├── tsconfig.json
├── .env                  # Local env template
├── .gitignore
├── test-api.sh           # End-to-end curl tests
└── README.md
```

## Notes

- Phase 2 does NOT touch the frontend (Phase 3)
- Phase 2 does NOT upload videos to S3 (Phase 4)
- Phase 2 uses Stripe Test mode (Phase 5 for live)
- The webhook route uses `express.raw()` and is placed BEFORE `express.json()` to ensure signature verification works
