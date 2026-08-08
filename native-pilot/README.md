# BuffyNative — a native SwiftUI pilot

A parallel, throwaway-able SwiftUI build of Buffy's two most-used screens, written to
answer one question with running code rather than opinion:

> **Does going native actually fix the double-tap-zoom problem, and what else comes
> with it?**

It does not replace the shipping app. `com.mark.buffy` (Capacitor) is untouched and
still the thing that goes to TestFlight.

## Build and run

```bash
cd ~/Desktop/buffy/native-pilot && ruby generate-project.rb && xcodebuild -project BuffyNative.xcodeproj -scheme BuffyNative -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 17' -derivedDataPath /tmp/bn-dd build
```

Or just open `BuffyNative.xcodeproj` in Xcode and press Run.

`BuffyNative.xcodeproj` is **generated, not committed** — a hand-maintained `pbxproj`
is the most merge-hostile file in an iOS repo, and this target has one source group,
no storyboard and no asset catalog. Re-run `generate-project.rb` after adding a file.

Requires Xcode 26.x. Deployment target is iOS 17 (for `@Observable`), which is *higher*
than the shipping app's iOS 15 floor — a real cost, noted below.

## What the pilot proves

### 1. The double-tap zoom is gone, structurally

Verified in the simulator: double-tapping the weight field on the workout screen puts a
caret in it and raises the decimal keypad. The layout is pixel-identical before and
after — there is no WebView, so there is no double-tap-to-zoom gesture to fire.

In the Capacitor build the same two taps zoom the page unless CSS opts out.

### 2. …but the web app didn't need a rewrite to fix it

The same commit adds one line to `src/app.css`:

```css
.app { touch-action: manipulation; }
```

`manipulation` disables double-tap zoom **and** the legacy 300ms click delay while
leaving pinch-zoom intact — which matters, because killing pinch-zoom outright
(`maximum-scale=1`) is a WCAG 1.4.4 failure and the accessibility pass specifically
avoided it.

So the honest read on the original motivation: **the pilot is not needed to solve the
zoom problem.** It is worth judging on everything else.

### 3. What native gives you that had to be hand-built for the web

| Capability | Web app | Native |
|---|---|---|
| Swipe-to-delete, drag-to-reorder | hand-written pointer state machine | `List` primitives |
| Numeric keypad | `inputmode` hint, honoured inconsistently | `.keyboardType(.decimalPad)` |
| Rest banner that can't scroll away | fixed positioning + safe-area maths | `.safeAreaInset` |
| 44pt targets, VoiceOver semantics | audited and enforced by scripts | default |
| Dynamic Type | a whole token ramp (`--dt-base`) + a px-pin fix | free |
| Haptics | none | `.sensoryFeedback` |

Roughly half the accessibility programme from `project_coffee_hig_a11y` / the Buffy
45-finding audit is *table stakes* here rather than work.

### 4. What it costs

- **iOS 17+**, versus 15 today.
- **No PWA.** The web app is installable and works on a desktop browser; this cannot.
- **Two codebases** if run in parallel — the port already drifted once during this
  pilot (see the ordering bug below), and that was in 90 minutes on 2 screens.
- **Sync, HealthKit, widgets, CloudKit** are all unported. This is 2 screens of ~12.

## Ported behaviour (deliberately, not incidentally)

The port keeps the invariants the web app earned the hard way:

- A live workout is **never** silently clobbered by starting another one.
- Finishing with nothing ticked does **not** destroy the workout — it asks.
- The rest timer is **wall-clock derived** (`restStartedAt` + `now`), never
  tick-accumulated, so backgrounding the app cannot desynchronise it.
- A **completed set is a record, not a plan.** `applyToUnlogged` skips it.
- Last-performed / times-completed are **derived from history**, never stored counters.

## A bug this pilot found

`TextField(value:format:)` writes its parsed value as part of *ending editing*, and that
write is **not ordered before** the `@FocusState` change. Computing the apply-to-rest
offer synchronously in `onChange(of: focused)` read the *old* weight, found zero
targets, and silently dropped the chip. The fix hops one main-actor turn:

```swift
.onChange(of: focused) { old, new in
    guard old == id, new != id else { return }
    Task { @MainActor in onCommit() }   // let the binding write land first
}
```

Worth knowing before any wider port — every numeric field in this app has this shape.

## Files

| File | Role |
|---|---|
| `Model.swift` | value types mirroring `src/lib/db/types.ts` |
| `Store.swift` | `@Observable` port of `workout.svelte.ts` |
| `Theme.swift` | palette ported from `:root` in `app.css` |
| `LibraryView.swift` | Workout Library |
| `WorkoutView.swift` | live workout — the screen the pilot exists for |
| `generate-project.rb` | writes `BuffyNative.xcodeproj` |
