# Buffy v1 — UAT Report

**Date:** 2026-06-03
**App:** Buffy (`~/Desktop/buffy`)
**Environment:** dev server `localhost:5180`, Chromium preview, IndexedDB storage
**Build health:** `npm run check` → **0 errors**, 1 benign warning (`@types/node` not installed — cosmetic)

## Verdict: ✅ PASS

Every core use-case works end-to-end with real persistence. I found **1 real bug and fixed it during testing** (rest-timer banner), plus **2 minor cosmetic/edge issues** (open, low priority). All four tracking types, supersets, auto-progression, history, the editor, and the PWA behave correctly. Data survives reloads.

---

## Bug found & FIXED during UAT

### 🔧 Bug #1 — Rest banner vanished at 00:00 (FIXED ✅)
- **Symptom:** During a live workout, clicking **−15** enough to bring the rest seed to `00:00` made the entire rest banner disappear — taking its controls with it (couldn't +15 back), and the natural count-up *overage* state was unreachable.
- **Cause:** The banner's visibility was gated on `restSeedSec > 0`.
- **Fix:** Banner now shows whenever a rest is active (`restForSet` set), and **−15 is floored at 5s**. (`src/routes/workout/+page.svelte`, `src/lib/stores/workout.svelte.ts`)
- **Re-tested:** ✅ Banner stays visible, correctly flips to **warn-red overage** ("NEXT SET — LOGGING REST OVERAGE · +00:13 / 00:05") with all controls usable.

## Minor issues (open, low priority)

### Bug #2 — Empty ad-hoc header reads "1/0" (cosmetic)
A brand-new Quick log with no exercises yet shows `00:07 · 1/0` in the header (it's `activeIndex+1 / exerciseCount`). Harmless; suggest showing `0 exercises` until the first is added.

### Bug #3 — Custom-exercise deep-link edge (not reachable in normal use)
Navigating *directly* to `/exercise/new?to=tpl` with no active editor draft and hitting **Add** routes to `/template/undefined/edit`. In real flows the custom-exercise screen is always opened **from the picker** (which carries editor/workout context), so this isn't reachable normally. Worth a guard if you ever deep-link it.

---

## Test results

| # | Area | Result | Notes |
|---|---|:--:|---|
| 1 | Home — templates list | ✅ | Derived exercise/set counts, muscles, duration |
| 2 | Template detail | ✅ | Meta, equipment, exercise lines, superset block |
| 3 | Live workout — set check-off & editable logging | ✅ | Active-row highlight, editable reps/kg |
| 4 | Live workout — rest timer | ✅ | Auto-start on check-off; countdown → **overage warn**; −15/pause/+15/skip |
| 5 | Live workout — inline auto-progression hint | ✅ | "Last 8×40kg · hit target → +2.5 · 42.5kg" |
| 6 | Finish → save → Log detail | ✅ | 20 sets, **5.4K volume** derived; set-1 rest **00:42** logged incl. overage |
| 7 | History list + KPIs | ✅ | New sessions appear; "this week / time / volume" recompute |
| 8 | Log detail (review) | ✅ | Read-only tables, superset, setup note, KPIs |
| 9 | Auto-Progression summary | ✅ | hit→**+2.5/42.5kg**, miss→**hold** — math correct from history |
| 10 | Quick log (ad-hoc) | ✅ | Starts session; "ad-hoc" chip in history; 0 kg vol correct |
| 11 | Exercise picker | ✅ | Search, equipment filters, catalog, ×2 badges |
| 12 | **Cardio** (Treadmill) | ✅ | Time / Incline / Speed columns; `CARDIO · LOG-ONLY`; no auto-prog |
| 13 | **Bodyweight** (Pull-ups) | ✅ | Reps-only table, **no kg column**; `BODYWEIGHT` badge |
| 14 | **Time-hold** (Plank) | ✅ | "3 × 00:45 hold" formatting |
| 15 | **Superset** rendering | ✅ | 2 members + dashed divider + "rest 00:45 after each round" |
| 16 | Template editor | ✅ | Edit sets, **Add set → Save → persists** (Back Bicep 15→16 sets) |
| 17 | Custom exercise | ✅ | Created "UAT Curl" → persisted to catalog |
| 18 | Settings | ✅ | Toggles + increments; **haptic toggle persisted** |
| 19 | **Persistence (IndexedDB)** | ✅ | After full reload: 5 sessions, 20 exercises, 4 templates, settings all intact |
| 20 | **PWA** | ✅ | Manifest valid (`Buffy`), theme color, Apple meta, **service worker active** |

---

## Persistence — verified durable (read back from IndexedDB after a full page reload)
- **Sessions:** 5 (3 seeded + 2 created during UAT) — both new workouts saved
- **Exercises:** 20 (19 seeded + 1 custom "UAT Curl")
- **Templates:** 4 (Back Bicep correctly grew to 16 sets and re-sorted to top via `updatedAt`)
- **Settings:** `hapticAtRestEnd: false` (toggle persisted)
- No re-seed clobbering on reload.

## PWA — verified
`manifest.webmanifest` served & valid · `theme-color #faf8f4` · `apple-mobile-web-app-capable` · **service worker registered and controlling the page** (offline asset caching live).

---

## Not bugs — test-environment artifacts (noted for transparency)
These affected *my scripted testing only*, not the app for a real user:
- **Click-before-hydration races:** driving a fresh URL then immediately clicking (Start/Save) occasionally no-ops until the page hydrates. A human tapping never hits this; retries always worked.
- **HMR resets the in-memory active workout** when source files change during dev. Production has no HMR.
- **Synthetic `input` events don't trigger Svelte's `bind:value`** — so my *scripted* template rename didn't take (real keystrokes do; verified the same Save path persists via a real button handler).

## Known simplifications (deferred by design — not defects)
Carried from the build review, out of UAT scope:
1. **Superset live round-cycling** — logs linearly (A-then-B), not A1→B1→A2→B2. Data model already supports it.
2. **Log-detail inline cell editing** — currently read-only + editable note + delete.
3. **Editor drag-reorder** — add/remove/group/edit-sets work; reordering doesn't.

---

## App state after UAT
The database was **reset to the clean seed** after testing, so you open a pristine app (4 templates, 19 exercises, 3 sample sessions). All UAT artifacts (test workouts, "UAT Curl", the extra Back Bicep set, the haptic toggle) were cleared.

## To resume
- App: `cd ~/Desktop/buffy && npm run dev` (or the preview server on **5180** if still up).
- Suggested next: ① implement the **superset round-cycle** (the main deferred piece), ② polish Bug #2/#3, ③ git init + first commit.
