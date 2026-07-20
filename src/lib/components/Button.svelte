<script lang="ts">
	import type { Snippet } from 'svelte';

	// Button system modelled on the Apple iOS 27 UI Kit, which organises every
	// button as a SIZE crossed with a STYLE rather than as a one-off recipe.
	// Sizes come from the kit's Large/Medium/Regular/Small ladder; variants from
	// its Bordered Prominent / Bordered / Default / Destructive / Glass / Glass
	// Prominent set, renamed to what they mean here.
	//
	// Shape is a capsule at every size — the kit uses full corner radius on
	// standalone buttons. The visual rules live in .btn (app.css); this component
	// exists so call sites stop re-deriving sizes with inline styles, which is
	// what made the hand-rolled buttons drift.
	//
	// Mirrors the sibling coffee app's Button API so the two stay conceptually in
	// step, but emits Buffy's plain CSS classes rather than Tailwind utilities.
	//
	// Renders an <a> when `href` is set, a <button> otherwise, so a link that
	// looks like a button doesn't have to duplicate the class list.

	type Size = 'large' | 'medium' | 'regular' | 'small';
	type Variant =
		| 'prominent'
		| 'dark'
		| 'bordered'
		| 'plain'
		| 'destructive'
		| 'glass'
		| 'glassProminent';

	let {
		size = 'large',
		variant = 'prominent',
		href,
		type = 'button',
		disabled = false,
		full = false,
		iconOnly = false,
		label,
		title,
		onclick,
		class: cls = '',
		children,
		...rest
	}: {
		size?: Size;
		variant?: Variant;
		href?: string;
		type?: 'button' | 'submit' | 'reset';
		disabled?: boolean;
		/** Stretch to the container width (form CTAs, empty-state actions). */
		full?: boolean;
		/** Square footprint — renders a circle instead of a capsule. */
		iconOnly?: boolean;
		/** Accessible name; required when iconOnly, since there's no text. */
		label?: string;
		title?: string;
		onclick?: (e: MouseEvent) => void;
		class?: string;
		children: Snippet;
		[key: string]: unknown;
	} = $props();

	// large is .btn's own height (52) — no extra class needed
	const SIZE_CLASS: Record<Size, string> = {
		large: '',
		medium: 'btn-sm',
		regular: 'btn-rg',
		small: 'btn-xs'
	};

	const VARIANT_CLASS: Record<Variant, string> = {
		prominent: 'btn-accent', // filled tangerine — one per screen
		dark: 'btn-dark', // near-black fill, Buffy's quick-log CTA
		bordered: 'btn-ghost', // hairline outline on the page surface
		plain: 'btn-plain', // text-only, still gets press physics + hit box
		destructive: 'btn-destructive', // red label, no outline (see the kit's Action Sheets)
		glass: 'btn-glass glass', // neutral Liquid Glass
		glassProminent: 'btn-glass-prominent glass glass-tinted' // accent reads through the material
	};

	// the glass material scales with the control it wraps
	const GLASS_SCALE: Record<Size, string> = {
		large: 'glass-lg',
		medium: 'glass-md',
		regular: 'glass-md',
		small: 'glass-sm'
	};

	const isGlass = $derived(variant === 'glass' || variant === 'glassProminent');
	// small controls read better with the deeper compress
	const physics = $derived(size === 'small' || iconOnly ? 'press-sm' : '');

	const classes = $derived(
		[
			'btn',
			SIZE_CLASS[size],
			VARIANT_CLASS[variant],
			isGlass ? GLASS_SCALE[size] : '',
			iconOnly ? 'btn-icon' : '',
			full ? 'btn-block' : '',
			physics,
			cls
		]
			.filter(Boolean)
			.join(' ')
	);
</script>

{#if href}
	<a
		{href}
		class={classes}
		aria-label={label}
		{title}
		aria-disabled={disabled || undefined}
		{onclick}
		{...rest}>{@render children()}</a
	>
{:else}
	<button {type} {disabled} class={classes} aria-label={label} {title} {onclick} {...rest}
		>{@render children()}</button
	>
{/if}
