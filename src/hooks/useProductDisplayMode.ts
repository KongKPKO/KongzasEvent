import { useState } from 'react';

export function useProductDisplayMode(key: string) {
  const [mode, setMode] = useState<'visual' | 'operations'>(() => {
    try { return localStorage.getItem(key) === 'operations' ? 'operations' : 'visual'; }
    catch { return 'visual'; }
  });
  const selectMode = (next: 'visual' | 'operations') => {
    setMode(next);
    try { localStorage.setItem(key, next); } catch { /* Storage may be unavailable. */ }
  };
  return [mode, selectMode] as const;
}
