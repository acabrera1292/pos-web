# POS Web

A web-based point-of-sale system built with Node.js, Express, SQLite, and vanilla HTML, CSS, and JavaScript.

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
| `DATABASE_PATH` | SQLite database path | `backend/database.sqlite` |
| `JWT_SECRET` | Signs login tokens | `pos-secret` |
| `ADMIN_SECRET` | Protects administration | `posmaster` |
| `SRI_CERT_ENCRYPTION_KEY` | Encrypts each store's electronic-signature file and password | None; required for certificate installation |

Set private values for `JWT_SECRET` and `ADMIN_SECRET` in a public deployment.

## Deploy on Render

Create one Node Web Service and leave its root directory blank.

- Build command: `cd backend && npm ci`
- Start command: `cd backend && npm start`
- Health check path: `/health`

Do not set Render's root directory to `backend`; the server also needs the adjacent `frontend` directory.

SQLite data on Render's default filesystem is temporary. For production, attach a persistent disk and point `DATABASE_PATH` to it, or migrate to a managed database.

Generate `SRI_CERT_ENCRYPTION_KEY` as a long random secret and save it only in Render's Environment page. Never change or remove this value after installing certificates, because existing encrypted certificates would become unreadable. Before storing invoices or certificates, configure durable database storage; Render's default filesystem is not persistent.

## Structure

```text
backend/
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
