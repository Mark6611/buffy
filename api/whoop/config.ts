// Vercel serverless function (lives outside SvelteKit on purpose: the native
// build is a static bundle via adapter-static, which can't carry dynamic server
// routes — but Vercel still deploys this /api directory alongside it).
//
// Hands the app its Whoop OAuth client id at runtime, so connecting Whoop needs
// zero app rebuild — just set WHOOP_CLIENT_ID / WHOOP_CLIENT_SECRET in Vercel.
export default async function handler(req: any, res: any) {
	res.setHeader('Access-Control-Allow-Origin', '*'); // the native app's WebView origin is capacitor://localhost
	res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
	if (req.method === 'OPTIONS') return res.status(204).end();
	if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });
	const clientId = process.env.WHOOP_CLIENT_ID ?? null;
	return res.status(200).json({ configured: !!clientId && !!process.env.WHOOP_CLIENT_SECRET, clientId });
}
