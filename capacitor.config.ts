import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
	appId: 'com.mark.buffy',
	appName: 'Buffy',
	webDir: 'build', // adapter-static output (built with BUILD_TARGET=capacitor)
	ios: {
		// Buffy's warm paper background, so there's no white flash on launch
		backgroundColor: '#faf8f4'
	},
	plugins: {
		SplashScreen: {
			// Hold the splash until the web view has painted, then hideSplash() fades
			// it out — eliminates the black gap between splash-dismiss and first paint.
			launchAutoHide: false,
			backgroundColor: '#3E6FD4', // matches the splash artwork
			showSpinner: false
		}
	}
};

export default config;
