import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import * as React from 'react';
import { cn } from '@/lib/utils';

export const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-[background-color,border-color,color,box-shadow] duration-100 outline-none focus-visible:ring-2 focus-visible:ring-cobalt focus-visible:ring-offset-1 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-cobalt text-white shadow-[inset_0_-1px_0_rgb(0_0_0/0.15)] hover:bg-cobalt-strong active:bg-cobalt-strong',
        ink: 'bg-ink text-white hover:bg-ink-2',
        secondary: 'border border-line-strong bg-paper text-ink shadow-[0_1px_0_rgb(24_26_31/0.04)] hover:bg-surface hover:border-ink-4',
        ghost: 'text-ink-2 hover:bg-ink/[0.06] hover:text-ink data-[state=on]:bg-ink/[0.08] data-[state=open]:bg-ink/[0.06]',
        danger: 'bg-bad text-white hover:bg-bad/90',
        'danger-ghost': 'text-bad hover:bg-bad-soft',
        link: 'h-auto px-0 text-cobalt underline-offset-2 hover:underline',
      },
      size: {
        xs: 'h-6 px-2 text-xs [&_svg]:size-3.5',
        sm: 'h-7 px-2.5 text-xs [&_svg]:size-3.5',
        md: 'h-8 px-3 text-sm [&_svg]:size-4',
        lg: 'h-10 px-4 text-base [&_svg]:size-4',
        icon: 'size-8 [&_svg]:size-4',
        'icon-sm': 'size-7 [&_svg]:size-4',
        'icon-xs': 'size-6 [&_svg]:size-3.5',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export interface ButtonProps extends React.ComponentProps<'button'>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, type, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button';
  return <Comp type={asChild ? undefined : (type ?? 'button')} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
