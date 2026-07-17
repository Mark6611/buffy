# Buffy (BuffUp)

Personal workout tracker — a local-first SvelteKit PWA that ships to iOS via Capacitor (TestFlight → App Store as **BuffUp**). Tracks workouts, sets, and progression; integrates Whoop recovery data; syncs across devices via CloudKit (iCloud) on native builds.

- **Local-first:** all workout data lives on-device in IndexedDB (Dexie); no account required.
- **Whoop integration:** OAuth through Vercel serverless functions (`api/whoop/`), recovery + strain shown alongside training.
- **Analytics:** trends, muscle heatmaps, progression tracking, readiness/intensity scoring.
- **Native:** Capacitor iOS shell with widget sync and health-data privacy handling.

## Where the main code lives

**`src/` is the app.** `api/` hosts the Whoop OAuth serverless functions (deployed with the web app on Vercel). Everything else at the root is packaging and tooling.

```text
src/
├── routes/              Pages (SvelteKit file-based routing)
│   ├── +page.svelte       Home / today
│   ├── workout/           Active workout session
│   ├── quick/             Quick-log entry
│   ├── history/           Past workouts (list + detail)
│   ├── trends/            Analytics: progression, muscle map, backup
│   ├── template/          Workout templates
│   ├── exercise/          Exercise editor
│   ├── picker/            Exercise picker
│   ├── whoop/             Whoop OAuth callback
│   └── settings/          Settings
└── lib/
    ├── db/              ⭐ Data layer — START HERE
    │   ├── repository.ts   The ONLY database entry point; components
    │   │                   never touch Dexie directly.
    │   ├── dexie.ts        IndexedDB schema
    │   └── seed.ts         Built-in exercise seed data
    ├── stores/          Svelte 5 rune stores: workout session, editor,
    │                    settings, recovery, whoop
    ├── components/      Reusable UI + `components/charts/` (sparklines,
    │                    heatmap, body map, line/bar charts)
    ├── analytics.ts     Trends + aggregate stats
    ├── progression.ts   Progressive-overload logic
    ├── readiness.ts     Recovery/readiness scoring
    ├── intensity.ts     Set/session intensity scoring
    ├── plates.ts        Barbell plate math
    ├── calories.ts      Calorie estimation
    ├── whoopMatch.ts    Matching Whoop activities to logged workouts
    ├── cloudSync.ts     iCloud/CloudKit sync (last-write-wins merge)
    ├── widgetSync.ts    iOS widget data bridge
    └── healthPrivacy.ts Health-data privacy handling
api/
└── whoop/               Vercel serverless functions for Whoop OAuth
                         (token exchange happens server-side; no secrets
                         in the client)
```

Supporting directories:

| Path | What it is |
|---|---|
| `ios/` | Capacitor-generated Xcode project |
| `e2e/` | Playwright end-to-end tests |
| `scripts/` | `ship.sh` — gated TestFlight pipeline (tests → signed archive → entitlement check → upload) |
| `*.md` | [APP-STORE-SUBMISSION.md](APP-STORE-SUBMISSION.md), [UAT-NATIVE.md](UAT-NATIVE.md), UAT report |

## Develop

```sh
npm install
npm run dev
```

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server |
| `npm test` | Unit tests (Vitest) |
| `npm run test:e2e` | Playwright e2e tests |
| `npm run check` | Type-check (svelte-check) |
| `npm run ios:sync` | Capacitor build + sync to the Xcode project |
| `npm run ios:open` | Open the Xcode project |
| `scripts/ship.sh` | Full TestFlight ship pipeline |

## Conventions

See [CLAUDE.md](CLAUDE.md) for project conventions (data model, ship rules, gotchas).
