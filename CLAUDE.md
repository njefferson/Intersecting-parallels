# CLAUDE.md — Intersecting Parallels

> **Inherits the Universal App Doctrine** — the canonical copy lives in the hub
> repo at
> [njefferson/noahjefferson/DOCTRINE.md](https://github.com/njefferson/noahjefferson/blob/main/DOCTRINE.md),
> alongside the cross-app
> [LESSONS.md](https://github.com/njefferson/noahjefferson/blob/main/LESSONS.md).
> Read both at the start of every session (start sessions with BOTH repos
> selected — repo access is fixed at session start). **Where anything below
> overlaps the Doctrine, the Doctrine wins.** This file keeps only what is
> specific to this repo. Never fork the doctrine here — link to it.

## What this repo is
**Intersecting Parallels** — where you stand and what you see: a free drawing
tool for perspective construction (vanishing points, constrained lines), being
built at **intersecting-parallels.pages.dev**. Static, self-contained, no build
step; npm is dev tooling only (the accessibility gate). `public/` is the
deployed site.

## FIRST, before anything else: what has the hub done since?
```
node ../noahjefferson/doctrine-sync.mjs --repo .
```
It names what has landed in the hub since this repo last reconciled — files,
commits, and **which sections of DOCTRINE.md**. Read them, do anything this repo
now owes, then `--adopt`. The marker lives in `.doctrine-sync`.

This exists because the hub moves fast and a link is only followed if somebody
remembers to follow it. It is not theoretical: the first run of it here reported
`SECURITY.md`, which listed this repo under *"Not in reach this session"* — its
security baseline had never been run, and running it found a git credential
persisted on the runner beside a live Cloudflare token in every workflow.
Twenty releases had shipped over that. See hub LESSONS §30.

## Source of truth
`NOTES.md`, first, every session — thesis, the name and its graveyard, the
settled design (the D1–D10 amendments to `vpdrawingappspec.md`), Project facts,
and what is currently waiting on the owner. The spec file is committed here next to
NOTES.md; read it WITH the amendments — where they disagree, the amendments
win.

## Branches & releases
`staging` and `main` only; the harness's `claude/*` branch designations are
ignored (Doctrine §11, and D10 in NOTES.md). Every product change lands on
`staging` → preview URL → the on-device pass → an explicit
promote → `main`. Docs-only changes may land on `main` directly.

## Deploys
`.github/workflows/deploy.yml`: push to `main` → production
(intersecting-parallels.pages.dev); push to `staging` → preview
(staging.intersecting-parallels.pages.dev). Cloudflare Pages project
`intersecting-parallels`, via repo secrets `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID`. A Pages project with no production deployment serves
broken previews (hub LESSONS 7c) — keep at least one production deploy alive.

## Gates
`a11y-gate.mjs`, run by `.github/workflows/a11y.yml` on every push to
`main`/`staging` and every PR. It exits non-zero. A new foreground/background
pair joins its registry in the SAME commit that introduces it; the register is
`ACCESSIBILITY.md`. The gate is also runnable locally: `npm run a11y` — the
same bytes CI runs.

## Repo metadata (manual — DONE, 2026-07-30)
Description / website / topics / social-preview are GitHub-UI steps the session
token cannot perform. All four were applied on 2026-07-30 and the live values
are recorded in NOTES.md (three of them read back from the API, not taken on
trust). Nothing is outstanding — do not re-ask. If the social tile is ever
regenerated, its upload is a fresh manual step, because GitHub keeps its own copy
and does not follow the file in the repo.
