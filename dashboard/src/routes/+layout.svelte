<script lang="ts">
  import "../app.css";
  import { ParticleBackground } from "$lib/components/ui";
  import type { Snippet } from "svelte";

  let { children }: { children: Snippet } = $props();
</script>

<ParticleBackground />

<div class="relative flex min-h-screen flex-col">
  {@render children()}
</div>
