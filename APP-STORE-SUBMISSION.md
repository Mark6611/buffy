# Buffy → App Store submission pack

Everything you need to paste into App Store Connect for the 1.0 public release, plus the
status of each requirement. Review the copy, fill the three `<…>` placeholders, then follow
"Next steps" at the bottom. (App Store listing name is **BuffUp**; home-screen name is **Buffy**.)

---

## 1. App information (App Store Connect → App Information)

- **Primary category:** Health & Fitness
- **Secondary category:** Sports *(optional — helps discovery)*
- **Content rights:** does NOT contain third-party content → answer "No" *(the Whoop name is
  used functionally to label a connection, not as displayed third-party content; if App
  Review ever asks, you're connecting to Whoop's official API per their developer terms).*
- **Age rating:** already completed in App Store Connect. When reviewing the 2026 questionnaire,
  the "Medical/Wellness" question → this app shows fitness/wellness info but gives **no medical
  advice/diagnosis** → answer accordingly (expected result 4+).
- **Privacy Policy URL:** `https://buffy-six.vercel.app/privacy` ✅ (page built this session —
  goes live on the next web deploy; also linked inside the app under Settings → Data).

## 2. Version 1.0 metadata (App Store Connect → the 1.0 version)

**Subtitle** (≤30 chars):
```
Private strength training log
```

**Promotional text** (≤170 chars, editable anytime without review):
```
Log lifts in seconds. Rest timer on your Lock Screen, auto-progression, and — if you want — Apple Health and WHOOP recovery. No account, no ads.
```

**Description:**
```
Buffy is a fast, private strength-training log for lifters who just want to train and track
progress — no account, no ads, no clutter.

TRAIN
• Build templates, then log sets, reps and weight in a couple of taps
• Rest timer that keeps counting on your Lock Screen and Dynamic Island
• Supersets, plate calculator, and per-set notes
• Auto-progression suggests your next weight when you hit your target reps

RECOVERY-AWARE (optional)
• Connect Apple Health to see a daily readiness read from your HRV, resting heart rate and sleep
• On a strained day, Buffy holds your progression instead of pushing
• Connect WHOOP for your real Recovery %, day Strain and per-workout data

KNOW YOUR EFFORT
• Every finished workout gets a heart-rate–based intensity and calorie estimate
• Write workouts to Apple Health so lifting closes your Move ring

PRIVATE BY DESIGN
• Your data lives on your device. No account to create.
• Optional iCloud sync keeps your own devices in step — through your private iCloud only
• Health data is never uploaded to iCloud and never used for ads or tracking

Buffy is built for one person: you.
```

**Keywords** (≤100 chars, comma-separated, no spaces):
```
workout,gym,strength,lifting,tracker,sets,reps,progression,superset,rest timer,whoop,recovery
```

**Support URL:** `https://buffy-six.vercel.app`  *(marketing/support landing — see placeholder note)*
**Marketing URL:** *(optional — leave blank or same as above)*

**What's New in This Version** (1.0):
```
First public release of Buffy.
```

## 3. App Privacy ("nutrition label" — App Store Connect → App Privacy)

**Recommended answer: "Data Not Collected."** Rationale, and why it's honest for this app:
- All workout data is stored **on the user's device**; optional sync uses the user's **own
  private iCloud** (CloudKit), which the developer cannot access.
- **Health data is excluded from iCloud** entirely (enforced in code as of this build).
- The WHOOP sign-in helper on Vercel is **stateless** — it relays OAuth and stores nothing;
  WHOOP tokens live only on the device.
- No analytics, ads, or tracking SDKs; no device identifier collected.

⚠️ If you ever add a server that *stores* user data (e.g. a Whoop data cache or a real backend),
this must change to declare **Health & Fitness — linked to you**. Not the case today.

## 4. App Review notes (App Store Connect → Version → Notes for Review)

```
Buffy is a personal strength-training tracker. It requires NO account and works fully offline —
you can review the core experience immediately: create a template or Quick Log, start a workout,
log sets, and finish to see it in History.

Optional integrations (the app is fully functional without them):
• Apple Health — when you enable "Read recovery from Health" or "Write workouts to Health" in
  Settings, iOS shows the standard permission sheet. Reading HRV/heart rate/sleep powers the
  readiness badge and calorie estimate; writing saves finished workouts to Health.
• WHOOP — an optional third-party connection via WHOOP's official OAuth. A WHOOP account and
  device are required to see live WHOOP data, so a reviewer without WHOOP will see the "Connect"
  state; this does not affect any core feature. We can provide a screen recording of the
  connected flow on request.
• iCloud Sync — optional, off by default; mirrors workouts (never health data) to the reviewer's
  own private iCloud.

No login, no ads, no analytics. Privacy policy: https://buffy-six.vercel.app/privacy
```

## 5. Screenshots — STILL NEEDED (next step)
- Required: one **6.9" iPhone** set (1–10 images) showing the app in use (not a splash/login).
- iPad set only if you ship iPad — Buffy is iPhone-first, so not required.
- I can capture these from the iOS Simulator with seeded sample data; see Next steps.

---

## Placeholders to fill before submitting
1. **`<your-support-email>`** in `src/routes/privacy/+page.svelte` (the policy's Contact line).
2. **Support URL** — `buffy-six.vercel.app` works, but Apple wants a way to contact you; add a
   visible support email there, or change the Support URL to a `mailto:` you're comfortable with.
3. Confirm the **age-rating** "wellness" answer in App Store Connect.

## Status snapshot
| Requirement | Status |
|---|---|
| Health data out of iCloud (5.1.3(ii)) | ✅ fixed + tested this build |
| Privacy policy (URL + in-app link) | ✅ built (deploys with web push) |
| Export compliance | ✅ `ITSAppUsesNonExemptEncryption = false` |
| Age rating | ✅ set |
| App Privacy label | ⬜ answer "Data Not Collected" (above) |
| Category / subtitle / description / keywords / support URL | ⬜ paste from above |
| Screenshots (6.9") | ⬜ capture (next step) |
| Review notes | ⬜ paste from above |
| Signed App Store build attached | ⬜ produce + attach (next step) |
