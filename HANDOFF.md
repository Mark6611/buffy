# Buffy / BuffUp — engineering handoff

Everything a new engineer (or a fresh Claude session) needs to be productive without
re-deriving it. Written 2026-09-07 at commit `da6f768`. Every figure below was checked
against the repo, not estimated.

| | |
|---|---|
| **Local path** | `~/Desktop/buffy` (`/Users/kornkrankeeratitejakarn/Desktop/buffy`) |
| **GitHub** | https://github.com/Mark6611/buffy (public, `main`) |
| **App Store** | https://apps.apple.com/th/app/id6785999682 — listing **BuffUp**, home-screen name **Buffy**. The storefront-less URL 404s; the app is on the TH storefront. |
| **Web** | https://buffy-six.vercel.app (also hosts the Whoop OAuth functions in `api/`) |
| **Bundle / Team** | `com.mark.buffy` / `ZCS5Y23P62` · ASC app id `6785999682` |
| **Live now** | 1.3 (build 19) · **1.4 (build 20) is `WAITING_FOR_REVIEW`**, auto-releases |
| **Size** | `src/` is 15.1k lines / 99 files (13.6k of it in `routes` + `lib`) · 277 unit tests · 2 E2E specs, 10 cases |

What this app is: a **single-user, local-first** gym workout logger. The canonical
database is on-device IndexedDB; CloudKit is an opt-in mirror, not a backend. There is no
server, no account, no analytics.

---

## 1. Repository directory

```
~/Desktop/buffy
├── src/                               99 files, 15.1k lines
│   ├── routes/                        20 files, 3.7k lines — every screen
│   │   ├── +layout.svelte             app shell; on COLD LAUNCH from `/` only, redirects
│   │   │                              to /workout when one is live (deep links survive)
│   │   ├── +page.svelte               HOME: template cards, usage stats, one-tap start
│   │   ├── workout/                   THE screen — live logging, rest timer, spread chip
│   │   ├── picker/                    exercise picker (search + equipment chips)
│   │   ├── exercise/new/              custom exercise creation
│   │   ├── template/[id]/             view · edit/ · progression/
│   │   ├── history/                   list · [id]/ detail (+ lazy intensity backfill)
│   │   ├── trends/                    charts · backup/ · muscles/ · progression/
│   │   ├── quick/  settings/  privacy/  whoop/callback/
│   │
│   ├── lib/                           75 files, 9.9k lines
│   │   ├── db/                        >> THE BOUNDARY
│   │   │   ├── repository.ts          the ONLY storage interface (26 methods)
│   │   │   ├── dexie.ts               the IndexedDB implementation (schema v4)
│   │   │   ├── index.ts               singleton accessor — how callers get the repo
│   │   │   └── seed.ts                default catalog + templates
│   │   ├── stores/                    Svelte 5 runes state
│   │   │   ├── workout.svelte.ts      active-workout state machine (the big one)
│   │   │   ├── editor.svelte.ts       template draft editor
│   │   │   ├── settings.svelte.ts  recovery.svelte.ts  whoop.svelte.ts
│   │   ├── components/                13 components + charts/
│   │   ├── native.ts                  >> THE OTHER BOUNDARY — Capacitor access
│   │   │                              (one live exception, see section 2)
│   │   ├── types.ts                   the data model (see section 3)
│   │   ├── progression.ts             double-progression + topCompletedLoad anchor
│   │   ├── exerciseSearch.ts          picker matching + filterCatalog (see section 5)
│   │   ├── templateSync.ts            push finished weights back to the template
│   │   ├── analytics.ts  compute.ts  templateStats.ts  widgetSync.ts  cloudSync.ts
│   │   ├── calories.ts  intensity.ts  sessionIntensity.ts  readiness.ts
│   │   ├── whoopMatch.ts  healthPrivacy.ts  plates.ts  format.ts  charts.ts
│   │   └── data.ts  historyFormat.ts  math.ts  id.ts  icons.ts  index.ts
│   ├── app.css                        the entire design system (tokens, Dynamic Type) — 1.4k lines
│   └── service-worker.ts  app.html  app.d.ts
│
├── ios/App/                           Capacitor shell (Xcode project)
│   ├── App/                           4 Capacitor plugins — CloudSync, Health,
│   │                                  RestActivity, WidgetData — plus AppDelegate
│   │                                  and ViewController (which registers them)
│   ├── RestWidget/                    home-screen widget + Live Activity
│   ├── Shared/                        app-to-widget shared code (App Group)
│   ├── CapApp-SPM/                    Capacitor's Swift package shim
│   └── App.xcodeproj                  >> MARKETING_VERSION appears 4x (see section 5)
│
├── native-pilot/                      standalone SwiftUI pilot — NOT shipped (section 7)
├── api/whoop/                         Vercel functions: config.ts, token.ts (OAuth)
├── e2e/                               fresh.ts (shared preamble) + workout.spec + picker.spec
├── scripts/                           see section 4
├── static/                            PWA manifest, icon, robots.txt
├── assets/                            Capacitor icon + splash sources
├── docs/screenshots/                  README images
├── .github/workflows/ci.yml           CI (see section 4)
├── appstore-screenshots-6.5/          1242x2688 — the submitted iPhone set (gitignored)
├── appstore-screenshots-ipad13/       2048x2732 — the submitted iPad set (gitignored)
├── appstore-screenshots/              STALE 6.9-inch set, unreferenced (section 7)
└── CLAUDE.md  README.md  HANDOFF.md  UAT-*.md  APP-STORE-SUBMISSION.md
```

