<script lang="ts">
  let { isStatic = false }: { isStatic?: boolean } = $props();

  let canvas = $state<HTMLCanvasElement | null>(null);

  // Orb tints - monochrome (whites + greys) at very low alpha so the backdrop
  // reads as atmospheric depth, not decoration competing with foreground
  // content. Range 0.025-0.04.
  const PARTICLE_COLORS = [
    "rgba(255, 255, 255, 0.035)",
    "rgba(255, 255, 255, 0.025)",
    "rgba(200, 200, 200, 0.03)",
    "rgba(180, 180, 180, 0.03)",
    "rgba(255, 255, 255, 0.04)",
    "rgba(220, 220, 220, 0.025)",
  ];

  const ORB_COUNT = 6;
  const TARGET_FPS = 30;
  const FRAME_INTERVAL = 1000 / TARGET_FPS;

  interface Orb {
    x: number;
    y: number;
    radius: number;
    color: string;
    vx: number;
    vy: number;
  }

  $effect(() => {
    if (!canvas) return;

    // Respect reduced-motion - paint one static frame and stop.
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    let orbs: Orb[] = [];
    let animationId: number | null = null;
    let lastFrameTime = 0;
    let isVisible = true;

    function initOrbs(width: number, height: number) {
      orbs = [];
      for (let i = 0; i < ORB_COUNT; i++) {
        orbs.push({
          x: Math.random() * width,
          y: Math.random() * height,
          radius: 150 + Math.random() * 200,
          color:
            PARTICLE_COLORS[i % PARTICLE_COLORS.length] ??
            "rgba(255,255,255,0.02)",
          vx: (Math.random() - 0.5) * 0.3,
          vy: (Math.random() - 0.5) * 0.3,
        });
      }
    }

    function draw(
      ctx: CanvasRenderingContext2D,
      width: number,
      height: number,
    ) {
      ctx.clearRect(0, 0, width, height);

      // Subtle grid lines - just enough to read as structure.
      ctx.strokeStyle = "rgba(255, 255, 255, 0.025)";
      ctx.lineWidth = 1;
      const gridSize = 60;
      for (let x = 0; x < width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y < height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // Drifting orb gradients.
      for (const orb of orbs) {
        const gradient = ctx.createRadialGradient(
          orb.x,
          orb.y,
          0,
          orb.x,
          orb.y,
          orb.radius,
        );
        gradient.addColorStop(0, orb.color);
        gradient.addColorStop(1, "transparent");
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(orb.x, orb.y, orb.radius, 0, Math.PI * 2);
        ctx.fill();
      }

      // Radial vignette.
      const centerX = width / 2;
      const centerY = height / 2;
      const maxRadius = Math.sqrt(centerX * centerX + centerY * centerY);
      const vignette = ctx.createRadialGradient(
        centerX,
        centerY,
        0,
        centerX,
        centerY,
        maxRadius,
      );
      vignette.addColorStop(0, "transparent");
      vignette.addColorStop(0.7, "transparent");
      vignette.addColorStop(1, "rgba(0, 0, 0, 0.3)");
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, width, height);
    }

    function updateOrbs(width: number, height: number) {
      for (const orb of orbs) {
        orb.x += orb.vx;
        orb.y += orb.vy;
        if (orb.x < -orb.radius) orb.x = width + orb.radius;
        if (orb.x > width + orb.radius) orb.x = -orb.radius;
        if (orb.y < -orb.radius) orb.y = height + orb.radius;
        if (orb.y > height + orb.radius) orb.y = -orb.radius;
      }
    }

    function animate(timestamp: number) {
      if (!isVisible || !canvas) return;

      const elapsed = timestamp - lastFrameTime;
      if (elapsed >= FRAME_INTERVAL) {
        lastFrameTime = timestamp - (elapsed % FRAME_INTERVAL);
        const ctx = canvas.getContext("2d");
        if (ctx) {
          const width = canvas.width;
          const height = canvas.height;
          if (!isStatic) updateOrbs(width, height);
          draw(ctx, width, height);
        }
      }

      if (!isStatic) {
        animationId = requestAnimationFrame(animate);
      }
    }

    function handleResize() {
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.scale(dpr, dpr);
      initOrbs(rect.width, rect.height);

      if (isStatic || reducedMotion) {
        const ctx2 = canvas.getContext("2d");
        if (ctx2) draw(ctx2, rect.width, rect.height);
      }
    }

    function handleVisibilityChange() {
      isVisible = !document.hidden;
      if (isVisible && !isStatic && !reducedMotion && !animationId) {
        animationId = requestAnimationFrame(animate);
      }
    }

    handleResize();

    if (reducedMotion || isStatic) {
      // One static frame already painted by handleResize above.
    } else {
      animationId = requestAnimationFrame(animate);
    }

    window.addEventListener("resize", handleResize);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (animationId) cancelAnimationFrame(animationId);
      window.removeEventListener("resize", handleResize);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  });
</script>

<canvas
  bind:this={canvas}
  class="fixed inset-0 -z-10 pointer-events-none"
  style="width: 100vw; height: 100vh;"
  aria-hidden="true"
></canvas>
