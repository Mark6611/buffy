import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
	appId: 'com.mark.buffy',
	appName: 'Buffy',
	webDir: 'build', // adapter-static output (built with BUILD_TARGET=capacitor)
	ios: {
		// Buffy's warm paper background, so there's no white flash on launch
		backgroundColor: '#faf8f4'
	}
};

export default config;
