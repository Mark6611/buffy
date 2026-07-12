import { describe, it, expect } from 'vitest';
import { mmss, parseMmss, kg, volK, durationLabel, relativeDay, hhmm, equipLabel, hoursMinutes } from '$lib/format';

describe('hoursMinutes', () => {
	it('formats H:MM and carries rounded minutes into the hour', () => {
		expect(hoursMinutes(0)).toBe('0:00');
		expect(hoursMinutes(3600)).toBe('1:00');
		expect(hoursMinutes(3660)).toBe('1:01');
		// the "1:60" bug: 1h59m30s must round UP to 2:00, never 1:60
		expect(hoursMinutes(7170)).toBe('2:00');
		expect(hoursMinutes(3585)).toBe('1:00');
	});
});

describe('mmss', () => {
	it('formats seconds', () => {
		expect(mmss(90)).toBe('01:30');
		expect(mmss(5)).toBe('00:05');
		expect(mmss(0)).toBe('00:00');
	});
	it('shows overage as +mm:ss', () => {
		expect(mmss(-13)).toBe('+00:13');
		expect(mmss(-65)).toBe('+01:05');
	});
});

describe('parseMmss', () => {
	it('round-trips mm:ss', () => {
		expect(parseMmss('01:30')).toBe(90);
		expect(parseMmss('0:45')).toBe(45);
	});
	it('treats blanks/dashes as 0', () => {
		expect(parseMmss('—')).toBe(0);
		expect(parseMmss('')).toBe(0);
	});
});

describe('kg', () => {
	it('trims trailing zeros', () => {
		expect(kg(40)).toBe('40');
		expect(kg(12.5)).toBe('12.5');
		expect(kg(2.5)).toBe('2.5');
	});
	it('nullish → empty string', () => {
		expect(kg(undefined)).toBe('');
		expect(kg(null)).toBe('');
	});
});

describe('volK', () => {
	it('compacts thousands', () => {
		expect(volK(6400)).toBe('6.4K');
		expect(volK(940)).toBe('940');
	});
});

describe('durationLabel', () => {
	it('formats minutes and hours', () => {
		expect(durationLabel(2700)).toBe('45 min');
		expect(durationLabel(4500)).toBe('1 hr 15 min');
		expect(durationLabel(3600)).toBe('1 hr');
	});
});

describe('relativeDay', () => {
	const now = new Date(2026, 5, 3, 12, 0, 0); // 3 Jun 2026, local
	it('today / yesterday / N days / date', () => {
		expect(relativeDay('2026-06-03T08:00:00', now)).toBe('Today');
		expect(relativeDay('2026-06-02T08:00:00', now)).toBe('Yesterday');
		expect(relativeDay('2026-05-31T08:00:00', now)).toBe('3 days ago');
	});
});

describe('hhmm', () => {
	it('formats local HH:MM', () => {
		expect(hhmm('2026-06-03T15:24:00')).toBe('15:24');
	});
});

describe('equipLabel', () => {
	it('capitalizes', () => {
		expect(equipLabel('barbell')).toBe('Barbell');
		expect(equipLabel('cardio')).toBe('Cardio');
	});
});
