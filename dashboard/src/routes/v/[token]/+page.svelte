<script lang="ts">
  import { page } from "$app/state";
  import Alert from "$lib/components/ui/Alert.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import type { PageData } from "./$types.js";

  let { data }: { data: PageData } = $props();

  // The "Continue with Discord" button is a plain link to the OAuth-start
  // endpoint (a GET that builds the signed-state URL, sets the nonce cookie,
  // and 302s to Discord). Keeping it a link means no client JS is required.
  const startHref = $derived(`/v/${page.params.token}/start`);
</script>

<svelte:head>
  <title>Verify · Control Flow Guard</title>
</svelte:head>

<main
  class="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-5 px-6 py-20 text-center"
>
  <a
    href="/"
    class="text-sm font-medium tracking-wide text-[hsl(var(--muted-foreground))] transition hover:text-[hsl(var(--foreground))]"
  >
    Control Flow Guard
  </a>

  {#if !data.valid}
    <h1 class="text-2xl font-semibold tracking-tight">This link won't work</h1>
    <Alert variant="destructive" class="w-full text-center">
      It's already been used or it expired — links last 15 minutes. Head back to
      the server and press <span class="font-medium">Verify</span> for a fresh one.
    </Alert>
  {:else}
    <h1 class="text-2xl font-semibold tracking-tight">Verify your account</h1>
    <p class="text-sm text-[hsl(var(--muted-foreground))]">
      Sign in with Discord and we'll run a quick check. It takes a few seconds.
    </p>

    <Button href={startHref} variant="accent" size="lg" class="w-full">
      Continue with Discord
    </Button>

    <p class="text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">
      We check whether your IP is a VPN, proxy, or hosting provider. We don't
      store your IP — only a scrambled version of it, so one person can't verify
      two accounts. <a
        href="/privacy"
        class="underline underline-offset-4 hover:text-[hsl(var(--foreground))]"
        >How we handle your data</a
      >.
    </p>

    <p class="text-xs text-[hsl(var(--muted-foreground))]">
      Tip: on a VPN? Turn it off before you start, or you'll be asked to retry.
    </p>
  {/if}
</main>
