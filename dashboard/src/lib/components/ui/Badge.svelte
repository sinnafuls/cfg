<script lang="ts" module>
  import { tv, type VariantProps } from "tailwind-variants";

  export const badgeVariants = tv({
    base: "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium tracking-wide transition-colors",
    variants: {
      variant: {
        default: "bg-zinc-800 text-zinc-300 border border-zinc-700",
        outline: "border border-zinc-700 text-zinc-400 bg-transparent",
        success:
          "bg-emerald-950/60 text-emerald-300 border border-emerald-900/60",
        warning: "bg-amber-950/60 text-amber-300 border border-amber-900/60",
        destructive: "bg-rose-950/60 text-rose-300 border border-rose-900/60",
        accent: "bg-indigo-950/60 text-indigo-300 border border-indigo-900/60",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  });

  export type BadgeVariant = VariantProps<typeof badgeVariants>["variant"];
</script>

<script lang="ts">
  import type { HTMLAttributes } from "svelte/elements";
  import { cn } from "$lib/utils.js";
  import type { Snippet } from "svelte";

  type Props = HTMLAttributes<HTMLSpanElement> & {
    variant?: BadgeVariant;
    class?: string;
    children?: Snippet;
  };

  let {
    variant = "default",
    class: className,
    children,
    ...rest
  }: Props = $props();
</script>

<span class={cn(badgeVariants({ variant }), className)} {...rest}>
  {@render children?.()}
</span>