---

## 2. Two architectural boundaries

1. **All storage goes through `src/lib/db/repository.ts`** (26 methods). Components and
   stores never import Dexie; they get the singleton from `db/index.ts`. This boundary
   is clean — verified, no direct Dexie imports outside `db/`.

2. **Native access goes through `src/lib/native.ts`** — with **one live exception you
   need to know about**: `src/lib/stores/whoop.svelte.ts` imports Capacitor directly at
   two sites, `@capacitor/preferences` (line 61) and `CapacitorHttp` from
   `@capacitor/core` (line 194). Note `native.ts` already exports a `nativeHttpGet`
   wrapper, so the second one is duplicated rather than necessary. Treat this as a
   cleanup candidate, not a pattern to copy.

Swift plugins live in `ios/App/App/*.swift` and must be registered in `ViewController`.

Consequence worth knowing: `npm run dev` gives you the whole app in a browser. You only
need Xcode for the widget, Live Activity, HealthKit and CloudKit paths.

---

## 3. Data model (`src/lib/types.ts`)

`Exercise` produces `Template` (`TemplateExercise` + `PlannedSet` + `SupersetGroup`),
which produces `WorkoutSession` (`LoggedExercise` + `LoggedSet`), plus `Settings` and
`BodyWeightEntry`.

Rules that are load-bearing:

- **A completed set is a record, not a plan.** Nothing rewrites a set with `completed:
  true` — the spread chip, the mid-workout primer and template sync all skip them.
- Sessions reach the repository **only on finish()**. An in-progress workout lives in
  `localStorage` under `buffy:activeWorkout` so a killed WebView resumes exactly.
- The rest timer is **wall-clock derived** (`restStartedAtMs` + `nowMs`), never
  tick-accumulated — iOS freezes JS timers when suspended.
- **Dexie is at schema v4.** Any field rename in `types.ts` needs a `version(n).stores()`
  **plus an `upgrade()` in the same commit** — shipped sync has broken twice without it.
- Body weight is **local-only** health data: never synced, hard-deleted (5.1.3(ii)).

---

## 4. Commands and tooling

```bash
npm run dev          # browser, full app
npm run check        # svelte-check — 465 files, must be 0 errors
npm test             # vitest — 277 unit tests
npm run test:e2e     # Playwright; CI=1 runs it against the PRODUCTION build
npm run build:ios    # BUILD_TARGET=capacitor vite build -> build/
npm run ios:open     # Xcode
```

`scripts/`:

| Script | What it does |
|---|---|
| `ship.sh` | **The** TestFlight pipeline: 3 gates, preflight, signed archive, entitlement check, upload, tester group, commit the bump. Run it **unpiped** (see section 5). |
| `asc-preflight.mjs [build] [--strict]` | Answers "can I ship right now?" *before* the 15-minute archive. `--strict` for App Store runs. |
| `asc-api.mjs` | Minimal ASC REST client (ES256 JWT). `GET/POST/PATCH <path> [json]`. |
| `asc-screenshots.mjs <locId> [--replace]` | Uploads the two screenshot sets. `--replace` is required for a new version, because ASC carries the old images forward. |
| `gen-shots.mjs` | Regenerates all 12 App Store screenshots from a seeded production build. |
| `verify-*.mjs` | Accessibility gates: contrast, hit targets, semantics, Dynamic Type. |

