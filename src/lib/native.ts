// Thin native bridge. On iOS (Capacitor) these use native plugins; on the web they
// fall back gracefully (or no-op), so the same code runs in the PWA and the app.
import { Capacitor, registerPlugin } from '@capacitor/core';

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

/**
 * Save a text file. On native (iOS) we write it to disk and open the share sheet
 * (Save to Files, AirDrop, Mail…); on the web we trigger a normal download. The
 * `<a download>` trick is a no-op inside a WebView, which is why this has to branch.
 */
export async function saveTextFile(filename: string, content: string, mimeType: string): Promise<void> {
	if (isNative) {
		const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
		const { Share } = await import('@capacitor/share');
		const { uri } = await Filesystem.writeFile({
			path: filename,
			data: content,
			directory: Directory.Cache,
			encoding: Encoding.UTF8
		});
		try {
			await Share.share({ title: filename, files: [uri], dialogTitle: 'Save or share your Buffy backup' });
		} catch {
			/* user dismissed the share sheet — the file is already written, nothing to do */
		}
		return;
	}
	// Web: blob + anchor download.
	const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────────────────── rest-end alert
// A single scheduled local notification so the rest-over cue reaches you even
// when the app is backgrounded or the phone is locked (the in-app haptic only
// fires in the foreground). Fixed id → scheduling replaces, cancel removes.
const REST_NOTIF_ID = 1001;

/** Ask for notification permission (native only; called once at launch). */
export async function requestNotificationPermission(): Promise<void> {
	if (!isNative) return;
	try {
		const { LocalNotifications } = await import('@capacitor/local-notifications');
		const perm = await LocalNotifications.checkPermissions();
		if (perm.display !== 'granted') await LocalNotifications.requestPermissions();
	} catch {
		/* best-effort */
	}
}

/** Schedule the rest-over alert for `atMs` (native only). */
export async function scheduleRestEndAlert(atMs: number, label?: string): Promise<void> {
	if (!isNative) return;
	try {
		const { LocalNotifications } = await import('@capacitor/local-notifications');
		await LocalNotifications.cancel({ notifications: [{ id: REST_NOTIF_ID }] });
		if (atMs <= Date.now() + 750) return; // already over / too soon to matter
		await LocalNotifications.schedule({
			notifications: [
				{
					id: REST_NOTIF_ID,
					title: 'Rest complete',
					body: label ? `${label} — time for your next set` : 'Time for your next set',
					schedule: { at: new Date(atMs), allowWhileIdle: true },
					sound: 'default'
				}
			]
		});
	} catch {
		/* best-effort */
	}
}

/** Cancel any pending rest-over alert. */
export async function cancelRestEndAlert(): Promise<void> {
	if (!isNative) return;
	try {
		const { LocalNotifications } = await import('@capacitor/local-notifications');
		await LocalNotifications.cancel({ notifications: [{ id: REST_NOTIF_ID }] });
	} catch {
		/* best-effort */
	}
}

// ─────────────────────────────────────────────────────────── keep-awake
// Web Wake Lock API — works inside the iOS WebView (16.4+) and the PWA, so the
// screen stays on mid-workout without a native plugin. The OS drops the lock
// when the page hides, so it must be re-acquired on return to the foreground.
let wakeLock: { release: () => Promise<void> } | null = null;
let wantWake = false;

/** Keep the screen on (call when a workout becomes active). */
export async function keepAwake(): Promise<void> {
	wantWake = true;
	try {
		const nav = navigator as unknown as { wakeLock?: { request: (t: string) => Promise<typeof wakeLock> } };
		if (nav.wakeLock && document.visibilityState === 'visible' && !wakeLock) {
			wakeLock = await nav.wakeLock.request('screen');
		}
	} catch {
		/* unavailable / denied */
	}
}

/** Let the screen sleep again (call when the workout ends). */
export async function allowSleep(): Promise<void> {
	wantWake = false;
	try {
		await wakeLock?.release();
	} catch {
		/* ignore */
	}
	wakeLock = null;
}

/** Re-acquire the wake lock after returning to the foreground. */
export async function reacquireWakeLock(): Promise<void> {
	wakeLock = null; // the OS already released it on hide
	if (wantWake) await keepAwake();
}

// ─────────────────────────────────────────────────────────── splash
/** Hide the native splash once the app has painted (kills the cold-launch black gap). */
export async function hideSplash(): Promise<void> {
	if (!isNative) return;
	try {
		const { SplashScreen } = await import('@capacitor/splash-screen');
		await SplashScreen.hide({ fadeOutDuration: 200 });
	} catch {
		/* plugin may be absent */
	}
}

// ───────────────────────────────────────── Live Activity (Dynamic Island)
// Bridges to the native RestActivityPlugin (ActivityKit). The countdown is
// driven by SwiftUI's Text(timerInterval:) — we just hand it the end time, so
// no per-second IPC is needed.
interface PendingRestAdjustment {
	present: boolean;
	endTimeMs?: number;
	skipped?: boolean;
}
interface RestActivityBridge {
	start(opts: { startTime: number; endTime: number; label: string }): Promise<void>;
	end(): Promise<void>;
	readPendingAdjustment(): Promise<PendingRestAdjustment>;
}
const RestActivity = registerPlugin<RestActivityBridge>('RestActivity');

/** Show the rest countdown on the Lock Screen + Dynamic Island (native only). */
export async function startRestLiveActivity(startMs: number, endMs: number, label: string): Promise<void> {
	if (!isNative) return;
	try {
		await RestActivity.start({ startTime: startMs, endTime: endMs, label: label || 'Rest' });
	} catch {
		/* best-effort */
	}
}

/** End the rest Live Activity. */
export async function endRestLiveActivity(): Promise<void> {
	if (!isNative) return;
	try {
		await RestActivity.end();
	} catch {
		/* best-effort */
	}
}

/**
 * Consume a pending +30s / skip event left by a Live Activity button tap while
 * the app was backgrounded (iOS 17+ interactive Live Activity). Returns null
 * if there's nothing to reconcile.
 */
export async function readPendingRestAdjustment(): Promise<{ endTimeMs: number; skipped: boolean } | null> {
	if (!isNative) return null;
	try {
		const res = await RestActivity.readPendingAdjustment();
		if (!res.present || res.endTimeMs == null) return null;
		return { endTimeMs: res.endTimeMs, skipped: !!res.skipped };
	} catch {
		return null;
	}
}

// ───────────────────────────────────────────────── automatic backup
/**
 * Write an automatic backup to the app's Documents (native only). Documents is
 * included in the device's iCloud backup and — with UIFileSharingEnabled — is
 * visible in the Files app, so data survives device loss/restore. No entitlement.
 */
// ───────────────────────────────────────────────────────── home-screen widget
interface WidgetDataBridge {
	write(snapshot: {
		streakDays: number;
		volumeThisWeekKg: number;
		sessionsThisWeek: number;
		nextOrLastTitle: string;
		isNext: boolean;
	}): Promise<void>;
}
const WidgetData = registerPlugin<WidgetDataBridge>('WidgetData');

/** Push a fresh summary to the home-screen widget (native only). */
export async function writeWidgetSnapshot(snapshot: {
	streakDays: number;
	volumeThisWeekKg: number;
	sessionsThisWeek: number;
	nextOrLastTitle: string;
	isNext: boolean;
}): Promise<void> {
	if (!isNative) return;
	try {
		await WidgetData.write(snapshot);
	} catch {
		/* best-effort */
	}
}

// ─────────────────────────────────────────────────────────────── Apple Health
interface HealthBridge {
	isAvailable(): Promise<{ available: boolean }>;
	requestAuthorization(): Promise<{ granted: boolean }>;
	writeWorkout(opts: { startTime: number; endTime: number }): Promise<void>;
}
const Health = registerPlugin<HealthBridge>('Health');

/** Prompt the standard iOS Health permission sheet (native only). */
export async function requestHealthAuthorization(): Promise<boolean> {
	if (!isNative) return false;
	try {
		const { available } = await Health.isAvailable();
		if (!available) return false;
		const { granted } = await Health.requestAuthorization();
		return granted;
	} catch {
		return false;
	}
}

/** Write a finished workout to Apple Health as strength training (native only). */
export async function writeHealthWorkout(startMs: number, endMs: number): Promise<void> {
	if (!isNative) return;
	try {
		await Health.writeWorkout({ startTime: startMs, endTime: endMs });
	} catch {
		/* best-effort — permission may have been denied */
	}
}

export async function writeAutoBackup(content: string): Promise<boolean> {
	if (!isNative) return false;
	try {
		const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
		await Filesystem.writeFile({
			path: 'buffy-auto-backup.json',
			data: content,
			directory: Directory.Documents,
			encoding: Encoding.UTF8
		});
		return true;
	} catch {
		return false;
	}
}
