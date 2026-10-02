# Buffy — project conventions

Personal single-user workout tracker. SvelteKit 5 (runes) + Capacitor iOS (TestFlight
listing "BuffUp", bundle `com.mark.buffy`, team `ZCS5Y23P62`) + Vercel web deploy
(buffy-six.vercel.app — the `api/` dir there also hosts the Whoop OAuth functions).
Local-first: the canonical database is on-device IndexedDB; CloudKit is an opt-in mirror.

## Architecture boundaries
- ALL storage access goes through `src/lib/db/repository.ts`. Components/stores never
  import Dexie directly. The Dexie implementation is `src/lib/db/dexie.ts`.
- ALL native access goes through `src/lib/native.ts` (thin wrappers, `isNative` guards,
  web fallbacks). Swift plugins live in `ios/App/App/*.swift` and MUST be registered in
  `ViewController.swift` (SPM setup doesn't auto-discover them).
- Pure logic lives in framework-free `src/lib/*.ts` modules with colocated `*.test.ts`
  (vitest). If it can be a pure function, it must be — that's what makes it testable.

## Data model rules
- Timestamps are ISO strings, never `Date` objects. Weight is kg, fixed.
- Computed values are derived at read time, never stored — EXCEPT externally-measured
  data (session `intensity`, `whoop`, `calories`), which can't be re-derived and is
  stored with provenance.
- Deletes are TOMBSTONES (`deletedAt`), never row removals — hard deletes resurrect
  through CloudKit sync. Lists filter tombstones; only `listXForSync` sees them.
- `updatedAt` is stamped centrally by the repository on every `upsertX`. Records pulled
  from sync go through `applySyncedX` (preserves stamps, write-if-strictly-newer).
- Dexie schema: NEVER edit an existing `.version()` block — append a new one with
  `.upgrade()` for backfills.

## Layout (phones, iPad, and the iPhone Duo)
- `.app` has two width bands, split at 700px (`src/app.css`): at or below it the
  column FILLS the viewport — every iPhone and the iPhone Duo in every pose (outer
  466pt, inner 669pt, Split View ~334pt); above it a centred 440px column floats
  (desktop, iPad). Never reintroduce a fixed column width below the band — on the
  Duo that recreates the "compatibility mode" look in CSS.
- Safe areas: handle `env(safe-area-inset-left)` and `-right` SEPARATELY — the
  Duo's system controls sit down one edge of the inner display and which edge
  depends on pose and Split View placement. Backgrounds reach the screen edge;
  content moves inside the insets (`.screen` and `.sheet` do this).
- The Duo resizes the window continuously while folding: never cache
  `innerWidth`, never branch on orientation; let CSS reflow. Charts are
  `viewBox` + `width=100%` for this reason.
- Verify with `node scripts/verify-duo-layout.mjs` after `npm run build:ios`.
- The native side only sees these sizes once the app is built with the iOS 27.1 SDK
  (Xcode 27.1+); an older SDK gets a phone-sized compatibility window on the Duo.

## Svelte gotchas (both have shipped real crashes)
- `$state` objects are Proxies: `$state.snapshot()` before ANY IndexedDB write,
  structured clone, or native bridge call.
- **Build-time paren drop:** mixed `||` / `&&` logic in a `.svelte` or `.svelte.ts`
  file ships with its grouping parentheses stripped — `(a || b) && c` becomes
  `a || (b && c)`. Verified (2026-09-05) to be Rolldown's handling of
  vite-plugin-svelte output, NOT Svelte's compiler and NOT the minifier; plain `.ts`
  keeps its parens. Four shipped bugs so far. Put such logic in a plain `.ts` module
  or write it as statements. svelte-check and vitest cannot see it — only a
  production-bundle E2E can (e2e/picker.spec.ts pins the last one). Full write-up:
  `src/lib/exerciseSearch.ts`.

## Editing hygiene
- The `.svelte` files here are large. After a context compaction, Edit's read-state is
  lost — re-Read a file before Edit-ing it, or the edit fails "File has not been read yet"
  / "String not found." Prefer several small precise edits over one giant replacement.

## Shipping (TestFlight)
- Use `scripts/ship.sh` — never hand-roll the pipeline. It gates on tests, uses the
  MANUAL signing setup (profiles "Buffy App Store" / "Buffy RestWidget App Store";
  automatic signing cannot archive headlessly — no registered devices), verifies the
  entitlements inside the signed binary, uploads, waits for processing, and ASSIGNS THE
  BUILD TO THE TESTER GROUP — uploads are invisible on the phone without that step.
- Gating commands are never piped (`test | tail` reads tail's exit code — this shipped
  a broken build once). `set -o pipefail` everywhere.
- Run the adversarial pre-ship review for any substantive feature; it has caught
  double-digit real defects per feature.
- After enabling any new capability on the App ID, regenerate the App Store profiles
  (they snapshot capabilities at creation).

## Testing
- `npm test` (vitest), `npm run check` (svelte-check must be 0 errors / 0 warnings),
  `npm run test:e2e` (Playwright; gesture tests use real mouse simulation — synthetic
  PointerEvent dispatch is unreliable).
- Layout at the iPhone Duo's viewports + the fold transition:
  `npm run build:ios && node scripts/verify-duo-layout.mjs` (no Duo simulator is
  needed; the WebView is the whole UI).
- iOS compile check without signing:
  `xcodebuild ... CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO archive`.

## External services
- App Store Connect API key: `~/.appstoreconnect/private_keys/AuthKey_DUPV266J6S.p8`
  (issuer b0021702-5324-4cc1-9ddd-66a5a1535fe6, Admin). App id 6785999682; internal
  tester group 6e20b93c-fccb-46bd-be23-aaed076ea271. The API can manage capabilities,
  certs, profiles, builds, groups — but NOT app-group/CloudKit-container resources
  (Xcode only) and NOT `hasAccessToAllBuilds` (creation-time only).
- Whoop: OAuth secret lives ONLY in Vercel env (`WHOOP_CLIENT_ID/SECRET`); no PKCE;
  refresh tokens rotate with no grace (single-flight + persist-before-use; tokens in
  Capacitor Preferences, not localStorage). API has no CORS → CapacitorHttp.
- CloudKit: zone-per-type + `CKFetchRecordZoneChangesOperation` (no queryable-index
  Dashboard step). Schema record types live in Dev + deployed to Production.

## Deliverables
- When generating any artifact for the user (backup, export, report), always print the
  absolute path and open/reveal it — never leave outputs to be hunted for.
