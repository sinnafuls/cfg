<script lang="ts">
  import { ShieldCheck } from "@lucide/svelte";
</script>

<svelte:head>
  <title>CFG · Control Flow Guard</title>
</svelte:head>

<main
  class="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-6 px-6 py-24 text-center"
>
  <div
    class="flex h-14 w-14 items-center justify-center rounded-[var(--radius)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
  >
    <ShieldCheck size={28} />
  </div>

  <h1 class="text-3xl font-semibold tracking-tight sm:text-4xl">
    Control Flow Guard
  </h1>

  <p class="max-w-md text-[hsl(var(--muted-foreground))]">
    This is the verification gate for a Discord server. It checks that you're
    not joining through a VPN or proxy, and that you don't already have an
    account here.
  </p>

  <p class="text-sm text-[hsl(var(--muted-foreground))]">
    There's nothing to do on this page. Head back to the server and press
    <span class="font-medium text-[hsl(var(--foreground))]">Verify</span> to get
    your link.
  </p>
</main>
