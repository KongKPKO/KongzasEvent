import { useCallback, useEffect, useRef } from 'react';

export function useUnsavedChanges(dirty: boolean, message: string) {
  const allowedUnload = useRef(false);
  const allowNextUnload = useCallback(() => { allowedUnload.current = true; }, []);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { if (allowedUnload.current) { allowedUnload.current = false; return; } event.preventDefault(); event.returnValue = ''; };
    const onLink = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest('a[href]') as HTMLAnchorElement | null;
      if (!link || link.target === '_blank' || link.origin !== window.location.origin || link.href === window.location.href) return;
      if (!window.confirm(message)) { event.preventDefault(); event.stopPropagation(); }
    };
    let currentIndex = window.history.state?.idx as number | undefined;
    let restoring = false;
    const onPopState = (event: PopStateEvent) => {
      const nextIndex = event.state?.idx as number | undefined;
      if (restoring) { restoring = false; event.stopImmediatePropagation(); return; }
      if (window.confirm(message)) { currentIndex = nextIndex; return; }
      event.stopImmediatePropagation();
      restoring = true;
      window.history.go((typeof currentIndex === 'number' && typeof nextIndex === 'number' ? currentIndex - nextIndex : 1) || 1);
    };
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('popstate', onPopState, true);
    document.addEventListener('click', onLink, true);
    return () => { window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('popstate', onPopState, true); document.removeEventListener('click', onLink, true); };
  }, [dirty, message]);
  return allowNextUnload;
}
