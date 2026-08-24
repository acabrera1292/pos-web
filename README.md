# POS Web

A web-based point-of-sale system built with Node.js, Express, PostgreSQL/SQLite, and vanilla HTML, CSS, and JavaScript.

## Features

- Store and user administration
- Inventory management and CSV import/export
- Point-of-sale cart and sales history
- Client management
- Daily, weekly, and monthly reports
- Role-based UI controls

## Run locally

```text
cd backend
npm install
npm start
```

Open `http://localhost:4000`. The backend serves both the API and frontend.

## Configuration

| Variable | Purpose | Development default |
| --- | --- | --- |
| `PORT` | HTTP server port | `4000` |
| `DATABASE_URL` | PostgreSQL connection supplied by Render | None; when present PostgreSQL is used |
| `DATABASE_PATH` | Local SQLite fallback path | `backend/database.sqlite` |
| `PG_POOL_MAX` | Maximum PostgreSQL connections | `10` |
| `JWT_SECRET` | Signs login tokens | `pos-secret` |
| `ADMIN_SECRET` | Protects administration | `posmaster` |
| `SRI_CERT_ENCRYPTION_KEY` | Encrypts each store's electronic-signature file and password | None; required for certificate installation |
| `SENDGRID_API_KEY` | Sends password-recovery codes by email | None |
| `SENDGRID_FROM_EMAIL` | Verified SendGrid sender used for recovery emails | None |

Set private values for `JWT_SECRET` and `ADMIN_SECRET` in a public deployment.

## Deploy on Render

Create one Render PostgreSQL database and one Node Web Service in the same region. Copy the database's **Internal Database URL** into the web service environment variable `DATABASE_URL`.

- Build command: `cd backend && npm ci`
- Start command: `cd backend && npm start`
- Health check path: `/health`

Do not set Render's root directory to `backend`; the server also needs the adjacent `frontend` directory.

When `DATABASE_URL` exists, the server creates and verifies all PostgreSQL tables and indexes automatically during startup. If it is absent, the application falls back to local SQLite for development.

The free Render PostgreSQL database is suitable for the 30-day test but does not include backups. Upgrade that same database to a paid plan before it expires; do not create a replacement database, so the test data remains in place.

Generate `SRI_CERT_ENCRYPTION_KEY` as a long random secret and save it only in Render's Environment page. Never change or remove this value after installing certificates, because existing encrypted certificates would become unreadable.

Password recovery requires a verified sender in SendGrid. Add `SENDGRID_API_KEY` and `SENDGRID_FROM_EMAIL` in Render's Environment page, then redeploy. New users receive a temporary password from their administrator and must create a personal password on first login.

## Structure

```text
backend/
  database.js
  server.js
  database.sqlite
frontend/
  index.html
  admin.html
  dashboard.html
  css/styles.css
  js/auth.js
  js/admin.js
```
