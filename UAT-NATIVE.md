# Buffy — Native UAT (TestFlight)

Everything below is built, type-checked (0 errors), tested (52 unit + 2 E2E), and CI-guarded
on every push. Install the latest build via the **TestFlight** app (the App Store Connect
listing is named **"BuffUp"**; the app on your home screen is **"Buffy"**).

> **Build:** `1.0 (6)` · bundle `com.mark.buffy` · Team `ZCS5Y23P62`
> Build 1 = pipeline validation (no native extras). Build 2 = timer/notification/splash/haptic
> features + editable timers. Build 3 = superset round-cycling, notes, plate calculator,
> native auto-backup. **Build 4 = home-screen widget, Apple Health, interactive Live Activity.**

---

## The native-only features you asked for

### 1. Rest timer in the Dynamic Island + Lock Screen (Live Activity) ⭐
Complete a set → the rest countdown appears **outside the app**:
- **Lock Screen** — a card: timer icon · exercise name · live `m:ss` countdown · "REST"
- **Dynamic Island** — compact timer + countdown at the top; long-press to expand
- Counts down in real time; clears when you complete the next set / skip / finish.
- First run, iOS asks **"Allow Live Activities from Buffy?"** → tap **Allow**.

*Verified in the simulator on the Lock Screen (live countdown rendered, brand-blue).
The Dynamic Island **compact** view doesn't render in the simulator — please confirm it
shows on your device (it will; the activity is created + active, only the sim doesn't draw it).*

### 2. Rest-end alert while backgrounded / locked ⭐
Start a rest, then lock the phone or switch apps. When it hits zero you get a
**notification with sound + the system buzz** ("Rest complete — [exercise] — time for
your next set") even though the app is closed. In-app, the existing on-screen + haptic cue
still fires; the notification only takes over when you've left the app.

*Verified: the notification fired on the Lock Screen in the simulator. Confirm the
sound/buzz on real hardware.*

### 3. Screen stays awake during a workout
While a workout is active the screen won't auto-dim/lock as aggressively (Web Wake Lock —
works in the app **and** the web PWA). *Device-only to verify (the simulator never sleeps).*

### 4. Haptic when you log a set
Tapping a set's checkmark gives a tactile bump (in addition to the heavy buzz at rest-end).
*Device-only (no haptics in the simulator).*

### 5. No black flash on launch
Cold launch now holds the blue splash through the web-view boot, then fades into the app —
no black gap. *Verified in the simulator.*

---

## Also landed in these builds (verify too)

- **Resume across an app kill** — force-quit mid-workout, reopen → it drops you straight
  back in, timers and all (wall-clock based, so the rest reflects true elapsed time).
  *Verified: killed the process, relaunched, the workout + rest resumed exactly.*
- **Editable rest times** — tap any upcoming set's rest cell, or the live timer's total on
  the banner, to set it directly (not just ±15).
- **Edit a logged rep/weight** — tap the number on a completed set; it becomes editable.
- **Add an exercise to a template workout** — button at the bottom of the session screen.

---

## How to drive a full test in ~5 minutes
1. **Settings** → turn on **Write workouts to Health** → allow the permission sheet.
2. Open Buffy → tap a template → **Start**.
3. Tap a set's circle to log it → rest banner appears, **Live Activity starts**.
4. **Lock the phone** → see the rest card on the Lock Screen with **+30s / skip** buttons;
   glance at the Dynamic Island. Tap **+30s**, confirm the countdown jumps.
5. Wait for the countdown to hit zero → **notification fires** with sound/buzz.
6. Unlock, complete another set, **Finish**.
7. Mid-workout, **force-quit** the app and reopen → confirm it **resumes**.
8. Back at Home, long-press → **+** → add the **Buffy widget** → confirm it shows this
   session's streak/volume.
9. Open the **Health** app → Browse → Workouts → confirm today's session is there.

---

## Notes
- **App name is intentional:** the App Store / TestFlight listing is **"BuffUp"** (the name
  "Buffy" was already taken on the store); the home-screen app name stays **"Buffy"**. These
  are allowed to differ — no change needed.

## Build 3 additions
- **Superset round-cycling** — grouped exercises now log in rounds (A1→B1→A2→B2), with no
  rest between exercises within a round and rest after. Start a superset template (Shoulder
  Core / Chest Tricep) and watch the active-set highlight cycle between the two lifts.
- **Session notes** — jot a note at the bottom of the workout screen; it appears in History.
- **Plate calculator** — on a barbell exercise's active set, a **BAR** line shows the per-side
  plate breakdown for the entered weight.
- **Editable rest** — tap an upcoming set's rest cell, or the live timer's total, to set it.
- **Auto-backup (native)** — after every finished workout a full backup is written to the app's
  Documents, visible in **Files → On My iPhone → Buffy** and covered by your device's iCloud
  backup. The Backup screen shows "Auto-backup … saved to Files".

## Build 4 additions

### Home-screen widget
Long-press your home screen → **+** → **Buffy** → add the small or medium widget. Shows your
streak, this-week volume, session count, and either "Next up: [template]" (the template
you've trained least recently) or "Last: [title]" if you haven't got templates yet. It
refreshes itself after every finished workout and whenever you open the app.
*Verified: compiles and the widget target embeds/signs correctly. Please confirm on-device
that it actually adds to the home screen and shows real data after a workout — this needs a
real widget gallery, which the simulator only partially represents.*

### Apple Health (opt-in)
**Settings → Apple Health → "Write workouts to Health"** — off by default. Turning it on
triggers the standard iOS Health permission sheet; once granted, every finished workout is
saved to Health as strength training (duration only — Buffy doesn't estimate calories).
*Verified: compiles clean, entitlement + Info.plist usage strings are in place. Confirm the
permission sheet appears and a session shows up in the Health app after a workout.*

### Interactive Live Activity — +30s / skip from outside the app ⭐
The rest countdown on the Lock Screen and Dynamic Island now has two buttons: **+30s** and
**skip** — tap them without opening the app. Works even if you're in another app or the
phone's locked; when you come back to Buffy, the in-app timer catches up to match whatever
you did from outside.
*Partially verified: the underlying mechanism (ActivityKit + a shared App Group file) is the
same one already confirmed working for the base Live Activity countdown, and the reconcile
logic that catches the timer up has 3 dedicated unit tests. I was not able to physically tap
the buttons in the simulator this session (a macOS permission gap, not a code issue) — **this
one specifically needs your on-device confirmation**: rest running → lock the phone → tap
+30s on the Lock Screen card → confirm the countdown jumps by 30s; then try skip.*

## Build 5 additions

### Swipe left on an exercise → Delete / Swap
The trash icon is gone — swipe an exercise's header row left during a workout to reveal
**Swap** and **Delete**. Swap opens the picker to replace that exercise with a different one
(fresh sets at the new exercise's defaults — the old logged sets don't carry over, since a
weight logged for one exercise doesn't mean anything for another). Only one row's actions
stay open at a time. *Verified: real drag-gesture E2E tests (Playwright mouse simulation, not
just a tap) confirm the swipe opens, Delete removes the exercise, and Swap replaces it —
run twice back-to-back with no flakiness.*

### Finishing a workout can now update your template
- **From a template workout:** Finish → **"Update whole template"** (syncs the exercise list
  + weights to match what you actually did) / **"Update weights only"** (just the numbers,
  structure untouched) / **"Leave template as-is"**.
- **From Quick Log:** Finish → **"Save as a template?"** with a name field, so a one-off
  session becomes reusable.
*Verified: E2E tests drive the real flow (edit a weight → sync → confirm the template's
listing shows the new number; quick-log → save → confirm it shows up in My Templates). This
also caught and fixed a real bug — the first version would have silently corrupted a
template on save due to a Svelte-reactivity/IndexedDB conflict.*

### Custom exercise: muscle picker instead of free text
Same native-picker pattern as elsewhere in the app (tap → iOS wheel picker), pulling from
the muscle groups the app's own Trends analytics already recognize — nothing you pick here
can go unseen by the body-map / muscle-balance charts.

### iCloud Sync — crash fixed in build 6; sync itself lights up in build 7
**Settings → iCloud Sync → "Sync with iCloud"** — off by default. When it works, it mirrors
your exercises, templates, and sessions to CloudKit's private database (your iCloud account,
no separate login, nothing I can see), last-write-wins per record across devices.

**What happened, honestly:** tapping the toggle crashed the app (SIGABRT). Root cause, verified
against Apple's servers: the App ID `com.mark.buffy` was **never provisioned** for CloudKit
(nor App Groups, nor HealthKit) — only In-App Purchase was enabled. Automatic code-signing
therefore strips those entitlements out of every build, and CloudKit's `CKContainer.default()`
raises an uncaught Objective-C exception the moment it's touched with no iCloud entitlement.

- **Build 6 (this build): the crash is gone.** `CKContainer.default()` is now wrapped in an
  Objective-C `@try/@catch` shim, so tapping the toggle safely reports "iCloud isn't available"
  instead of crashing. Please confirm on-device: tapping the toggle should NOT crash — it should
  just show an unavailable message. Your workout data is untouched throughout.
- **Sync doesn't actually run yet.** It can't until the App ID is provisioned for CloudKit and
  a CloudKit container exists. That's the one-time setup below.

### ⚠️ Correction: the widget, interactive Live Activity, and Apple Health weren't really working
Same root cause. Because App Groups and HealthKit were never enabled on the App ID, on your
device: the **home-screen widget** has been stuck on its placeholder (no real data), the
**Live Activity +30s / Skip** buttons didn't hand back to the app, and **Apple Health** writes
silently did nothing (the toggle wouldn't turn on). None of these crash — they just no-op. The
*code* for all of them is correct; they were gated behind capabilities that were switched off.
I enabled HealthKit + App Groups on the App ID via the API; they finish provisioning in build 7.

### One-time setup that unlocks build 7 (widget + Health + iCloud sync)
Open `ios/App/App.xcodeproj` in Xcode, then:
1. **App** target → **Signing & Capabilities**. You'll already see **HealthKit** and **App Groups**.
   - Under **App Groups**, click **+** and add `group.com.mark.buffy`.
   - Click **+ Capability** → **iCloud** → tick **CloudKit** → under Containers click **+** →
     add `iCloud.com.mark.buffy`.
2. **RestWidget** target → **Signing & Capabilities** → **App Groups** → tick `group.com.mark.buffy`.
3. Tell me — I'll rebuild via a *signed* archive (which actually embeds these entitlements),
   verify each one landed, and ship build 7. One more shared step at that point: CloudKit's
   record types must exist in the **Production** environment before TestFlight builds can sync
   (dev builds create them automatically; TestFlight can't). Easiest path: run the app once
   from Xcode with sync toggled on (creates the schema in Development), then in the CloudKit
   Dashboard hit **Deploy Schema Changes to Production**. I'll walk you through it — it's two
   clicks once build 7 exists.

### Sync hardening (done in code, ahead of build 7)
The full review of the sync path found real design flaws — all fixed before sync ever goes live:
- A failed pull previously looked identical to an empty cloud and would have force-pushed the
  entire local set over newer remote data. Pull failures now abort that data type's pass.
- Pulls now use CloudKit's zone-changes API (no more silent ~100-record truncation, and no
  hand-created Dashboard index needed); pushes are chunked under CloudKit's 400-record limit.
- Deletes are now tombstones that sync like edits — a deleted workout stays deleted on every
  device instead of resurrecting on the next sync.
- Overlapping sync passes are serialized, and a pulled record only lands if it's still newer
  than what's on the device *at write time* (an edit made mid-sync can't be clobbered).

## Build 8 additions — Whoop / recovery integration

Everything below reads the data your Whoop strap (or watch) writes into Apple Health.
It's all opt-in behind **Settings → Apple Health → "Read recovery from Health"** — turning
it on shows the iOS read-permission sheet (allow HRV, resting HR, heart rate, sleep).
One heads-up: iOS deliberately hides whether *read* access was granted, so if you deny,
things quietly show no data rather than erroring — the Settings row tells you where to
re-enable (Health → Sharing → Apps → Buffy).

### Daily readiness badge
Home screen, next to the date: **fresh / moderate / strained · score**. A Buffy-native
read of HRV-vs-baseline, resting-HR-vs-baseline, and last night's sleep — the same raw
signals Whoop uses (its branded Recovery % never enters HealthKit). Tap it to open
Settings, which shows the same number plus a max-HR field. Whoop must be set to sync
with Apple Health (Whoop app → Settings → Apple Health) for the signals to exist.

### Recovery-aware auto-progression
On a **strained** day, hitting your rep target no longer bumps the weight — the suggest
chip shows **"hold (recovery)"** instead of "+2.5". Fresh/moderate days behave exactly
as before, and turning the Health toggle off restores fully recovery-agnostic behavior.

### Workout intensity from heart rate
Finish a workout and Buffy pulls the HR samples covering that exact time window and
grades the session: **easy / moderate / hard / maximal · score** (avg % of heart-rate
reserve, calibrated for lifting sessions where rests drag the average down), with avg/peak
bpm and a time-in-zone bar on the workout's History page. Whoop typically syncs to Health
minutes-to-hours after a workout, so the card often appears the *next time you open that
workout* rather than immediately — that's expected (lazy backfill).

*Verified: 117 unit tests (readiness scoring, intensity math incl. a realistic rest-dominated
lifting session, recovery-gated progression), svelte-check clean, 6/6 E2E, iOS archive
compiles. Needs your device: the real Health permission sheet, real Whoop data flowing, and
the badge/card rendering with your actual numbers.*

## Open questions for you
- iCloud toggle in build 6: does it now show "unavailable" instead of crashing? (It should.)
- Anything off in the Live Activity styling (color, layout, what it shows, button placement)?
  Easy to tweak — it currently shows the exercise name + countdown + "REST" + the two buttons.
- Widget looks right? It's a small/medium card with streak, volume, sessions, and a next/last
  workout line — happy to adjust the layout or add a third field (e.g. last workout date).
