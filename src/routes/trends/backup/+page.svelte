<script lang="ts">
	import { onMount } from 'svelte';
	import { getRepository } from '$lib/db';
	import { exportJSON, exportCSV, parseBackup, importBackup, type BuffyBackup, type ImportMode } from '$lib/data';
	import { relativeDay } from '$lib/format';
	import TopBar from '$lib/components/TopBar.svelte';
	import Icon from '$lib/components/Icon.svelte';

	let counts = $state({ sessions: 0, templates: 0 });
	let lastBackup = $state<string | null>(null);
	let lastAuto = $state<string | null>(null);
	let message = $state('');
	let busy = $state(false);

	let fileInput: HTMLInputElement;
	let mode: ImportMode = 'merge';
	let pending = $state<{ backup: BuffyBackup; name: string } | null>(null);
	let exportFirst = $state(true);

	onMount(refresh);
	async function refresh() {
		const repo = getRepository();
		const [s, t] = await Promise.all([repo.listSessions(), repo.listTemplates()]);
		counts = { sessions: s.length, templates: t.length };
		lastBackup = localStorage.getItem('buffy:lastBackup');
		lastAuto = localStorage.getItem('buffy:lastAutoBackup');
	}

	async function doExportJSON(): Promise<boolean> {
		try {
			await exportJSON();
			const now = new Date().toISOString();
			localStorage.setItem('buffy:lastBackup', now);
			lastBackup = now;
			message = 'Backup exported.';
			return true;
		} catch (e) {
			message = e instanceof Error ? e.message : 'Export failed.';
			return false;
		}
	}

	async function doExportCSV() {
		try {
			await exportCSV();
			message = 'CSV exported.';
		} catch (e) {
			message = e instanceof Error ? e.message : 'Export failed.';
		}
	}

	function pick(m: ImportMode) {
		mode = m;
		message = '';
		fileInput.click();
	}
	async function onFile(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = ''; // allow re-picking the same file
		if (!file) return;
		let backup: BuffyBackup;
		try {
			backup = parseBackup(await file.text());
		} catch (err) {
			message = err instanceof Error ? err.message : 'Could not read that file.';
			return;
		}
		if (mode === 'merge') {
			busy = true;
			try {
				const r = await importBackup(backup, 'merge');
				message = `Merged — added ${r.sessions} sessions, ${r.templates} templates, ${r.exercises} exercises.`;
				await refresh();
			} catch (err) {
				message = err instanceof Error ? `Import failed — ${err.message}` : 'Import failed.';
			} finally {
				busy = false;
			}
		} else {
			pending = { backup, name: file.name };
		}
	}
	async function confirmReplace() {
		if (!pending) return;
		busy = true;
		try {
			// If the safety backup was requested, it MUST succeed before we wipe —
			// doExportJSON swallows its own errors, so gate the destructive step on
			// its return value instead of blindly proceeding.
			if (exportFirst && !(await doExportJSON())) {
				message = 'Stopped — the safety backup failed, so nothing was changed. Uncheck it or fix storage, then retry.';
				return;
			}
			const r = await importBackup(pending.backup, 'replace');
			pending = null;
			message = `Replaced — loaded ${r.sessions} sessions, ${r.templates} templates.`;
			await refresh();
		} catch (err) {
			message = err instanceof Error ? `Import failed — ${err.message}` : 'Import failed.';
			await refresh();
		} finally {
			busy = false;
		}
	}
</script>

<input bind:this={fileInput} type="file" accept=".json,application/json" onchange={onFile} style="display:none" />

