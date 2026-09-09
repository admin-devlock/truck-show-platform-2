# Codex project instructions

Read `README.md` and `PROJECT_HANDOFF.md` before changing this repository.

## Scope

- The product is in `webapp/`. Run Node commands from that directory.
- `work/` is the historical Python conversion prototype. The production converter
  is `webapp/scripts/convert_floorplan.py`.
- Treat unrelated untracked files and directories as user-owned. Do not stage,
  delete, move, or rewrite them.

## Data safety

- Production map data is in Firebase, not Git. Treat every map mutation or migration
  as production-data work unless clearly told otherwise.
- Before any bulk repair, migration, or CAD revision operation, create and verify a
  Firestore backup with `npm run backup:firestore` from `webapp/`.
- Never replace or destructively update an existing map when importing a revised CAD
  plan. Create an updated copy and preserve the source map unless the user explicitly
  authorizes another approach.
- Do not run one-off mutation scripts such as `scripts/fix_bcec_188_189.mjs` without
  explicit user authorization and a current verified backup.
- Activity records are append-only. Do not weaken their update/delete denial without
  discussing the audit implications with the user.

## Git policy

- Create a `codex/` feature branch for changes.
- Do not merge into or push to `main` without the user's explicit permission for that
  specific merge. A prior approval does not authorize future merges.
- Before an approved merge, fetch `origin/main`, resolve divergence safely, run the
  checks below, and report the resulting commit.

## Required checks

From `webapp/`, run:

```bash
npm run build
npm run test:remap
npm run test:statuses
```

Also run `git diff --check`. The concurrency test interacts with Firebase and should
only be run when its live-data implications are understood.

## Firebase and deployment

- Never commit `webapp/.env.local`. Transfer it securely between machines/accounts.
- Firestore rules are in `webapp/firestore.rules`; development guest rules are in
  `webapp/firestore.rules.dev`. Git pushes do not publish Firebase rules—publish them
  separately in the Firebase console.
- The repository is configured for Netlify in `netlify.toml`. Firebase and Netlify
  account access is separate from repository access.
- Keep consequential activity logging inexpensive. Do not add high-frequency events
  such as scrolling, pointer movement, map panning/zooming, hover, or draft typing.
