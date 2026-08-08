// Free-text matching for the exercise picker. The picker is used MID-WORKOUT with
// one thumb, so the only thing that matters is that the first thing you type finds
// the row. People don't type catalog names: they type "pulldown" for "Pull Down",
// "pullups" for "Pull-ups", "biceps" for a curl, "incline press" for "Incline Bench
// Press" — and they search by muscle and equipment at least as often as by name.
//
// Deliberately no fuzzy / edit-distance matching and no index: this runs on every
// keystroke over the whole catalog, and a confidently wrong near-hit costs a user
// mid-set more than a miss does. Everything here is prefix/substring on normalized
// text, which is cheap and predictable.
import type { Exercise } from '$lib/types';

/** Lowercase and collapse every run of non-alphanumerics to a single space, so
 *  "Pull-ups", "PULL UPS" and "pull  ups" all become the same token stream. */
export function normalizeName(s: string): string {
	return s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

/** Crude singular: drop one trailing "s" on tokens long enough for it to be a plural.
 *  Handles curls/curl, lats/lat, biceps/bicep. The length guard keeps "abs" intact.
 *  Irregular plurals (calf/calves) are NOT handled — a real stemmer isn't worth the
 *  weight here, and both spellings of the seeded names are already searchable. */
function stem(t: string): string {
	return t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t;
}

/** Everything about an exercise that a person might type to find it. */
function haystack(ex: Exercise): string {
	return normalizeName([ex.name, ex.equipment, ...ex.primaryMuscles, ...ex.secondaryMuscles].join(' '));
}

/**
 * Does `query` find `ex`? Every whitespace-separated word in the query must match
 * something — as a prefix of one of the exercise's words ("inc" → "Incline"), or as a
 * substring of the whole thing with spaces removed ("pulldown" → "Pull Down"). The
 * words may match in any order, so "press incline" works as well as "incline press".
 * An empty query matches everything.
 */
export function matchesExercise(ex: Exercise, query: string): boolean {
	const q = normalizeName(query);
	if (!q) return true;
	const hay = haystack(ex);
	const words = hay.split(' ').map(stem);
	const compact = hay.replace(/ /g, '');
	return q.split(' ').every((t) => {
		const s = stem(t);
		return words.some((w) => w.startsWith(s)) || compact.includes(s);
	});
}

/** Do two exercise names refer to the same thing as far as a human is concerned?
 *  Used to warn (not block) when a custom exercise duplicates one already in the
 *  catalog — "Pull-Ups" and "pull ups" are indistinguishable in a picker row. */
export function sameExerciseName(a: string, b: string): boolean {
	const na = normalizeName(a);
	return na !== '' && na === normalizeName(b);
}
