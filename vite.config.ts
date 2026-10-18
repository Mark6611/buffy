import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	build: {
		// Pin the CSS minify pass to the app's real browser floor (iOS 15, per
		// IPHONEOS_DEPLOYMENT_TARGET). Unset, Vite's Lightning CSS minifier rewrites
		// hand-written `(max-width: 700px)` into the media RANGE form `(width<=700px)`,
		// which Safari < 16.4 cannot parse — every rule inside is silently dropped
		// there. That disabled the input focus-zoom guard on iOS 15.0–16.3. With
		// cssTarget set, Lightning compiles range syntax back to min-/max-width.
		//
		// It must be build.cssTarget: Vite's minify pass overrides `targets` with
		// convertTargets(build.cssTarget), so css.lightningcss.targets is silently
		// ignored (the coffee app found this the hard way). Gated by
		// scripts/verify-bundle-css.mjs.
		cssTarget: [
			'safari15',
			'ios15',
			// Desktop entries so Lightning keeps unprefixed forms alive (e.g. plain
			// backdrop-filter, which Safari-only targets would consider dead).
			'chrome100',
			'firefox100'
		],
		cssMinify: 'lightningcss'
	},
	plugins: [sveltekit()]
});
