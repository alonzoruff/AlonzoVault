# Deploying Govee Lights on Render

Same shape as the sprinter app and the command portal: a zero-dependency
Node service, `node server.js`, config from environment variables.

## Steps

1. Put this folder in a GitHub repo (or point Render at the repo that
   contains it, with the root directory set to this folder).
2. In Render: **New → Web Service** (or **New → Blueprint** and pick
   `render.yaml`). Name: `govee-lights`. Build command: `npm install`
   (there are no dependencies; it finishes instantly). Start command:
   `node server.js`.
3. Add the API key — the same paste-the-key pattern as the Stripe key:
   - Render service → **Environment** → add `GOVEE_API_KEY` and paste the
     key from the Govee email (the personal API key AJ applied for in the
     Govee Home app). Never commit the key to the repo.
   - Optional: `GOVEE_REFRESH_MS` (default `30000`) — how often the server
     re-reads the lights in the background.
   - `PORT` is provided by Render automatically. Do not set it.
4. Deploy. Open the service URL: the page shows a big clock and the lights.
   If the key is missing, the page says "Setup needed" instead of failing —
   add the env var and Render restarts the service on its own.

## Plan note

Use the **Starter** plan like AJ's other apps. On the free plan Render
spins the service down after inactivity, so the wall iPad's first tap after
a quiet stretch waits on a cold start. Starter stays awake.

## On the iPad

Open the Render URL in Safari, then **Share → Add to Home Screen** so it
launches full-screen like an app. No Govee app install is involved — the
server holds the key and talks to Govee; the iPad only loads the page.

## One honest limitation

The site has **no login**. Anyone who has the URL can see and control the
lights. Keep the URL private (don't post or share it). If that ever needs
to change, a simple passcode env var can be added to the server later.
