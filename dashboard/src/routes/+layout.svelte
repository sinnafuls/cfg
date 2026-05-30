<script lang="ts">
  import "../app.css";
  import { ParticleBackground } from "$lib/components/ui";
  import type { Snippet } from "svelte";

  let { children }: { children: Snippet } = $props();
</script>

<ParticleBackground />

<div class="relative flex min-h-screen flex-col">
  <div class="flex flex-1 flex-col">
    {@render children()}
  </div>

  <footer
    class="w-full px-6 py-5 text-center text-xs text-[hsl(var(--muted-foreground))]"
  >
    by sin
    <span class="mx-1.5 opacity-40">|</span>
    <a href="/privacy" class="underline-offset-4 transition hover:text-[hsl(var(--foreground))] hover:underline">
      privacy
    </a>
  </footer>
</div>
