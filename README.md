# eVEGAH Form

## Dev

- Install deps: `npm i`
- Start: `npm run dev`

## DigiLocker Aadhaar verification (APISetu)

The Rider form supports **Aadhaar verification via DigiLocker** using an OAuth popup flow.

1. Configure OAuth credentials + endpoints in `server/.env` (see the DigiLocker block at the bottom).
2. Ensure the **redirect/callback URL** you register in the APISetu portal matches `DIGILOCKER_REDIRECT_URI`.
3. Run both frontend + API:

	`npm run dev:full`

Notes:

- For production, use **HTTPS** for your redirect URL.
- The backend exposes:
	- `POST /api/digilocker/auth-url` (starts OAuth)
	- `GET /api/digilocker/callback` (OAuth callback)
	- `GET /api/digilocker/status` (health/config)

## Local Postgres (drafts table)

If you want the `rider_drafts` table in a **local Postgres** database, you can use the included Docker Compose setup.

1. Start Postgres:

	`docker compose -f docker-compose.postgres.yml up -d`

2. The schema is automatically applied on first boot from:

	`db/init/001_rider_drafts.sql`

Notes:

- This only creates the table locally.
- The frontend currently uses the Supabase client (`src/config/supabase.js`) to read/write drafts. A browser app cannot connect to Postgres directly; it needs an HTTP API (or Supabase/PostgREST). If you want the app to use local Postgres end-to-end, tell me and I’ll add a small local API server.
