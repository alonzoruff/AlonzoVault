# Govee Lights

A small standalone website for controlling AJ's Govee lights from a
wall-mounted iPad. Not a Muse Space — a plain hosted site, built to
deploy on Render like the sprinter app and the command portal.

## Why it is fast

Govee's classic API takes about 5 seconds to read all the lights, so the
page never waits on it. The server keeps a cached snapshot of every light,
refreshes it in the background every 30 seconds, and serves the page from
the cache. Taps go to Govee immediately, update the cache optimistically,
and confirm against the real light in the background.

## Run it locally

```sh
GOVEE_API_KEY=<key from the Govee email> node server.js
# open http://localhost:3000
```

Without the key the server still starts and the page shows a "setup
needed" state.

## Layout

- `server.js` — zero-dependency Node server: static page, cached snapshot,
  background refresh, `/api/lights` and `/api/control`.
- `lib/govee-client.js` — Govee classic developer API client
  (`developer-api.govee.com`, `Govee-API-Key` header).
- `public/` — the one-page dashboard (clock, one big tile per light,
  room groups, All on / All off).
- `tests/run-tests.js` — `npm test`. Stubs the Govee API at the fetch
  layer; no real key needed.
- `render.yaml` / `DEPLOY.md` — Render deploy, including where the key goes.

## API

- `GET /api/lights` → `{setupNeeded, updatedAt, refreshMs, lastError, devices}`
  served from the cache, instantly.
- `POST /api/control` with `{device, model, cmd:{name, value}}` where name
  is `turn` (`"on"`/`"off"`), `brightness` (1–100), `colorTem` (2000–9000),
  or `color` (`{r, g, b}`) → the updated cached device.
