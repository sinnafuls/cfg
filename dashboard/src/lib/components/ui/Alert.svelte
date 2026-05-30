<script lang="ts" module>
  import { tv, type VariantProps } from "tailwind-variants";

  export const alertVariants = tv({
    base: "rounded-[var(--radius)] border px-4 py-2.5 text-sm",
    variants: {
      variant: {
        default: "border-zinc-800 bg-zinc-900/40 text-zinc-300",
        success: "border-emerald-900/60 bg-emerald-950/30 text-emerald-200",
        warning: "border-amber-900/60 bg-amber-950/30 text-amber-200",
        destructive: "border-rose-900/60 bg-rose-950/30 text-rose-200",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  });

  export type AlertVariant = VariantProps<typeof alertVariants>["variant"];
</script>

<script lang="ts">
  import type { HTMLAttributes } from "svelte/elements";
  import { cn } from "$lib/utils.js";
  import type { Snippet } from "svelte";

  type Props = HTMLAttributes<HTMLDivElement> & {
    variant?: AlertVariant;
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

<div role="alert" class={cn(alertVariants({ variant }), className)} {...rest}>
  {@render children?.()}
</div>
