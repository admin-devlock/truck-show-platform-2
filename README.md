# Truck Show Floorplan Platform

A collaborative web app for managing exhibition floorplans from CAD drawings:
upload DWG files, render booths, assign exhibitors and statuses, search, export, and
back up — with live multi-user collaboration.

- **`webapp/`** — the product. Next.js 15 (App Router) + React 19 + Firebase
  (Auth/Firestore), Tailwind v4. A "map" is a collaborative document.
- **`work/`** — the Python prototyping pipeline the converter was built from
  (DWG → JSON → SVG + structured booth records). The production version lives in
  [`webapp/scripts/convert_floorplan.py`](webapp/scripts/convert_floorplan.py).

## Features

- Create/load maps; **multiple CAD levels** per map (add/replace/remove any time)
- Exhibitor assignment, **bulk import** (CSV/paste), **copy** from another map
- Status types & per-booth statuses (e.g. a Compliance workflow)
- **Search** by exhibitor name or booth number (list + map views)
- Pan / arbitrary zoom; exhibitor names sized to each booth; live presence
- **Export as-depicted**: SVG, PNG, PDF, CSV
- **Backup & recovery**: full self-contained JSON (auto-saved to disk + manual
  download), restorable from the dashboard
- **Booth splitting** for relabel adaptability (split a booth into two halves)

## Local development

```bash
cd webapp
cp .env.local.example .env.local   # fill in your Firebase web config (see below)
npm install
npm run dev                        # http://localhost:3000
```

The CAD conversion route (`/api/convert`) shells out to **libredwg** (`dwgread`) and
**python3**, so those must be on the host for uploads to convert locally:

```bash
brew install libredwg              # provides dwgread
# python3 (3.9+) is used to run webapp/scripts/convert_floorplan.py (stdlib only)
```

## Configuration

Public Firebase web config (safe to expose; inlined into the client bundle):

| Variable | |
|---|---|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Firebase web API key |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | `<project>.firebaseapp.com` |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | project id |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | `<project>.appspot.com` |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | sender id |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | app id |
| `NEXT_PUBLIC_ENABLE_GUEST` | `true` to show dev guest sign-in |

Firestore/Storage security rules live in `webapp/firestore.rules` (prod) and
`webapp/firestore.rules.dev` (guest testing) — publish via the Firebase console.

## Container / cloud deploy

The [`Dockerfile`](Dockerfile) bundles the webapp **and** the conversion toolchain
(a statically-built `dwgread` + `python3`) into one image, so `/api/convert` works in
the cloud. Build context is the repo root.

```bash
docker build -t truckshow:latest \
  --build-arg NEXT_PUBLIC_FIREBASE_API_KEY=... \
  --build-arg NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=... \
  --build-arg NEXT_PUBLIC_FIREBASE_PROJECT_ID=... \
  --build-arg NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=... \
  --build-arg NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=... \
  --build-arg NEXT_PUBLIC_FIREBASE_APP_ID=... \
  .

# Persist on-disk backups with a volume mounted at /app/backups.
docker run -p 3000:3000 -v truckshow-backups:/app/backups truckshow:latest
```

Notes:
- `NEXT_PUBLIC_*` are **build args** (baked at build time), not runtime env.
- The image is multi-stage: libredwg is compiled to a static binary, the Next app is
  built to a standalone server, and the slim runtime carries only `node`, `python3`,
  and `dwgread`.
- Conversion of large drawings can take ~10–30s and is CPU-bound; size the container
  CPU/timeout accordingly (the route allows up to 300s).
- Backups under `/app/backups` are ephemeral unless a volume is mounted.
