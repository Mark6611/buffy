// Single home for id generation, so a future change (prefixed ids, fallback for
// non-secure contexts) happens in one place instead of at every call site.

export function newId(): string {
	return crypto.randomUUID();
}
