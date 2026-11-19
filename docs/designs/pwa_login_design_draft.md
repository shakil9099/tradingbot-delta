# Dashboard PWA and long login

* **Author:** Shakil Dodhiya
* **Date:** 2026-11-19
* **Status:** Draft (revised after a zoom-out review)
* **Size:** Medium (cookie lifetime + PWA shell; no new service or API)

## Problem

The dashboard (ETH bot, with the NIFTY "Options" tab) logs out 12 hours after login (`cookie-session` `maxAge`, `src/api/server.ts`). On a phone that means typing the password almost every day. It also cannot be installed to the home screen.

## Goals

1. Once logged in, stay logged in while the dashboard is used: a **1-year rolling session**.
2. Keep the password re-entry for sensitive actions (manual entry/exit, settings, kill switch, mode switch).
3. Installable PWA: home-screen icon, full-screen standalone window, fast start. Data is always live; nothing from the API is cached.

Out of scope: push notifications, offline use, changes to the Options bot. Caddy passes the browser's own cookie through to the ETH `/api/status` on each Options request; the Options bot stores no copy, so it follows automatically.

## Approach

### Login (server, `src/api/server.ts` only)

* `cookie-session` `maxAge` 12 h → **365 days**.
* **Rolling:** `cookie-session` re-sends the cookie only when the session changes. A middleware placed right after `cookieSession(...)` and before the routers sets `req.session.d = <UTC day number>`, **only when `session.user` is set**. The value changes once a day, so the expiry moves forward on the first request each day; anonymous requests (`/health`, static files, the login page) never get a cookie. A phone not opened for a whole year is logged out.
* **A password change ends every session:** the signing key becomes `sha256(SESSION_SECRET + DASHBOARD_PASSWORD_HASH)`. Both come from `.env` and are read at start, and a password change is already "edit `.env`, restart", so every older cookie stops verifying. No per-request check and no change to `auth.ts`. Existing 12-hour cookies die at deploy: one fresh login.
* Unchanged: `httpOnly`, `secure`, `sameSite=strict`, logout clears the cookie, 5 wrong re-entries end the session, login delay per IP.

### PWA (web)

* `web/public/manifest.webmanifest`: name and short name "ETH Bot", `display: standalone`, `start_url: /`, dark theme colours from `styles.css`, committed PNG icons 192 / 512 plus a maskable 512.
* `web/public/sw.js`: a minimal worker with **no caching** (install/activate only, no fetch interception), so it can never serve stale prices or an offline shell with no data.
* **Fast start without a cache in the worker:** Express serves `web/dist/assets/*` (hashed names) with `Cache-Control: public, max-age=31536000, immutable`, so the phone keeps the app files in its normal HTTP cache. `index.html` and `sw.js` keep the default revalidate-every-time, so a deploy is picked up on the next open.
* `index.html`: manifest link, `theme-color`, `apple-mobile-web-app-capable`, `apple-touch-icon`.
* `main.tsx`: `if (import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js')`.

## Key decisions

| Decision | Choice | Why |
|---|---|---|
| Session length | 365 days, renewed daily | The user's explicit choice ("once logged in it should not log out"). A shorter 60–90 days was offered by review; kept at 365 because the password change below revokes everything, and trading actions still need the password. |
| Revocation | Signing key derived from the password hash | One line; a password change (env + restart) logs out every device. |
| Re-auth for actions | Kept | The user's choice; protects live trading if the phone is borrowed or a cookie leaks. |
| Caching | Browser HTTP cache for hashed files; no service-worker cache | Same fast start, nothing stale, no cache versioning to maintain. |

## Alternatives rejected

* **Server-side session store** (revocable per device): more code and state for a single-user bot.
* **Storing a password version in the session and checking it in `auth.ts`:** the same effect as the derived key, with more code.
* **vite-plugin-pwa / Workbox, offline shell:** a dependency and stale-UI risk on a trading dashboard.

## Risks

* Anyone holding the unlocked phone can view the dashboard for up to a year; trading actions still need the password. If the phone is lost: change the password (edit `DASHBOARD_PASSWORD_HASH` with `npm run hash-password`, restart), and every session ends.
* iOS keeps a home-screen app's cookies separate from Safari, so you log in once inside the installed app.

## Test plan

* Unit (supertest): the login cookie expires about 365 days ahead; a request on a later day re-sends the cookie, and one on the same day does not; `/health` and static files send no `Set-Cookie`; a cookie signed with the old password hash gets 401; logout clears it; re-auth unchanged; `/sw.js` and `/manifest.webmanifest` are served as files (not the SPA `index.html`); `/assets/*` has the `immutable` header.
* Build: `web` `npm run build` puts the manifest, `sw.js` and icons into `dist`.
* Manual: production preview, Chrome DevTools "Application → Manifest" shows installable; on the phone, Add to Home Screen, log in, reopen the next day.
* Deploy while the ETH bot is flat (it carries the `TRAIL_TRIG_R` 1.5 → 1 change too): back up `dist` and `web/dist`, sync, `npx tsc`, build the web, pm2 restart, then log in once.
