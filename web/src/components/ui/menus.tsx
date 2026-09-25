import { CheckIcon, ChevronDownIcon } from 'lucide-react';
import { DropdownMenu as Menu, Popover as PopoverPrimitive, Select as SelectPrimitive, Tooltip as TooltipPrimitive } from 'radix-ui';
import * as React from 'react';
import { cn } from '@/lib/utils';
import { Kbd } from './input';

const surface =
  'z-50 rounded-lg border border-line bg-paper text-ink shadow-pop outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1';

// ---------------------------------------------------------------------------
// Popover
// ---------------------------------------------------------------------------

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;

export function PopoverContent({ className, align = 'center', sideOffset = 6, ...props }: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content align={align} sideOffset={sideOffset} className={cn(surface, 'w-72 p-3', className)} {...props} />
    </PopoverPrimitive.Portal>
  );
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

export const TooltipProvider = TooltipPrimitive.Provider;

export function Tooltip({
  content,
  shortcut,
  side = 'bottom',
  children,
}: {
  content: React.ReactNode;
  shortcut?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  children: React.ReactNode;
}) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className="z-[60] flex items-center gap-2 rounded-md bg-ink px-2 py-1 text-xs font-medium text-white shadow-pop data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0"
        >
          {content}
          {shortcut && <span className="text-[11px] text-white/60">{shortcut}</span>}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

// ---------------------------------------------------------------------------
// Dropdown menu
// ---------------------------------------------------------------------------

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;
export const DropdownMenuGroup = Menu.Group;

export function DropdownMenuContent({ className, sideOffset = 6, align = 'end', ...props }: React.ComponentProps<typeof Menu.Content>) {
  return (
    <Menu.Portal>
      <Menu.Content sideOffset={sideOffset} align={align} className={cn(surface, 'min-w-44 p-1', className)} {...props} />
    </Menu.Portal>
  );
}

export function DropdownMenuItem({
  className,
  destructive,
  shortcut,
  children,
  ...props
}: React.ComponentProps<typeof Menu.Item> & { destructive?: boolean; shortcut?: string }) {
  return (
    <Menu.Item
      className={cn(
        'flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-45 data-[highlighted]:bg-ink/[0.06] [&_svg]:size-4 [&_svg]:text-ink-3',
        destructive && 'text-bad data-[highlighted]:bg-bad-soft [&_svg]:text-bad',
        className,
      )}
      {...props}
    >
      {children}
      {shortcut && <Kbd className="ml-auto">{shortcut}</Kbd>}
    </Menu.Item>
  );
}

export function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<typeof Menu.Separator>) {
  return <Menu.Separator className={cn('mx-1 my-1 h-px bg-line', className)} {...props} />;
}

export function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof Menu.Label>) {
  return <Menu.Label className={cn('px-2 pt-1.5 pb-1 text-xs font-medium text-ink-3', className)} {...props} />;
}

// ---------------------------------------------------------------------------
// Select
// ---------------------------------------------------------------------------

export interface SelectOption<T extends string> {
  value: T;
  label: React.ReactNode;
  /** Text used for the trigger when label is rich. */
  text?: string;
  disabled?: boolean;
}

export function Select<T extends string>({
  value,
  onValueChange,
  options,
  className,
  placeholder,
  disabled,
  id,
  'aria-label': ariaLabel,
}: {
  value: T | undefined;
  onValueChange: (value: T) => void;
  options: SelectOption<T>[];
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
}) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={(v) => onValueChange(v as T)} disabled={disabled}>
      <SelectPrimitive.Trigger
        id={id}
        aria-label={ariaLabel}
        className={cn(
          'flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-line-strong bg-paper px-2.5 text-sm text-ink outline-none hover:border-ink-4 focus-visible:border-cobalt focus-visible:ring-2 focus-visible:ring-cobalt-ring disabled:opacity-50 data-[placeholder]:text-ink-4 [&>span]:truncate',
          className,
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon>
          <ChevronDownIcon className="size-4 text-ink-3" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content position="popper" sideOffset={4} className={cn(surface, 'max-h-80 min-w-[var(--radix-select-trigger-width)] overflow-hidden')}>
          <SelectPrimitive.Viewport className="p-1">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className="relative flex h-8 cursor-default items-center rounded-md pr-8 pl-2 text-sm outline-none select-none data-[disabled]:opacity-45 data-[highlighted]:bg-ink/[0.06]"
              >
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="absolute right-2">
                  <CheckIcon className="size-4 text-cobalt" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
