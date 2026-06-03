<script lang="ts">
	let { v, l, mono = false }: { v: string; l: string; mono?: boolean } = $props();
</script>

<div style="text-align:center;flex:1">
	<div class={mono ? 'num' : ''} style="font-size:22px;font-weight:700">{v}</div>
	<div class="txt-sm" style="margin-top:2px">{l}</div>
</div>
