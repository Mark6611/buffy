// Single entry point for data access. Components import { getRepository, ensureSeeded } from '$lib/db'.
import type { Repository } from './repository';
import { DexieRepository } from './dexie';
import { seedDatabase } from './seed';

export type { Repository } from './repository';

let repo: DexieRepository | null = null;

export function getRepository(): Repository {
	if (!repo) repo = new DexieRepository();
	return repo;
}

let seeding: Promise<void> | null = null;

/** Idempotent first-run seed. Safe to await on every page load. */
export function ensureSeeded(): Promise<void> {
	if (!seeding) {
		seeding = seedDatabase(getRepository()).catch((err) => {
			// Don't cache the failure — a corrupt/blocked open should be retryable on
			// the next navigation rather than wedging the app forever.
			seeding = null;
			console.error('[buffy] database init/seed failed', err);
			throw err;
		});
	}
	return seeding;
}
