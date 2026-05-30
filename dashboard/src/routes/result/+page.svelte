<script lang="ts">
  import Alert from "$lib/components/ui/Alert.svelte";
  import type { PageData } from "./$types.js";

  let { data }: { data: PageData } = $props();

  // `until` is epoch ms; render an absolute local time the user can read.
  const untilDate = $derived(data.until ? new Date(data.until) : null);
  const untilText = $derived(
    untilDate
      ? untilDate.toLocaleString(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        })
      : null,
  );
</script>

<svelte:head>
  <title>Verification result · Control Flow Guard</title>
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

  {#if data.status === "success"}
    <h1 class="text-2xl font-semibold tracking-tight">You're in</h1>
    {#if data.pending}
      <Alert variant="warning" class="w-full text-center">
        You passed the check. Your role is being added now and should appear in
        Discord in a moment. You can close this tab.
      </Alert>
    {:else}
      <p class="text-sm text-[hsl(var(--muted-foreground))]">
        Your role has been added. Close this tab and head back to Discord.
      </p>
    {/if}
  {:else if data.status === "blocked"}
    <h1 class="text-2xl font-semibold tracking-tight">Couldn't let you in</h1>
    <Alert variant="destructive" class="w-full text-center">
      Your connection looks like a VPN, proxy, or server host. Turn it off and
      try again from your normal connection.{#if untilText}
        You can try again after <span class="mono">{untilText}</span>.{/if}
    </Alert>
    <p class="text-xs text-[hsl(var(--muted-foreground))]">
      On a normal home or phone connection and still seeing this? Let the server
      staff know and they can let you in.
    </p>
  {:else if data.status === "duplicate"}
    <h1 class="text-2xl font-semibold tracking-tight">
      You already have an account here
    </h1>
    <Alert variant="destructive" class="w-full text-center">
      {#if data.linkedName}
        <!-- Svelte auto-escapes {data.linkedName}; the server also applied the
             reveal policy + the value is HTML-safe. -->
        This server already has a verified account from your connection,
        <span class="font-medium">{data.linkedName}</span>. Only one account per
        person is allowed.
      {:else}
        This server already has a verified account from your connection. Only one
        account per person is allowed.
      {/if}
    </Alert>
    <p class="text-xs text-[hsl(var(--muted-foreground))]">
      If that account isn't yours, contact the server staff.
    </p>
  {:else}
    <h1 class="text-2xl font-semibold tracking-tight">That didn't go through</h1>
    <Alert variant="warning" class="w-full text-center">
      Something broke partway through. Head back to the server and press
      <span class="font-medium">Verify</span> to start over.
    </Alert>
  {/if}
</main>
