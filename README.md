# cfworker

A Cloudflare Workers API written in **Python** (`python_workers` / Pyodide) — JSON endpoints, CORS, error handling. No frameworks.

## Endpoints

| Method | Path                       | Description                              |
|--------|----------------------------|------------------------------------------|
| GET    | `/`                        | API info                                 |
| GET    | `/api/hello`               | `?name=Rey` greeting                     |
| GET    | `/api/time`                | Current server time                      |
| POST   | `/api/echo`                | Echoes your JSON body                    |
| GET    | `/api/messages`            | List messages (`?limit=50`, max 100)     |
| POST   | `/api/messages`            | Create message `{name, text}`            |
| DELETE | `/api/messages`            | Admin: delete one `?id=3` or all         |
| GET    | `/api/groovyrey/comments`  | List comments (`?limit=50`, max 100)     |
| POST   | `/api/groovyrey/comments`  | Create comment — honeypot + 10/min/IP    |
| DELETE | `/api/groovyrey/comments`  | Admin: delete one `?id=3` or all         |

DELETE routes require `X-Admin-Key: <ADMIN_KEY>` (or `?key=`).

## Database

D1 (SQLite) bound as `DB` — see `schema.sql`. Apply changes with:

```bash
npx wrangler d1 execute demo-db --remote --file schema.sql
```

## Local dev

```bash
npm install
npm run dev
```

Opens a local server at http://localhost:8787

## Deploy

```bash
npx wrangler login
npm run deploy
```

Live at `https://cfworker.<your-subdomain>.workers.dev`

## Secrets

```bash
npx wrangler secret put ADMIN_KEY   # enables DELETE routes
npx wrangler secret put GREETING    # optional custom greeting
```
