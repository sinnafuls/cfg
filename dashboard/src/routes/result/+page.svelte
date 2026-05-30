<script lang="ts">
  import Card from "$lib/components/ui/Card.svelte";
  import Alert from "$lib/components/ui/Alert.svelte";
  import Badge from "$lib/components/ui/Badge.svelte";
  import {
    ShieldCheck,
    ShieldAlert,
    Users,
    TriangleAlert,
    Clock,
  } from "@lucide/svelte";
  import type { PageData } from "./$types.js";

  let { data }: { data: PageData } = $props();

  // `until` is epoch ms; render an absolute local time + a short relative hint.
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
  class="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center gap-6 px-6 py-20"
>
  {#if data.status === "success"}
    <div
      class="flex h-14 w-14 items-center justify-center rounded-[var(--radius)] bg-emerald-950/40 text-emerald-300"
    >
      <ShieldCheck size={28} />
    </div>
    <div class="flex flex-col items-center gap-2 text-center">
      <h1 class="text-2xl font-semibold tracking-tight">You're verified</h1>
      <Badge variant="success">
        <ShieldCheck size={12} /> Verified human
      </Badge>
    </div>
    {#if data.pending}
      <Alert variant="warning" class="w-full text-center">
        You're verified — your role is syncing and should appear in Discord
        shortly. You can close this tab.
      </Alert>
    {:else}
      <Card class="w-full p-6 text-center text-sm text-[hsl(var(--muted-foreground))]">
        Your verified role has been assigned. You can close this tab and head
        back to Discord.
      </Card>
    {/if}
  {:else if data.status === "blocked"}
    <div
      class="flex h-14 w-14 items-center justify-center rounded-[var(--radius)] bg-rose-950/40 text-rose-300"
    >
      <ShieldAlert size={28} />
    </div>
    <h1 class="text-2xl font-semibold tracking-tight">Verification blocked</h1>
    <Alert variant="destructive" class="w-full">
      <p>
        Your connection looks like a VPN, proxy, or datacenter IP. Turn off any
        VPN / proxy and try again.
      </p>
      {#if untilText}
        <p class="mt-2 flex items-center gap-1.5 text-xs">
          <Clock size={13} />
          <span>You can retry after <span class="mono">{untilText}</span>.</span>
        </p>
      {/if}
    </Alert>
    <p class="text-center text-xs text-[hsl(var(--muted-foreground))]">
      Think this is a mistake? Contact the server staff to appeal.
    </p>
  {:else if data.status === "duplicate"}
    <div
      class="flex h-14 w-14 items-center justify-center rounded-[var(--radius)] bg-rose-950/40 text-rose-300"
    >
      <Users size={28} />
    </div>
    <h1 class="text-2xl font-semibold tracking-tight">Already verified</h1>
    <Alert variant="destructive" class="w-full">
      {#if data.linkedName}
        <!-- Svelte auto-escapes {data.linkedName}; the server also applied the
             reveal policy + the value is HTML-safe. -->
        You're already in this server as
        <span class="font-medium">{data.linkedName}</span>. Each member may only
        verify one account — contact staff if this is a mistake.
      {:else}
        An account on your network is already verified in this server. Each
        member may only verify one account — contact staff if this is a mistake.
      {/if}
    </Alert>
  {:else}
    <!-- error / pending fallthrough -->
    <div
      class="flex h-14 w-14 items-center justify-center rounded-[var(--radius)] bg-amber-950/40 text-amber-300"
    >
      <TriangleAlert size={28} />
    </div>
    <h1 class="text-2xl font-semibold tracking-tight">Something went wrong</h1>
    <Alert variant="warning" class="w-full text-center">
      We couldn't complete your verification. Head back to the server and click
      <span class="font-medium">Verify</span> to try again.
    </Alert>
  {/if}
</main>
