<script lang="ts" module>
  import { tv, type VariantProps } from "tailwind-variants";

  export const buttonVariants = tv({
    base: "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius)] text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--background))] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 cursor-pointer",
    variants: {
      variant: {
        default:
          "border border-transparent bg-zinc-100 text-zinc-950 hover:bg-white shadow-sm shadow-black/20",
        secondary:
          "bg-zinc-800 text-zinc-100 hover:bg-zinc-700 border border-zinc-700",
        outline:
          "border border-zinc-700 bg-transparent text-zinc-100 hover:bg-zinc-800/60 hover:border-zinc-600",
        ghost:
          "border border-transparent text-zinc-300 hover:bg-zinc-800/60 hover:text-zinc-100",
        destructive:
          "border border-transparent bg-rose-600 text-white hover:bg-rose-500 shadow-sm shadow-rose-900/40",
        // The indigo "guard" accent - CFG's primary call to action.
        accent:
          "border border-transparent bg-indigo-500 text-white hover:bg-indigo-400 shadow-sm shadow-indigo-900/40",
        link: "text-indigo-300 underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        default: "h-9 px-4",
        lg: "h-11 px-6 text-base",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  });

  export type ButtonVariant = VariantProps<typeof buttonVariants>["variant"];
  export type ButtonSize = VariantProps<typeof buttonVariants>["size"];
</script>

<script lang="ts">
  import type {
    HTMLAnchorAttributes,
    HTMLButtonAttributes,
  } from "svelte/elements";
  import { cn } from "$lib/utils.js";
  import type { Snippet } from "svelte";

  type Props = (HTMLButtonAttributes | HTMLAnchorAttributes) & {
    variant?: ButtonVariant;
    size?: ButtonSize;
    href?: string;
    children?: Snippet;
    class?: string;
  };

  let {
    variant = "default",
    size = "default",
    href,
    class: className,
    children,
    ...rest
  }: Props = $props();
</script>

{#if href}
  <a
    {href}
    class={cn(buttonVariants({ variant, size }), className)}
    {...rest as HTMLAnchorAttributes}
  >
    {@render children?.()}
  </a>
{:else}
  <button
    class={cn(buttonVariants({ variant, size }), className)}
    {...rest as HTMLButtonAttributes}
  >
    {@render children?.()}
  </button>
{/if}
