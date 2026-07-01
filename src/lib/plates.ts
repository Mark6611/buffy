// Barbell plate math. Given a total loaded weight (bar + plates), work out what
// goes on each side. kg only, matching the rest of the app.

export const DEFAULT_BAR_KG = 20;
/** Standard kg plates, assumed available in pairs. */
export const DEFAULT_PLATES = [25, 20, 15, 10, 5, 2.5, 1.25];

export interface PlateLoad {
	/** Plates for ONE side, heaviest first. */
	perSide: { plate: number; count: number }[];
	/** Weight per side the inventory couldn't make (≈0 when cleanly loadable). */
	remainderKg: number;
	loadable: boolean;
}

/** Greedy plate breakdown per side for a barbell `totalKg` (includes the bar). */
export function platesPerSide(
	totalKg: number,
	barKg: number = DEFAULT_BAR_KG,
	plates: number[] = DEFAULT_PLATES
): PlateLoad {
	const perSideTarget = (totalKg - barKg) / 2;
	const perSide: { plate: number; count: number }[] = [];
	if (!(perSideTarget > 0.001)) {
		return { perSide, remainderKg: 0, loadable: totalKg <= barKg + 0.001 };
	}
	let remaining = perSideTarget;
	for (const p of [...plates].sort((a, b) => b - a)) {
		const count = Math.floor((remaining + 1e-9) / p);
		if (count > 0) {
			perSide.push({ plate: p, count });
			remaining -= count * p;
		}
	}
	const remainderKg = Math.round(Math.max(0, remaining) * 100) / 100;
	return { perSide, remainderKg, loadable: remainderKg < 0.01 };
}

/** "20 + 10 + 2.5" for one side, or "bar only". */
export function formatPerSide(load: PlateLoad): string {
	if (!load.perSide.length) return 'bar only';
	const flat = load.perSide.flatMap(({ plate, count }) => Array<number>(count).fill(plate));
	const s = flat.map((n) => (Number.isInteger(n) ? String(n) : String(n))).join(' + ');
	return load.loadable ? s : `${s} (+${load.remainderKg} short)`;
}
