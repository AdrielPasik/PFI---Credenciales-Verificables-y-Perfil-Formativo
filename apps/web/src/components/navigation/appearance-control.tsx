'use client';

import { Check, ChevronDown, Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent
} from 'react';

import type { AppearancePreference } from '@/lib/appearance/appearance';
import { useAppearance } from '@/lib/appearance/use-appearance';
import { cn } from '@/lib/utils';

const OPTIONS: ReadonlyArray<{
  value: AppearancePreference;
  label: string;
  icon: LucideIcon;
}> = [
  { value: 'light', label: 'Claro', icon: Sun },
  { value: 'dark', label: 'Oscuro', icon: Moon },
  { value: 'system', label: 'Según el sistema', icon: Monitor }
];

const TONES = {
  // Sobre el header invertido, oscuro en ambos temas.
  inverse: {
    group: 'border-white/25',
    divider: 'border-white/25',
    button:
      'text-brand-100 hover:bg-white/10 hover:text-white active:bg-white/15 focus-visible:ring-white/70'
  },
  // Sobre superficies del tema (autenticacion, paginas publicas).
  default: {
    group: 'border-border-strong bg-surface',
    divider: 'border-border-strong',
    button:
      'text-text-default hover:bg-highlight hover:text-text-strong active:bg-highlight focus-visible:ring-focus-ring'
  }
} as const;

const GROUP_SIZE = 'h-11 sm:h-9';

/**
 * Selector compacto de apariencia.
 *
 * - El boton sol/luna alterna DIRECTAMENTE entre claro y oscuro (desde el tema
 *   visible) y fija esa eleccion.
 * - La flecha abre un menu con Claro, Oscuro y Segun el sistema: es la unica
 *   forma de volver a seguir al sistema operativo.
 *
 * El servidor no conoce la preferencia (vive en el dispositivo): hasta la
 * hidratacion se reserva el mismo espacio, sin controles, para no mostrar un
 * estado falso ni mover el header.
 */
export function AppearanceControl({
  tone = 'default',
  className
}: {
  tone?: keyof typeof TONES;
  className?: string;
}) {
  const { preference, theme, setPreference, toggle } = useAppearance();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();
  const styles = TONES[tone];

  const close = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;

    // Al abrir, el foco va a la opcion vigente.
    const checked = OPTIONS.findIndex((option) => option.value === preference);
    itemRefs.current[Math.max(checked, 0)]?.focus();

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
    // `preference` solo importa al abrir: el menu se cierra al elegir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (preference === null || theme === null) {
    return (
      <span
        aria-hidden="true"
        className={cn('inline-block w-[4.5rem] shrink-0 sm:w-16', GROUP_SIZE, className)}
      />
    );
  }

  const nextTheme = theme === 'dark' ? 'claro' : 'oscuro';
  const ToggleIcon = theme === 'dark' ? Sun : Moon;

  const focusItem = (index: number) => {
    const count = OPTIONS.length;
    itemRefs.current[(index + count) % count]?.focus();
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = itemRefs.current.findIndex((item) => item === document.activeElement);
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusItem(current + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusItem(current - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusItem(0);
        break;
      case 'End':
        event.preventDefault();
        focusItem(OPTIONS.length - 1);
        break;
      case 'Escape':
        event.preventDefault();
        close(true);
        break;
      case 'Tab':
        setOpen(false);
        break;
    }
  };

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
    }
  };

  const buttonBase = cn(
    'inline-flex items-center justify-center transition-colors duration-150 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2',
    styles.button
  );

  return (
    <div ref={rootRef} className={cn('relative shrink-0', className)}>
      <div
        className={cn('inline-flex items-stretch rounded-control border', GROUP_SIZE, styles.group)}
      >
        <button
          type="button"
          onClick={toggle}
          aria-label={`Activar tema ${nextTheme}`}
          title={`Activar tema ${nextTheme}`}
          className={cn(buttonBase, 'w-11 rounded-l-[calc(var(--radius-control)-1px)] sm:w-10')}
        >
          <ToggleIcon aria-hidden="true" className="size-[1.125rem]" />
        </button>
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((value) => !value)}
          onKeyDown={onTriggerKeyDown}
          aria-label="Opciones de apariencia"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          className={cn(
            buttonBase,
            'w-7 rounded-r-[calc(var(--radius-control)-1px)] border-l sm:w-6',
            styles.divider
          )}
        >
          <ChevronDown
            aria-hidden="true"
            className={cn('size-3.5 transition-transform duration-150', open && 'rotate-180')}
          />
        </button>
      </div>

      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label="Apariencia"
          onKeyDown={onMenuKeyDown}
          className="absolute top-full right-0 z-50 mt-2 w-56 rounded-card border border-border-strong bg-surface p-1.5 text-text-strong shadow-md"
        >
          <p
            aria-hidden="true"
            className="px-3 pt-1.5 pb-1 text-xs font-semibold tracking-wider text-text-muted uppercase"
          >
            Apariencia
          </p>
          {OPTIONS.map((option, index) => {
            const Icon = option.icon;
            const checked = option.value === preference;
            return (
              <button
                key={option.value}
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                type="button"
                role="menuitemradio"
                aria-checked={checked}
                tabIndex={-1}
                onClick={() => {
                  setPreference(option.value);
                  close(true);
                }}
                className={cn(
                  'flex min-h-11 w-full items-center gap-3 rounded-control px-3 text-left text-sm transition-colors duration-150',
                  'hover:bg-highlight focus-visible:bg-highlight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
                  checked ? 'font-semibold text-text-strong' : 'text-text-default'
                )}
              >
                <Icon aria-hidden="true" className="size-4 shrink-0 text-text-muted" />
                <span className="flex-1">{option.label}</span>
                <Check
                  aria-hidden="true"
                  className={cn('size-4 shrink-0 text-accent', checked ? 'visible' : 'invisible')}
                />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
