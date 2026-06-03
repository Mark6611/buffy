// Thin native bridge. On iOS (Capacitor) these use native plugins; on the web they
// fall back gracefully (or no-op), so the same code runs in the PWA and the app.
import { Capacitor } from '@capacitor/core';

export const isNative = Capacitor.isNativePlatform();

/** Haptic feedback — native impact on iOS/Android; Web Vibration fallback (no-op on iOS Safari). */
export async function haptic(style: 'light' | 'medium' | 'heavy' = 'medium'): Promise<void> {
	try {
		if (isNative) {
			const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
			const map = { light: ImpactStyle.Light, medium: ImpactStyle.Medium, heavy: ImpactStyle.Heavy };
			await Haptics.impact({ style: map[style] });
		} else if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
			navigator.vibrate(style === 'heavy' ? 60 : style === 'medium' ? 35 : 15);
		}
	} catch {
		/* haptics are best-effort */
	}
}

/** Ask the OS to keep our IndexedDB from being evicted (iOS 17+, modern browsers). */
export async function ensurePersistentStorage(): Promise<void> {
	try {
		if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
			if (!(await navigator.storage.persisted())) await navigator.storage.persist();
		}
	} catch {
		/* best-effort */
	}
}

/** Native status-bar styling (no-op on web). */
export async function setupNativeChrome(): Promise<void> {
	if (!isNative) return;
	try {
		const { StatusBar, Style } = await import('@capacitor/status-bar');
		await StatusBar.setStyle({ style: Style.Dark }); // dark text on Buffy's light paper bg
	} catch {
		/* plugin may be absent */
	}
}
