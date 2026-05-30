<script lang="ts">
  import type { HTMLAttributes } from "svelte/elements";
  import { cn } from "$lib/utils.js";
  import type { Snippet } from "svelte";

  type Props = HTMLAttributes<HTMLDivElement> & {
    class?: string;
    children?: Snippet;
  };

  let { class: className, children, ...rest }: Props = $props();
</script>

<div
  class={cn(
    "rounded-[var(--radius)] border border-zinc-800/80 bg-zinc-900/40 backdrop-blur-sm shadow-sm shadow-black/20",
    className,
  )}
  {...rest}
>
  {@render children?.()}
</div>
