<script lang="ts">
  import { ShieldCheck, ScanEye, Lock } from "@lucide/svelte";
  import Card from "$lib/components/ui/Card.svelte";
</script>

<svelte:head>
  <title>CFG · Control Flow Guard</title>
</svelte:head>

<main
  class="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-8 px-6 py-24 text-center"
>
  <div
    class="flex h-16 w-16 items-center justify-center rounded-[var(--radius)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
  >
    <ShieldCheck size={32} />
  </div>

  <div class="flex flex-col gap-3">
    <h1 class="text-4xl font-semibold tracking-tight sm:text-5xl">
      Control Flow Guard
    </h1>
    <p class="text-lg text-[hsl(var(--muted-foreground))]">
      Verified humans only — no VPNs past the gate.
    </p>
  </div>

  <div class="grid w-full gap-4 sm:grid-cols-3">
    <Card class="flex flex-col items-center gap-2 p-5 text-center">
      <ScanEye size={20} class="text-[var(--color-accent)]" />
      <p class="text-sm font-medium">VPN &amp; proxy detection</p>
      <p class="text-xs text-[hsl(var(--muted-foreground))]">
        Two independent providers screen every connection.
      </p>
    </Card>
    <Card class="flex flex-col items-center gap-2 p-5 text-center">
      <Lock size={20} class="text-[var(--color-accent)]" />
      <p class="text-sm font-medium">Privacy first</p>
      <p class="text-xs text-[hsl(var(--muted-foreground))]">
        Raw IPs are never stored — only a salted hash.
      </p>
    </Card>
    <Card class="flex flex-col items-center gap-2 p-5 text-center">
      <ShieldCheck size={20} class="text-[var(--color-accent)]" />
      <p class="text-sm font-medium">One account per person</p>
      <p class="text-xs text-[hsl(var(--muted-foreground))]">
        Alt accounts on the same network are kept out.
      </p>
    </Card>
  </div>

  <p class="text-xs text-[hsl(var(--muted-foreground))]">
    To verify, click the <span class="font-medium">Verify</span> button in your
    Discord server.
  </p>
</main>
