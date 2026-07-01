# Buffy — Native UAT (TestFlight)

Everything below is built, type-checked (0 errors), tested (52 unit + 2 E2E), and CI-guarded
on every push. Install the latest build via the **TestFlight** app (the App Store Connect
listing is named **"BuffUp"**; the app on your home screen is **"Buffy"**).

> **Build:** `1.0 (4)` · bundle `com.mark.buffy` · Team `ZCS5Y23P62`
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

## Open question for you
- Anything off in the Live Activity styling (color, layout, what it shows, button placement)?
  Easy to tweak — it currently shows the exercise name + countdown + "REST" + the two buttons.
- Widget looks right? It's a small/medium card with streak, volume, sessions, and a next/last
  workout line — happy to adjust the layout or add a third field (e.g. last workout date).
