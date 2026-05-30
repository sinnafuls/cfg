<script lang="ts">
  import { page } from "$app/state";
  import Card from "$lib/components/ui/Card.svelte";
  import Alert from "$lib/components/ui/Alert.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import { ShieldCheck, ScanEye, Lock } from "@lucide/svelte";
  import type { PageData } from "./$types.js";

  let { data }: { data: PageData } = $props();

  // The "Verify with Discord" button is a plain link to the OAuth-start
  // endpoint (a GET that builds the signed-state URL, sets the nonce cookie,
  // and 302s to Discord). Keeping it a link means no client JS is required to
  // start verification.
  const startHref = $derived(`/v/${page.params.token}/start`);
</script>

<svelte:head>
  <title>Verify · Control Flow Guard</title>
</svelte:head>

<main
  class="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center gap-6 px-6 py-20"
>
  {#if !data.valid}
    <div class="flex flex-col items-center gap-4 text-center">
      <div
        class="flex h-12 w-12 items-center justify-center rounded-[var(--radius)] bg-rose-950/40 text-rose-300"
      >
        <Lock size={24} />
      </div>
      <h1 class="text-2xl font-semibold tracking-tight">Verification link</h1>
    </div>
    <Alert variant="destructive" class="w-full text-center">
      This link is invalid or has expired. Head back to the server and click
      <span class="font-medium">Verify</span> again to get a fresh one.
    </Alert>
  {:else}
    <div class="flex flex-col items-center gap-3 text-center">
      <div
        class="flex h-14 w-14 items-center justify-center rounded-[var(--radius)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
      >
        <ShieldCheck size={28} />
      </div>
      <h1 class="text-2xl font-semibold tracking-tight">
        Verify you're a real human
      </h1>
      <p class="text-sm text-[hsl(var(--muted-foreground))]">
        Control Flow Guard keeps VPNs and alt accounts out. One quick check and
        you're in.
      </p>
    </div>

    <Card class="w-full p-6">
      <div class="flex flex-col gap-4">
        <div class="flex items-start gap-3">
          <ScanEye
            size={18}
            class="mt-0.5 shrink-0 text-[var(--color-accent)]"
          />
          <div class="text-sm text-[hsl(var(--muted-foreground))]">
            <p class="font-medium text-[hsl(var(--foreground))]">
              What we check
            </p>
            <p class="mt-1">
              We check your IP address against VPN / proxy databases to confirm
              you're not masking your connection.
            </p>
          </div>
        </div>
        <div class="flex items-start gap-3">
          <Lock size={18} class="mt-0.5 shrink-0 text-[var(--color-accent)]" />
          <div class="text-sm text-[hsl(var(--muted-foreground))]">
            <p class="font-medium text-[hsl(var(--foreground))]">
              What we store
            </p>
            <p class="mt-1">
              We never store your raw IP — only a one-way salted hash, used to
              enforce one account per person. It's kept for about 90 days, then
              forgotten.
            </p>
          </div>
        </div>
      </div>
    </Card>

    <Button href={startHref} variant="accent" size="lg" class="w-full">
      <ShieldCheck size={18} />
      Verify with Discord
    </Button>
    <p class="text-center text-xs text-[hsl(var(--muted-foreground))]">
      You'll sign in with Discord so we can confirm this link is yours.
    </p>
  {/if}
</main>
