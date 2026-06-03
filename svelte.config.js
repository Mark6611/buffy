import adapterVercel from '@sveltejs/adapter-vercel';
import adapterStatic from '@sveltejs/adapter-static';

// Web (Vercel) ships with adapter-vercel. The Capacitor / iOS build uses adapter-static
// — a self-contained SPA in build/ that Capacitor wraps. Select with BUILD_TARGET=capacitor.
const native = process.env.BUILD_TARGET === 'capacitor';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		adapter: native ? adapterStatic({ fallback: 'index.html' }) : adapterVercel()
	}
};

export default config;
