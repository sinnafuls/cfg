<script lang="ts">
  import { page } from "$app/state";
  import Card from "$lib/components/ui/Card.svelte";
  import Alert from "$lib/components/ui/Alert.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import { ShieldCheck, Lock } from "@lucide/svelte";
  import type { PageData } from "./$types.js";

  let { data }: { data: PageData } = $props();

  // The "Continue with Discord" button is a plain link to the OAuth-start
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
      <h1 class="text-2xl font-semibold tracking-tight">This link won't work</h1>
    </div>
    <Alert variant="destructive" class="w-full text-center">
      It's either already been used or it expired (links last 15 minutes). Go
      back to the server and press <span class="font-medium">Verify</span> for a
      fresh one.
    </Alert>
  {:else}
    <div class="flex flex-col items-center gap-3 text-center">
      <div
        class="flex h-14 w-14 items-center justify-center rounded-[var(--radius)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
      >
        <ShieldCheck size={28} />
      </div>
      <h1 class="text-2xl font-semibold tracking-tight">Verify your account</h1>
      <p class="text-sm text-[hsl(var(--muted-foreground))]">
        Sign in with Discord and we'll run the check. It takes a few seconds.
      </p>
    </div>

    <Card class="w-full p-6 text-sm text-[hsl(var(--muted-foreground))]">
      <p>
        We look at your IP address to see if it belongs to a VPN, proxy, or
        hosting provider. We don't keep the address itself. What we save is a
        scrambled version of it (a one-way hash) so we can tell if someone tries
        to verify a second account from the same connection. That hash is
        deleted after about 90 days.
      </p>
    </Card>

    <Button href={startHref} variant="accent" size="lg" class="w-full">
      <ShieldCheck size={18} />
      Continue with Discord
    </Button>
    <p class="text-center text-xs text-[hsl(var(--muted-foreground))]">
      Signing in just proves the link belongs to you. We only read your account
      ID.
    </p>
  {/if}
</main>
