# G.PACK Design Portal

Standalone Arabic-first RTL collaboration portal for G.PACK clients, designers, and administrators.

## Architecture

- Node.js 20 and Express
- Vanilla JavaScript frontend
- External PostgreSQL through `DATABASE_URL`
- PostgreSQL migrations in `migrations/`
- Persistent uploaded files under `/app/uploads`
- Server-side HTTP-only cookie sessions
- Server-Sent Events for realtime collaboration

## Run locally

1. Copy `.env.example` to `.env` and configure an external PostgreSQL database.
2. Run `npm install`.
3. Run `npm run db:migrate`.
4. Create an administrator explicitly with `npm run admin:create`.
5. Run `npm start` and open `http://localhost:3000`.

The application does not create demo users, reset schemas, or delete data on startup.

## Import the existing SQLite data

The original `data/portal.db` is retained as a migration source and is not deleted automatically. After configuring `DATABASE_URL`, run:

```bash
npm run db:migrate
npm run db:migrate:sqlite
```

The import is repeatable and uses `ON CONFLICT DO NOTHING`; it prints source and PostgreSQL row counts. Existing portal access records preserve their stored hashes, but because the old application did not retain the original raw secrets, administrators should generate new short access codes after import.

## Environment

Required values are documented in `.env.example`:

- `DATABASE_URL`
- `SESSION_SECRET`
- `NODE_ENV`
- `PORT`
- `BASE_URL`
- `UPLOADS_DIR`
- `DATABASE_SSL`
- `DB_POOL_MAX`

## Deployment

Build and run the Docker image with an external PostgreSQL connection and a persistent upload volume:

```bash
docker build -t gpack-design-portal .
docker run -p 3000:3000 --env-file .env -v uploads-data:/app/uploads gpack-design-portal
```

The PostgreSQL service is intentionally not part of the application container or repository. Configure the reverse proxy to allow long-lived SSE connections and disable response buffering for `/api/*/stream`.
