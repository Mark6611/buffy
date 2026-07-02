// Shared numeric helpers — pure, no dependencies.

/** Clamp into [0, 1]. */
export const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
