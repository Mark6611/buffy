<script lang="ts">
	// Privacy policy — required by App Review 5.1.1 (a URL in App Store Connect AND
	// an in-app link) and 5.1.3 (health apps must name the specific health data).
	// Reachable at buffy-six.vercel.app/privacy and from Settings inside the app.
	const updated = 'July 2026';
	const CONTACT = 'kornkranmarwin@gmail.com';
</script>

<svelte:head><title>Buffy — Privacy Policy</title></svelte:head>

<article class="policy">
	<h1>Buffy — Privacy Policy</h1>
	<p class="muted">Last updated: {updated}</p>

	<p>
		Buffy is a personal strength-training tracker. It is built to be private by default: your
		data lives on your device, and — only if you turn it on — in your own iCloud account. The
		developer of Buffy cannot see your data.
	</p>

	<h2>What Buffy stores, and where</h2>
	<ul>
		<li>
			<strong>Your workouts</strong> (exercises, sets, reps, weights, durations, notes, dates)
			and app <strong>settings</strong> are stored on your device.
		</li>
		<li>
			<strong>iCloud sync (optional, off by default):</strong> if you enable it in Settings,
			your workouts are mirrored to your <em>private</em> iCloud (CloudKit) database so your own
			devices stay in sync. This uses your Apple ID; the developer has no access to it.
			<strong>Health data is deliberately excluded from iCloud sync</strong> and never leaves
			your device through Buffy.
		</li>
	</ul>

	<h2>Health &amp; fitness data</h2>
	<p>With your explicit permission, Buffy reads and writes Apple Health data:</p>
	<ul>
		<li><strong>Reads:</strong> heart rate, heart-rate variability, resting heart rate, sleep, and body weight — used only to show your readiness and to estimate a workout's intensity and calories.</li>
		<li><strong>Writes:</strong> your finished workouts (as Strength Training) and their estimated active energy, so they appear in Apple Health and count toward your Activity rings.</li>
	</ul>
	<p>
		If you connect <strong>WHOOP</strong>, Buffy reads your recovery, day strain, sleep, and
		per-workout data from WHOOP's official API to display them. The connection uses WHOOP's
		secure sign-in; access tokens are stored only on your device, and you can disconnect at any
		time in Settings. Buffy runs a small sign-in helper (on Vercel) that only relays WHOOP's
		sign-in — it stores none of your data.
	</p>
	<p>
		Buffy <strong>never</strong> uses your health or fitness data for advertising, marketing, or
		data mining, and never shares it with third parties for those purposes. Health data is kept
		on your device and is not stored in iCloud.
	</p>

	<h2>Analytics &amp; tracking</h2>
	<p>Buffy contains no third-party analytics, advertising, or tracking SDKs. It does not collect a device identifier or profile you.</p>

	<h2>Your control &amp; data deletion</h2>
	<ul>
		<li>Delete any workout inside the app; deletions propagate to your other devices if sync is on.</li>
		<li>Export a full backup of your data at any time from Settings.</li>
		<li>Disconnect WHOOP in Settings to revoke Buffy's access to your WHOOP data.</li>
		<li>Deleting the app removes all on-device data. Turning off Apple Health permissions (iOS Settings → Privacy &amp; Security → Health) revokes Buffy's access immediately.</li>
	</ul>

	<h2>Children</h2>
	<p>Buffy is not directed at children and does not knowingly collect data from children.</p>

	<h2>Contact</h2>
	<p>Questions about this policy or your data: <a href="mailto:{CONTACT}">{CONTACT}</a></p>
</article>

<style>
	.policy {
		max-width: 680px;
		margin: 0 auto;
		padding: 28px 20px 56px;
		font-family: var(--font-ui, system-ui, sans-serif);
		color: var(--ink, #1a1a1a);
		line-height: 1.55;
	}
	.policy h1 { font-size: 24px; margin: 0 0 4px; }
	.policy h2 { font-size: 16px; margin: 26px 0 8px; }
	.policy p, .policy li { font-size: 14.5px; }
	.policy ul { padding-left: 20px; }
	.policy li { margin-bottom: 6px; }
	.muted { color: var(--ink-3, #888); font-size: 13px; margin-bottom: 20px; }
</style>
