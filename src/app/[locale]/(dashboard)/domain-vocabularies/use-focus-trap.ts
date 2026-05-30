'use client';

import { useEffect, type RefObject } from 'react';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Trap Tab/Shift-Tab focus inside a container while it is mounted (modal
 * dialogs, command palettes). Also wires Escape to a `onEscape` callback
 * and locks body scroll for the duration.
 *
 * Caller owns the container ref and the open/closed state; the hook only
 * binds while `active === true` and the ref points at a node.
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  active: boolean,
  onEscape: () => void,
  options: { lockBodyScroll?: boolean } = { lockBodyScroll: true },
): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onEscape();
        return;
      }
      if (e.key !== 'Tab') return;
      const container = containerRef.current;
      if (!container) return;
      const focusable = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    let prevOverflow = '';
    if (options.lockBodyScroll) {
      prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    return () => {
      window.removeEventListener('keydown', onKey);
      if (options.lockBodyScroll) {
        document.body.style.overflow = prevOverflow;
      }
    };
  }, [active, containerRef, onEscape, options.lockBodyScroll]);
}
