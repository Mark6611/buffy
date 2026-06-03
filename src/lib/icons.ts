// Line-glyph icon set, ported verbatim from the design handoff (lib.jsx ICONS).
import type { Equipment } from '$lib/types';

export const ICONS = {
	back: 'M14 5l-7 7 7 7',
	chevR: 'M9 5l7 7-7 7',
	chevD: 'M5 9l7 7 7-7',
	chevU: 'M5 15l7-7 7 7',
	plus: 'M12 5v14M5 12h14',
	minus: 'M5 12h14',
	check: 'M5 12.5l4.5 4.5L19 7',
	play: 'M7 5l12 7-12 7z',
	search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 21l-4.3-4.3',
	edit: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4',
	share: 'M12 3v13M12 3L8 7M12 3l4 4M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7',
	more: 'M5 12h.01M12 12h.01M19 12h.01',
	clock: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
	flame: 'M12 3c1 3-2 4-2 7a4 4 0 0 0 8 0c0-3-3-4-2-7M12 21a5 5 0 0 0 5-5',
	pause: 'M9 5v14M15 5v14',
	skip: 'M6 5l9 7-9 7zM18 5v14',
	trash: 'M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13',
	drag: 'M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01',
	cog: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM5 12l-1.5-1 1-2.5L6 8M12 5V3M18 8l1.5-.5 1 2.5L19 12M12 19v2M6 16l-1.5 1 1 2.5L7 19M18 16l1.5 1-1 2.5L17 19',
	dumbbell: 'M5 9v6M3 11v2M19 9v6M21 11v2M7 12h10',
	cable: 'M12 3v5M12 8a4 4 0 0 1 4 4v3M12 8a4 4 0 0 0-4 4v3M6 18h4M14 18h4',
	machine: 'M5 4v16M5 8h6M11 6v6M15 9h4v6h-4z',
	kettle: 'M9 7a3 3 0 0 1 6 0M8 7h8l1.5 12a1 1 0 0 1-1 1.2H7.5a1 1 0 0 1-1-1.2z',
	body: 'M12 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM8 10h8M12 8v7M9 21l3-6 3 6',
	run: 'M13 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM6 12l4-1 3 2 1 4M13 13l4 1M9 21l2-6',
	spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z',
	filter: 'M4 6h16M7 12h10M10 18h4',
	copy: 'M8 8h10v12H8zM6 16H4V4h10v2',
	note: 'M5 4h14v16l-4-3H5z',
	timer: 'M12 8v5l3 2M9 2h6M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16z',
	link: 'M9 12h6M10 8H7a4 4 0 0 0 0 8h3M14 8h3a4 4 0 0 1 0 8h-3',
	cal: 'M4 7h16v13H4zM4 7V5h16v2M8 3v4M16 3v4',
	bolt: 'M13 3L5 13h6l-1 8 8-10h-6z',
	arrowR: 'M5 12h14M13 6l6 6-6 6',
	arrowD: 'M12 5v14M6 13l6 6 6-6'
} as const;

export type IconName = keyof typeof ICONS;

/** These icons render filled rather than stroked. */
export const SOLID_ICONS = new Set<IconName>(['play', 'spark']);

/** Equipment → glyph (keyed on the lowercase Equipment enum). */
export const EQUIP_ICON: Record<Equipment, IconName> = {
	barbell: 'dumbbell',
	dumbbell: 'dumbbell',
	cable: 'cable',
	machine: 'machine',
	kettlebell: 'kettle',
	bodyweight: 'body',
	cardio: 'run'
};
