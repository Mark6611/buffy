// Official Whoop API integration (native-only). Tokens live on-device; the
// client secret lives ONLY in the Vercel functions (/api/whoop/*) — Whoop has
// no PKCE and treats every app as a confidential client, so a server-side
// exchange is mandatory, not a choice. Data calls go through the native HTTP
// layer because Whoop's API serves no CORS headers.
//
// Refresh tokens ROTATE: using one invalidates it and returns a replacement,
// with no documented grace window. Hence: single-flight refresh, persist-
// before-first-use ordering, and Preferences (UserDefaults-backed) rather than
// WebView localStorage — the OS can evict WebKit storage under pressure, and
// losing a rotated refresh token means a forced full re-connect.
import { isNative, nativeHttpGet, openAuthBrowser, closeAuthBrowser } from '$lib/native';
import { bestOverlap } from '$lib/whoopMatch';
import { newId } from '$lib/id';

const SITE = isNative ? 'https://buffy-six.vercel.app' : '';
const AUTH_URL = 'https://api.prod.whoop.com/oauth/oauth2/auth';
const API = 'https://api.prod.whoop.com/developer';
const REDIRECT_URI = 'https://buffy-six.vercel.app/whoop/callback';
const SCOPES = 'read:recovery read:cycles read:sleep read:workout read:profile offline';
const TOKENS_KEY = 'buffy:whoopTokens';
const STATE_KEY = 'buffy:whoopAuthState';
const TODAY_TTL_MS = 15 * 60_000;

interface Tokens {
	accessToken: string;
	refreshToken: string;
	/** epoch ms when the access token dies (a safety margin is applied at read) */
	expiresAtMs: number;
}

export interface WhoopToday {
	/** Whoop Recovery %, 0–100 — the real branded score */
	recoveryScore?: number;
	restingHr?: number;
	/** RMSSD ms (NB: different metric from HealthKit's SDNN) */
	hrvMs?: number;
	/** day strain, 0–21 */
	dayStrain?: number;
}

export interface WhoopWorkout {
	start: string;
	end: string;
	strain: number;
	avgHr: number;
	maxHr: number;
	sport?: string;
}

async function prefs() {
	const { Preferences } = await import('@capacitor/preferences');
	return Preferences;
}

class WhoopStore {
	connected = $state(false);
	connecting = $state(false);
	today = $state<WhoopToday | null>(null);
	/** set when /api/whoop/config says the Vercel env isn't set up yet */
	unconfigured = $state(false);
	/** last user-facing failure — cleared on the next attempt/success */
	lastError = $state('');

	private tokens: Tokens | null = null;
	private todayFetchedMs = 0;
	private refreshing: Promise<string | null> | null = null;
	private ready: Promise<void>;

	constructor() {
		this.ready = this.hydrate();
	}

	private async hydrate() {
		try {
			const { value } = await (await prefs()).get({ key: TOKENS_KEY });
			this.tokens = value ? (JSON.parse(value) as Tokens) : null;
		} catch {
			this.tokens = null;
		}
		this.connected = this.tokens !== null;
	}

	private async save(t: Tokens | null) {
		this.tokens = t;
		this.connected = t !== null;
		const p = await prefs();
		if (t) await p.set({ key: TOKENS_KEY, value: JSON.stringify(t) });
		else await p.remove({ key: TOKENS_KEY });
	}

	/** Kick off the OAuth flow in the in-app browser sheet. */
	async connect(): Promise<void> {
		if (!isNative || this.connecting) return;
		this.connecting = true;
		this.lastError = '';
		this.unconfigured = false;
		// safety valve: if the user closes the sheet without ever hitting the
		// callback, the button un-sticks on its own
		setTimeout(() => (this.connecting = false), 90_000);
		let cfg: { configured?: boolean; clientId?: string } | null = null;
		try {
			const r = await fetch(`${SITE}/api/whoop/config`);
			if (r.ok) cfg = await r.json();
		} catch {
			/* network failure — handled below, distinctly from "not configured" */
		}
		if (!cfg) {
			this.lastError = 'Couldn’t reach the server — check your connection and try again.';
			this.connecting = false;
			return;
		}
		if (!cfg.configured || !cfg.clientId) {
			this.unconfigured = true;
			this.connecting = false;
			return;
		}
		const state = newId().slice(0, 8); // Whoop requires exactly 8 chars
		localStorage.setItem(STATE_KEY, state);
		const url =
			`${AUTH_URL}?response_type=code&client_id=${encodeURIComponent(cfg.clientId)}` +
			`&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent(SCOPES)}&state=${state}`;
		await openAuthBrowser(url);
	}

