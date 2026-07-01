# Buffy — Native UAT (TestFlight)

Everything below is built, type-checked (0 errors), tested (37/37), and runs in the
simulator. Install the latest build via the **TestFlight** app (the App Store Connect
listing is named **"BuffUp"**; the app on your home screen is **"Buffy"**).

> **Build:** `1.0 (2)` · bundle `com.mark.buffy` · Team `ZCS5Y23P62`
> Build 1 = the app with no native extras (pipeline validation). Build 2 = everything below.

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

## How to drive a full test in ~2 minutes
1. Open Buffy → tap a template → **Start**.
2. Tap a set's circle to log it → rest banner appears, **Live Activity starts**.
3. **Lock the phone** → see the rest card on the Lock Screen; glance at the Dynamic Island.
4. Wait for the countdown to hit zero → **notification fires** with sound/buzz.
5. Unlock, complete another set, **Finish**.
6. Mid-workout, **force-quit** the app and reopen → confirm it **resumes**.

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

## Staged for a focused follow-up
Each of these is a substantial native feature with its own entitlement + device testing, so I
staged them rather than rush under one session:
- **Home-screen widget** (streak / weekly volume) — needs an App Group to share data app→widget.
- **Apple Health** write — needs the HealthKit capability, usage strings, and a permission flow.
- **Interactive Live Activity** (+time / skip from the Dynamic Island) — needs App Intents + shared state.
- **Full iCloud Drive roaming** — today's auto-backup covers device loss; cross-device roaming
  needs the iCloud capability + a portal container (the part with archive/signing risk).

## Open question for you
- Anything off in the Live Activity styling (color, layout, what it shows)? It's easy to
  tweak — it currently shows the exercise name + countdown + "REST".
