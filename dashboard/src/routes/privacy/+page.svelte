<svelte:head>
  <title>Privacy · Control Flow Guard</title>
</svelte:head>

<main class="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-20">
  <div class="flex flex-col gap-3">
    <a
      href="/"
      class="text-sm font-medium tracking-wide text-[hsl(var(--muted-foreground))] transition hover:text-[hsl(var(--foreground))]"
    >
      Control Flow Guard
    </a>
    <h1 class="text-3xl font-semibold tracking-tight">Privacy</h1>
    <p class="text-sm text-[hsl(var(--muted-foreground))]">
      Control Flow Guard checks that people joining a Discord server aren't using
      a VPN or proxy, and that they don't already have an account there. This page
      explains what that involves.
    </p>
  </div>

  <section class="flex flex-col gap-2">
    <h2 class="text-lg font-medium">What we collect</h2>
    <ul class="flex flex-col gap-2 text-sm text-[hsl(var(--muted-foreground))]">
      <li>
        <span class="font-medium text-[hsl(var(--foreground))]"
          >Your Discord account.</span
        > When you sign in we read only your account ID, username, and display name
        (Discord's "identify" scope). We can't see your email, your messages, or the
        other servers you're in.
      </li>
      <li>
        <span class="font-medium text-[hsl(var(--foreground))]"
          >Your IP address.</span
        > We read it once, at the moment you verify, to run the check.
      </li>
      <li>
        <span class="font-medium text-[hsl(var(--foreground))]"
          >Network details.</span
        > The ISP, network operator (ASN), and country tied to that IP, from our detection
        providers.
      </li>
    </ul>
  </section>

  <section class="flex flex-col gap-2">
    <h2 class="text-lg font-medium">How we use it</h2>
    <ul class="flex flex-col gap-2 text-sm text-[hsl(var(--muted-foreground))]">
      <li>
        To check your connection isn't a VPN, proxy, or hosting/datacenter IP.
      </li>
      <li>
        To keep it one verified account per person, so a single connection can't
        be used to verify several accounts.
      </li>
    </ul>
  </section>

  <section class="flex flex-col gap-2">
    <h2 class="text-lg font-medium">What we store</h2>
    <ul class="flex flex-col gap-2 text-sm text-[hsl(var(--muted-foreground))]">
      <li>
        <span class="font-medium text-[hsl(var(--foreground))]"
          >Never your raw IP address.</span
        > We turn it into a one-way scrambled value (a salted hash). That value can't
        be turned back into your IP. It only lets us tell whether two verifications
        came from the same connection.
      </li>
      <li>
        A verification record: your Discord ID, that scrambled value, the risk
        score, and timestamps. If you're ever blocked, we save why and when, so
        staff can review it or undo it.
      </li>
      <li>
        Staff may see a partly hidden version of your IP (like
        <span class="mono">203.0.113.x</span>) in their log channel. They never see
        the full address.
      </li>
    </ul>
  </section>

  <section class="flex flex-col gap-2">
    <h2 class="text-lg font-medium">How long we keep it</h2>
    <p class="text-sm text-[hsl(var(--muted-foreground))]">
      The scrambled IP value and verification record are kept for about 90 days.
      After that they fall outside the matching window and aren't used.
    </p>
  </section>

  <section class="flex flex-col gap-2">
    <h2 class="text-lg font-medium">Who else sees your IP</h2>
    <p class="text-sm text-[hsl(var(--muted-foreground))]">
      To run the check, your IP is sent to two detection services:
      <a
        href="https://proxycheck.io/privacy/"
        rel="noreferrer noopener"
        target="_blank"
        class="underline underline-offset-4 hover:text-[hsl(var(--foreground))]"
        >ProxyCheck.io</a
      >
      and
      <a
        href="https://ipinfo.io/privacy-policy"
        rel="noreferrer noopener"
        target="_blank"
        class="underline underline-offset-4 hover:text-[hsl(var(--foreground))]"
        >ipinfo.io</a
      >. They tell us whether the IP is a VPN or proxy and return its network
      details. Nothing else is shared with anyone.
    </p>
  </section>

  <section class="flex flex-col gap-2">
    <h2 class="text-lg font-medium">Blocked by mistake?</h2>
    <p class="text-sm text-[hsl(var(--muted-foreground))]">
      Detection isn't perfect, and home or mobile connections can occasionally be
      misread. If you're blocked on a normal connection, message the server staff
      and they can clear it.
    </p>
  </section>
</main>
