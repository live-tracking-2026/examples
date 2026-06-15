# Examples

Login demo with [Cap](https://capjs.org) bot-challenge protection.

The widget runs the proof-of-work challenge in the browser. On submit, the
backend calls Cap's `/siteverify` endpoint with the secret — the secret never
touches the browser.

```
Browser
  │  ① POST /{site-key}/challenge   (directly to Cap)
  │  ② POST /{site-key}/redeem      (directly to Cap)
  │  ③ POST /api/login  { email, password, cap_token }
  ▼
Backend  →  POST /siteverify  { secret, response: cap_token }  →  Cap
         ←  { success: true }
  │
  ▼
Browser  ←  { success: true, message: "Welcome!" }
```

---

## Prerequisites

Make sure the Cap service is running locally:

```bash
# from the repo root
docker compose up cap
```

Then grab your **site key** and **secret key** from the Cap admin UI at
`http://localhost:3002` → Keys tab.

---

## Go backend

**Requirements:** Go 1.22+

```bash
cd examples
CAP_SECRET=<your-secret> go run server.go
```

Open `http://localhost:4173/login` (Login tab in the demo app; `login.html` redirects there).

| Env var | Default | Description |
|---------|---------|-------------|
| `CAP_SECRET` | _(required)_ | Secret key from Cap admin → Keys |
| `CAP_URL` | `http://localhost:3002` | Base URL of the Cap service |
| `PORT` | `4173` | Port the demo server listens on |

---

## Java backend

**Requirements:** Java 17+ — install with Homebrew if needed:

```bash
brew install --cask temurin   # OpenJDK 21 LTS
```

```bash
cd examples
CAP_SECRET=<your-secret> java LoginServer.java
```

Open `http://localhost:4173/login` (Login tab in the demo app; `login.html` redirects there).

Same env vars as the Go backend (`CAP_SECRET`, `CAP_URL`, `PORT`).

---

## File overview

| File | Purpose |
|------|---------|
| `index.html` | Combined SPA: analytics demo + Login tab (`/login`) |
| `cap-programmatic.html` | Standalone programmatic Cap demo (`cap.solve()` on load) |
| `login.js` | Cap widget wiring, form submit → `POST /api/login` |
| `login-programmatic.js` | Logic for `cap-programmatic.html` |
| `login.css` | Standalone styles (also inlined in `index.html`) |
| `login.html` | Redirects to `/login` |
| `server.go` | Go HTTP backend |
| `LoginServer.java` | Java HTTP backend |

---

## How it works

1. The page loads the Cap widget from the CDN (`@cap.js/widget`).
2. The widget speculatively fetches a challenge and solves the proof-of-work.
3. On solve the widget emits a `solve` event — the Sign in button is enabled.
4. On submit the browser sends `{ email, password, cap_token }` to `/api/login`.
5. The backend calls `POST /siteverify` with the secret and the token.
6. Cap returns `{ success: true }` — the backend completes the login.

The Cap token is **single-use**: after `/siteverify` consumes it the Sign in
button is disabled until the widget solves a new challenge.

### Programmatic demo (`/cap-programmatic.html`)

Separate page using [programmatic mode](https://trycap.dev/guide/programmatic): `new Cap({ apiEndpoint })` and
`await cap.solve()` run automatically on load (no visible widget). Same `POST /api/login` verification as the widget tab.
