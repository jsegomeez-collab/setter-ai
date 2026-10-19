import { Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * Botón único de la web (sistema de diseño §4). Principal = dorado y UNO por vista; secundario, fantasma y peligro
 * para el resto. Con `loading` enseña un spinner y no se puede pulsar dos veces.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

const VARIANT: Readonly<Record<ButtonVariant, string>> = {
  primary: 'btn-gold',
  secondary: 'rounded-[10px] border border-white/10 bg-white/[0.04] text-mist hover:border-white/20 hover:bg-white/[0.07] hover:text-fog',
  ghost: 'rounded-[10px] text-ash hover:bg-white/[0.05] hover:text-fog',
  danger: 'rounded-[10px] border border-bad/35 text-bad hover:bg-bad/10',
};
const SIZE: Readonly<Record<ButtonSize, string>> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
};

export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md'): string {
  return [
    'inline-flex shrink-0 items-center justify-center font-semibold whitespace-nowrap transition-colors duration-150 ease-out',
    'disabled:cursor-not-allowed disabled:opacity-45',
    VARIANT[variant],
    SIZE[size],
  ].join(' ');
}

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
};

export function Button({ variant = 'secondary', size = 'md', loading = false, icon, children, className, type = 'button', disabled, ...rest }: Props) {
  return (
    <button type={type} disabled={disabled || loading} aria-busy={loading || undefined} className={[buttonClass(variant, size), className ?? ''].join(' ')} {...rest}>
      {loading ? <Loader2 size={size === 'sm' ? 14 : 16} className="animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}