<div class="screen">
	<TopBar title="Backup & restore" />
	<div class="screen-body">
		<div class="pad" style="display:flex;flex-direction:column;gap:18px;padding-bottom:28px">
			<div class="card card-pad" style="display:flex;align-items:center;gap:13px">
				<span class="stat-ic" style="width:42px;height:42px;background:var(--accent-tint)"><Icon name="shield" size={22} color="var(--accent-ink)" /></span>
				<div style="flex:1">
					<div style="font-weight:600">Stored on this device</div>
					<div class="txt-sm">
						Last backup
						<span class="mono">{lastBackup ? relativeDay(lastBackup) : 'never'}</span>
					</div>
					{#if lastAuto}
						<div class="txt-sm" style="color:var(--ink-3)">
							Auto-backup <span class="mono">{relativeDay(lastAuto)}</span> · saved to Files
						</div>
					{/if}
				</div>
			</div>

			{#if message}
				<div class="card card-pad" style="background:var(--accent-tint);border-color:transparent;display:flex;gap:9px;align-items:center">
					<Icon name="check" size={16} color="var(--accent-ink)" sw={2.4} />
					<span class="txt-sm" style="color:var(--accent-ink)">{message}</span>
				</div>
			{/if}

			<div>
				<div class="h-sec" style="margin-bottom:8px">Export</div>
				<div class="card">
					<div class="row" style="justify-content:space-between">
						<div style="display:flex;align-items:center;gap:11px">
							<Icon name="doc" size={19} color="var(--ink-2)" />
							<div><div style="font-weight:500">Full backup · JSON</div><div class="txt-sm">everything — templates, sessions, settings</div></div>
						</div>
						<button class="btn btn-dark btn-sm" style="height:38px" onclick={doExportJSON}><Icon name="download" size={16} color="#fff" />Export</button>
					</div>
					<div class="divider"></div>
					<div class="row" style="justify-content:space-between">
						<div style="display:flex;align-items:center;gap:11px">
							<Icon name="chart" size={19} color="var(--ink-2)" />
							<div><div style="font-weight:500">Sessions · CSV</div><div class="txt-sm">one row per logged set · for spreadsheets</div></div>
						</div>
						<button class="btn btn-ghost btn-sm" style="height:38px" onclick={doExportCSV}><Icon name="download" size={16} />CSV</button>
					</div>
				</div>
			</div>

			<div>
				<div class="h-sec" style="margin-bottom:8px">Import / restore</div>
				<div class="card card-pad" style="margin-bottom:10px">
					<div style="display:flex;align-items:center;gap:11px;margin-bottom:12px">
						<Icon name="upload" size={19} color="var(--ink-2)" />
						<div style="flex:1"><div style="font-weight:500">Restore from file</div><div class="txt-sm">choose a Buffy .json backup</div></div>
					</div>
					<div style="display:flex;gap:9px">
						<button class="btn btn-ghost btn-sm" style="flex:1" onclick={() => pick('merge')}><Icon name="swap" size={16} />Merge</button>
						<button class="btn btn-ghost btn-sm" style="flex:1;border-color:var(--warn);color:var(--warn)" onclick={() => pick('replace')}><Icon name="upload" size={16} color="var(--warn)" />Replace</button>
					</div>
				</div>
				<div class="txt-sm" style="display:flex;gap:7px;align-items:flex-start;padding-inline:2px">
					<Icon name="alert" size={14} color="var(--ink-3)" style="margin-top:1px;flex:0 0 auto" />
					<span><b style="color:var(--ink)">Merge</b> adds missing sessions & templates. <b style="color:var(--ink)">Replace</b> wipes current data first — it asks you to confirm.</span>
				</div>
			</div>

			<div class="card card-pad" style="background:var(--surface-2);border-color:transparent;display:flex;gap:10px">
				<Icon name="alert" size={18} color="var(--ink-3)" style="flex:0 0 auto" />
				<div class="txt-sm" style="color:var(--ink-2)">Buffy keeps everything in your browser (IndexedDB). Clearing site data or uninstalling the PWA <b style="color:var(--ink)">erases it</b> — export regularly to stay safe.</div>
			</div>
		</div>
	</div>

	{#if pending}
		<button
			style="position:absolute;inset:0;background:rgba(20,16,12,0.4);z-index:40;border:none"
			aria-label="Cancel"
			onclick={() => (pending = null)}
		></button>
		<div style="position:absolute;left:0;right:0;bottom:0;z-index:50;background:var(--surface);border-radius:24px 24px 0 0;padding:22px 20px calc(30px + env(safe-area-inset-bottom,0));box-shadow:0 -10px 40px rgba(0,0,0,0.2)">
			<div style="width:40px;height:4px;border-radius:99px;background:var(--line);margin:0 auto 18px"></div>
			<span class="stat-ic" style="width:46px;height:46px;background:var(--warn-tint);margin-bottom:14px"><Icon name="alert" size={24} color="var(--warn)" /></span>
			<div class="h-card" style="font-size:19px;margin-bottom:6px">Replace all data?</div>
			<div class="txt" style="margin-bottom:14px">
				This wipes your current <b style="color:var(--ink)">{counts.sessions} sessions</b> and
				<b style="color:var(--ink)">{counts.templates} templates</b>, then loads
				<span class="mono">{pending.name}</span>. This can't be undone.
			</div>
			<label style="display:flex;align-items:center;gap:10px;padding:11px 12px;background:var(--surface-2);border-radius:12px;margin-bottom:16px;cursor:pointer">
				<span class="setcheck {exportFirst ? 'done' : ''}" style="width:22px;height:22px">
					{#if exportFirst}<Icon name="check" size={13} sw={2.6} color="#fff" />{/if}
				</span>
				<input type="checkbox" bind:checked={exportFirst} style="display:none" />
				<span class="txt-sm" style="color:var(--ink)">Export a backup of current data first</span>
			</label>
			<div style="display:flex;gap:10px">
				<button class="btn btn-ghost" style="flex:1" onclick={() => (pending = null)} disabled={busy}>Cancel</button>
				<button class="btn" style="flex:1.3;background:var(--warn);color:#fff" onclick={confirmReplace} disabled={busy}>{busy ? 'Working…' : 'Replace'}</button>
			</div>
		</div>
	{/if}
</div>
