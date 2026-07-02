// Vercel serverless function — the ONLY place the Whoop client secret lives.
// The app (native WebView) does the OAuth dance itself but can't hold a secret,
// so code→token exchange and refresh both proxy through here. Tokens are
// returned to the caller and stored on-device; nothing is persisted server-side
// (no database, no sessions — this is a stateless secret-keeper).
const TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';
// Pinned server-side: the redirect URI is part of the OAuth contract with the
// registered Whoop app, not something a caller should be able to vary.
const REDIRECT_URI = 'https://buffy-six.vercel.app/whoop/callback';

export default async function handler(req: any, res: any) {
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
	if (req.method === 'OPTIONS') return res.status(204).end();
	if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

	const clientId = process.env.WHOOP_CLIENT_ID;
	const clientSecret = process.env.WHOOP_CLIENT_SECRET;
	if (!clientId || !clientSecret) {
		return res.status(503).json({ error: 'Whoop is not configured (set WHOOP_CLIENT_ID / WHOOP_CLIENT_SECRET)' });
	}

	const { grant_type, code, refresh_token } = req.body ?? {};
	const params = new URLSearchParams({ client_id: clientId, client_secret: clientSecret });
	if (grant_type === 'authorization_code' && typeof code === 'string') {
		params.set('grant_type', 'authorization_code');
		params.set('code', code);
		params.set('redirect_uri', REDIRECT_URI);
	} else if (grant_type === 'refresh_token' && typeof refresh_token === 'string') {
		params.set('grant_type', 'refresh_token');
		params.set('refresh_token', refresh_token);
		params.set('scope', 'offline');
	} else {
		return res.status(400).json({ error: 'bad grant request' });
	}

	try {
		const r = await fetch(TOKEN_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: params.toString()
		});
		const body = await r.json().catch(() => ({ error: 'whoop token endpoint returned non-JSON' }));
		return res.status(r.status).json(body);
	} catch {
		return res.status(502).json({ error: 'could not reach Whoop' });
	}
}