CI (`.github/workflows/ci.yml`) runs check + unit + build, and E2E in a second job.

---

## 5. Traps that have already cost real time

1. **Mixed OR/AND logic is unsafe in `.svelte` and `.svelte.ts` files.** The production
   bundle strips the grouping parentheses, so `(a || b) && c` ships as `a || (b && c)`.
   Verified 2026-09-05 to be **Rolldown's handling of vite-plugin-svelte output** — not
   Svelte's compiler, not the minifier; identical shapes in plain `.ts` keep their
   parens. Has shipped four bugs, most recently a picker search that silently did
   nothing. **Put such logic in a plain `.ts` module or write it as statements.** Sweep
   with a grep over `src` limited to `*.svelte` and `*.svelte.ts`, looking for a
   parenthesised OR adjacent to an AND. Unit tests cannot see this — only a
   production-bundle E2E can.
2. **Never gate a ship on a piped command.** A pipeline reports the *last* command's exit
   code; that shipped a bricked build once. Redirect to a log and echo `$?` instead.
3. **A LIVE marketing version blocks even TestFlight uploads** (Apple error 90062).
   Bumping only the build number is not enough. `asc-preflight.mjs` now blocks this
   before the archive.
4. **`MARKETING_VERSION` appears 4x in the pbxproj** — App and RestWidget, Debug and
   Release. Xcode's General tab bumps only two of them.
5. **ASC carries screenshots forward silently.** Filenames repeat, so the only proof you
   shipped the right images is comparing `sourceFileChecksum` against the local files.
6. **Confirm TestFlight state via `buildBetaDetail`**, not the build's `betaGroups`
   relationship — the latter reads "(none)" even for builds that are demonstrably
   distributed.
7. **Pinch-zoom is disabled app-wide** by Capacitor (`zoomingEnabled` defaults to NO), so
   never claim it works. Re-enabling it is a real WCAG 1.4.4 question and a
   `capacitor.config.ts` change.

---

## 6. Shipping

**TestFlight:** commit everything, then run `scripts/ship.sh` unpiped. It computes the
next build number, hard-fails on any gate, and commits the bump itself.

**App Store:** run `node scripts/asc-preflight.mjs --strict` first, then via `asc-api.mjs`:
create the `appStoreVersion`, `PATCH .../relationships/build`, set `whatsNew` on the
en-US localization, handle screenshots (carry forward only if no screenshotted screen
changed, and verify checksums), create a `reviewSubmission`, add a
`reviewSubmissionItem`, then PATCH `submitted: true`. If the first attempt errors it can
leave an **empty stuck draft submission** — delete it before retrying.

---

## 7. State of play

**Done and live:** 1.0 through 1.3 on the App Store. 1.4 (build 20) submitted
2026-09-07, `WAITING_FOR_REVIEW`, auto-releases. It fixes the picker search that live 1.3
still ships broken, plus two other paren-drop sites, and prefills a mid-workout
exercise's weight from your last session.

**Open items:**

- **Dynamic Type has never had its on-device XXXL/AX pass**, though it is now live in
  1.3. If a version is ever rejected on layout, look there first.
- The `whoop.svelte.ts` Capacitor imports bypass the `native.ts` boundary (section 2).
  One of the two duplicates an existing wrapper.
- `native-pilot/` is a **2-screen SwiftUI experiment, not a product direction.** It
  proved the double-tap-zoom fix did not need a rewrite (one CSS line did it). Its own
  README has the honest cost list. Delete it freely if it stops earning its keep.
- **Both UAT docs are stale.** `UAT-NATIVE.md`'s header still says build 6 / 52 tests
  though its body runs through build 13; `UAT-REPORT.md` is a 2026-06-03 browser-only
  pass against a dev server. Read both as history, not status.
- `appstore-screenshots/` in the repo root is a **stale 6.9-inch set** (1320x2868) that
  nothing references — the live sets are `-6.5` and `-ipad13`. Untracked; safe to delete.

**Conventions:** plain commit messages, no AI attribution. Comments explain *why*,
especially where the code looks odd on purpose — most of those comments are load-bearing
records of a bug that already shipped once.
