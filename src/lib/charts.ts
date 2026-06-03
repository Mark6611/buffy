// Shared chart palette helpers (ported from the design's charts.jsx).
export const HEAT = ['var(--surface-2)', 'var(--accent-tint)', 'oklch(0.8 0.1 50)', 'var(--accent)'];

/** intensity 0..1 → tangerine shade for the body map. */
export function shade(v: number): string {
	if (v <= 0) return 'var(--surface-2)';
	return `color-mix(in oklab, var(--accent) ${Math.round(20 + v * 80)}%, var(--surface-2))`;
}
