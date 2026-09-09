# Truck Show Platform handoff

Last reviewed: 9 September 2026

Repository: `https://github.com/admin-devlock/truck-show-platform-2`

Application directory: `webapp/`

This document carries the project context that a new Codex account will not receive
from earlier task conversations.

## What the application does

The application manages collaborative truck-show floorplans derived from CAD files.
Users can create maps, manage multiple levels, assign exhibitors, apply multiple
status types, search booths, split booths, update a map from revised CAD geometry,
and export the result. Firebase Authentication and Firestore provide identity,
shared state, presence, and the append-only activity trail.

The current production code includes:

- Position-based CAD revision matching that creates a new map and ports booth data
  by geometry instead of trusting booth numbers.
- Explicit booth splitting/merging support. BCEC booths 188 and 189 are represented
  as separate footprints even where the supplied CAD labels were ambiguous.
- Multiple simultaneous status types. Their draggable legend order determines the
  winning display colour when a booth has more than one active status.
- A minimizable status legend whose chosen default persists across refreshes.
- Consequential-action auditing. It deliberately excludes noisy interactions such as
  scrolling, map movement, zooming, searching, selection, and draft typing.
- Read-only map backup and activity-analysis export commands.

## Non-negotiable operating rules

1. Preserve production data. Back up Firestore before migrations or bulk repair.
2. Revised CAD imports should produce an updated copy. Do not overwrite the original
   map unless the user explicitly requests that exact operation.
3. Work on a feature branch and obtain explicit permission before every merge or push
   to `main`.
4. Do not assume duplicate booth numbers mean duplicate geometry. Revised plans can
   renumber, split, or merge physical booths.
5. Keep audit logging focused on successful durable actions and intentional exports.

## Transfer to another Codex account

### Repository

Give the other account's GitHub identity access to the repository. On another
computer, clone it normally; on this computer, the other Codex account can open the
existing checkout. Repository access transfers code and Git history, not external
service access.

### Local configuration

Copy `webapp/.env.local` through a private channel such as a password manager or an
encrypted file transfer. Do not send it through Git. If it is unavailable, copy
`webapp/.env.local.example` to `.env.local` and populate all Firebase values from
Firebase Console → Project settings → General → Your apps.

Required values:

```text
NEXT_PUBLIC_FIREBASE_API_KEY
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_PROJECT_ID
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
NEXT_PUBLIC_FIREBASE_APP_ID
NEXT_PUBLIC_ENABLE_GUEST
```

These are Firebase web-client settings, but the local file is intentionally excluded
from version control. Firebase security is enforced by authentication and Firestore
rules, not by hiding client configuration.

### External account access

- Add the new Google identity to Firebase/Google Cloud IAM if it must administer
  authentication, Firestore, security rules, or project settings.
- Add the new identity to the Netlify site/team if it must inspect or operate deploys.
- Confirm the Netlify environment contains the same `NEXT_PUBLIC_FIREBASE_*` values.
- Enable Firebase Anonymous Authentication if the backup and activity export scripts
  need to sign in from the command line.

### Data and local artifacts

The live application data remains in the existing Firebase project, so it does not
need to be copied when both Codex accounts should use the same environment. Ignored
local folders do not travel through Git. Transfer any required backup or audit export
directories separately and securely.

Create a fresh map-data snapshot from `webapp/` with:

```bash
npm run backup:firestore
```

Export recent activity for analysis with:

```bash
npm run export:activity
```

Use `npm run export:activity -- --help` for map, user, date, limit, full-history, and
output-directory options.

## Fresh-machine setup

Prerequisites are Node.js 20+, npm, Python 3.9+, and `dwgread` from LibreDWG for CAD
uploads that are not covered by bundled pre-converted plans.

```bash
git clone https://github.com/admin-devlock/truck-show-platform-2.git
cd truck-show-platform-2/webapp
cp .env.local.example .env.local
npm ci
npm run build
npm run test:remap
npm run test:statuses
npm run dev
```

Open `http://localhost:3000`. Populate `.env.local` before building because the
public Firebase configuration is compiled into the Next.js client bundle.

## Architecture guide

- `webapp/src/app/` — Next.js routes and global styling.
- `webapp/src/components/` — map, booth, status, presence, import, and export UI.
- `webapp/src/lib/maps.ts` — Firestore map operations and durable audit emissions.
- `webapp/src/lib/remap.ts` — position-based matching and booth-data transfer.
- `webapp/src/lib/booths.ts` — booth geometry and split/merge handling.
- `webapp/src/lib/statuses.ts` — multiple-status resolution and priority.
- `webapp/src/lib/backup.ts` — per-map backup/restore behavior.
- `webapp/src/lib/activity.ts` and `components/ActivityLogger.tsx` — append-only audit
  event transport and persistence.
- `webapp/src/app/api/convert/` — server-side CAD conversion route.
- `webapp/scripts/convert_floorplan.py` — production DWG conversion pipeline.
- `webapp/firestore.rules` and `webapp/storage.rules` — production security rules.
- `netlify.toml` — Netlify Next.js build configuration.
- `Dockerfile` — self-contained deployment including LibreDWG and Python.

## Firestore shape

Top-level collections:

- `maps/{mapId}` — map document.
- `maps/{mapId}/levels/{levelId}` — CAD levels.
- `maps/{mapId}/render/{docId}` — rendered SVG and booth geometry.
- `maps/{mapId}/meta/{docId}` — booth assignments, statuses, and shared metadata.
- `maps/{mapId}/presence/{uid}` — ephemeral collaborator presence.
- `activity/{eventId}` — append-only successful mutations and exports.

The activity exporter produces `activity.json`, `activity.csv`, and `summary.json`.
Its default pull is capped at the latest 2,000 events to control Firestore reads.

## Deployment notes

Netlify builds from `webapp/` using `npm run build` and the Next.js runtime plugin.
The repository also supports a Docker build that bundles LibreDWG. Some known CAD
revisions are bundled as pre-converted outputs for serverless deployment where the
native converter is unavailable.

Pushing code does not publish Firestore rules. When rules change, publish the exact
contents of `webapp/firestore.rules` separately in the Firebase console and verify
the affected read/write flow.

## Before handing control over

- Confirm the new account can clone/open the repository.
- Confirm `webapp/.env.local` exists on the target machine and remains untracked.
- Run the build and offline tests.
- Start the local preview and sign in.
- Open an existing map without modifying it.
- Confirm Firebase and Netlify administrative access where required.
- Create a fresh Firestore backup before the first production data change.
- Keep all future work off `main` until explicit merge permission is given.