	/** Handle the buffy://whoop-callback deep link. Returns true when connected. */
	async handleCallback(url: string): Promise<boolean> {
		void closeAuthBrowser();
		this.connecting = false;
		let params: URLSearchParams;
		try {
			params = new URL(url).searchParams;
		} catch {
			this.lastError = 'Connection failed — try again.';
			return false;
		}
		if (params.get('error')) {
			// user tapped Cancel/Deny on Whoop's consent screen — not an error state
			this.lastError = params.get('error') === 'access_denied' ? 'Whoop sign-in was cancelled.' : 'Whoop refused the connection — try again.';
			localStorage.removeItem(STATE_KEY);
			return false;
		}
		const code = params.get('code');
		const state = params.get('state');
		const expected = localStorage.getItem(STATE_KEY);
		localStorage.removeItem(STATE_KEY);
		if (!code || !expected || state !== expected) {
			this.lastError = 'Connection failed — try again.';
			return false;
		}
		const r = await fetch(`${SITE}/api/whoop/token`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ grant_type: 'authorization_code', code })
		}).catch(() => null);
		const body = r?.ok ? await r.json() : null;
		if (!body?.access_token || !body?.refresh_token) {
			this.lastError = 'Whoop connection failed — try again.';
			return false;
		}
		await this.save({
			accessToken: body.access_token,
			refreshToken: body.refresh_token,
			expiresAtMs: Date.now() + (body.expires_in ?? 3600) * 1000
		});
		this.lastError = '';
		void this.refreshToday(true);
		return true;
	}

	/** Drop the connection (and best-effort revoke server-side). */
	async disconnect(): Promise<void> {
		await this.ready;
		const token = this.tokens?.accessToken ?? null;
		await this.save(null);
		this.today = null;
		this.todayFetchedMs = 0;
		if (token) {
			try {
				const { CapacitorHttp } = await import('@capacitor/core');
				await CapacitorHttp.delete({ url: `${API}/v2/user/access`, headers: { Authorization: `Bearer ${token}` } });
			} catch {
				/* revoke is a courtesy */
			}
		}
	}

	/** Valid access token; refreshes (single-flight) near expiry, or immediately
	 *  when `force` — the 401 path needs that, since a server-side revocation
	 *  doesn't respect our local expiry clock. */
	private async accessToken(force = false): Promise<string | null> {
		await this.ready;
		const t = this.tokens;
		if (!t) return null;
		if (!force && Date.now() < t.expiresAtMs - 60_000) return t.accessToken;
		if (!this.refreshing) {
			this.refreshing = (async () => {
				try {
					const r = await fetch(`${SITE}/api/whoop/token`, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: t.refreshToken })
					});
					if (!r.ok) {
						// Rotated-away or revoked refresh token — there is no recovery
						// besides reconnecting, so surface the disconnected state honestly.
						if (r.status === 400 || r.status === 401) {
							await this.save(null);
							this.lastError = 'Whoop connection expired — reconnect from Settings.';
						}
						return null;
					}
					const body = await r.json();
					if (!body.access_token || !body.refresh_token) return null;
					// Persist the ROTATED refresh token before anyone uses the access
					// token — the old one is already dead on Whoop's side.
					await this.save({
						accessToken: body.access_token,
						refreshToken: body.refresh_token,
						expiresAtMs: Date.now() + (body.expires_in ?? 3600) * 1000
					});
					return body.access_token as string;
				} catch {
					return null;
				} finally {
					this.refreshing = null;
				}
			})();
		}
		return this.refreshing;
	}

	private async get(path: string): Promise<unknown | null> {
		const token = await this.accessToken();
		if (!token) return null;
		try {
			const r = await nativeHttpGet(`${API}${path}`, { Authorization: `Bearer ${token}` });
			if (r.status === 401) {
				// dead before its local expiry (revoked server-side) — force a refresh;
				// if the grant is truly gone this 400s and flips `connected` honestly
				const fresh = await this.accessToken(true);
				if (!fresh) return null;
				const r2 = await nativeHttpGet(`${API}${path}`, { Authorization: `Bearer ${fresh}` });
				return r2.status >= 200 && r2.status < 300 ? r2.data : null;
			}
			return r.status >= 200 && r.status < 300 ? r.data : null;
		} catch {
			return null;
		}
	}

	/** Today's recovery + day strain (null when disconnected or not yet scored).
	 *  Memoized only briefly AND only once fully scored AND only same-day —
	 *  a pending morning must keep re-asking, and yesterday's Recovery must
	 *  never be served as today's. */
	async refreshToday(force = false): Promise<WhoopToday | null> {
		if (!isNative) return null;
		await this.ready;
		if (!this.connected) return null;
		const memoValid =
			this.today !== null &&
			this.today.recoveryScore != null &&
			Date.now() - this.todayFetchedMs < TODAY_TTL_MS &&
			new Date(this.todayFetchedMs).toDateString() === new Date().toDateString();
		if (memoValid && !force) return this.today;
		// current physiological cycle = the one with end: null
		const cycles = (await this.get('/v2/cycle?limit=1')) as
			| { records?: { id: number; score_state?: string; score?: { strain?: number } }[] }
			| null;
		const cycle = cycles?.records?.[0];
		if (!cycle) return this.today;
		const out: WhoopToday = {};
		if (cycle.score_state === 'SCORED' && typeof cycle.score?.strain === 'number') {
			out.dayStrain = cycle.score.strain;
		}
		const rec = (await this.get(`/v2/cycle/${cycle.id}/recovery`)) as
			| {
					score_state?: string;
					score?: { recovery_score?: number; resting_heart_rate?: number; hrv_rmssd_milli?: number };
			  }
			| null;
		// recovery stays PENDING_SCORE until the user wakes + syncs — treat as absent
		if (rec?.score_state === 'SCORED' && rec.score) {
			out.recoveryScore = rec.score.recovery_score;
			out.restingHr = rec.score.resting_heart_rate;
			out.hrvMs = rec.score.hrv_rmssd_milli;
		}
		this.today = out;
		this.todayFetchedMs = Date.now();
		return out;
	}

	/** The Whoop workout matching a Buffy session's time window, if any. */
	async workoutFor(startISO: string, endISO: string): Promise<WhoopWorkout | null> {
		if (!isNative) return null;
		await this.ready;
		if (!this.connected) return null;
		// pad the query window — Whoop's auto-detection trims/extends the edges
		const qs = new URLSearchParams({
			start: new Date(Date.parse(startISO) - 30 * 60_000).toISOString(),
			end: new Date(Date.parse(endISO) + 30 * 60_000).toISOString(),
			limit: '25'
		});
		const res = (await this.get(`/v2/activity/workout?${qs}`)) as
			| {
					records?: {
						start: string;
						end: string;
						sport_name?: string;
						score_state?: string;
						score?: { strain?: number; average_heart_rate?: number; max_heart_rate?: number };
					}[];
			  }
			| null;
		const scored = (res?.records ?? [])
			.filter((w) => w.score_state === 'SCORED' && typeof w.score?.strain === 'number')
			.map((w) => ({
				start: w.start,
				end: w.end,
				strain: w.score!.strain!,
				avgHr: w.score!.average_heart_rate ?? 0,
				maxHr: w.score!.max_heart_rate ?? 0,
				sport: w.sport_name
			}));
		return bestOverlap({ start: startISO, end: endISO }, scored);
	}
}

export const whoop = new WhoopStore();
