import { getRepository } from '$lib/db';
import { DEFAULT_SETTINGS } from '$lib/db/seed';
import type { Settings } from '$lib/types';

class SettingsStore {
	current = $state<Settings>({ ...DEFAULT_SETTINGS });
	loaded = $state(false);

	async load() {
		this.current = await getRepository().getSettings();
		this.loaded = true;
	}

	async save(patch: Partial<Settings>) {
		this.current = { ...this.current, ...patch };
		await getRepository().saveSettings($state.snapshot(this.current));
	}
}

export const settings = new SettingsStore();
