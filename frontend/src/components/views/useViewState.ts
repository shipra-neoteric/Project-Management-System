'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useViews } from '@/features/queries';
import { EMPTY_CONFIG } from '@/lib/query';
import type { SavedView, ViewConfig, ViewKind } from '@/lib/types';

/**
 * Current filters/sort/grouping for one view kind of one project.
 * Unsaved changes are remembered per browser; picking a saved view loads its config.
 */
export function useViewState(projectId: string, kind: ViewKind, defaults: Partial<ViewConfig> = {}) {
  const storageKey = `pms_view_${projectId}_${kind}`;
  const defaultsKey = JSON.stringify(defaults);
  const base = useMemo<ViewConfig>(() => ({ ...EMPTY_CONFIG, ...(JSON.parse(defaultsKey) as Partial<ViewConfig>) }), [defaultsKey]);
  const [config, setConfigState] = useState<ViewConfig>(base);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const views = useViews(projectId);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const saved = JSON.parse(raw) as { config: ViewConfig; viewId: string | null };
        setConfigState({ ...base, ...saved.config });
        setActiveViewId(saved.viewId);
      }
    } catch {
      /* ignore */
    }
    // Only on first load for this project/kind.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const persist = useCallback(
    (next: ViewConfig, viewId: string | null) => {
      try {
        localStorage.setItem(storageKey, JSON.stringify({ config: next, viewId }));
      } catch {
        /* ignore */
      }
    },
    [storageKey],
  );

  const setConfig = useCallback(
    (next: ViewConfig | ((prev: ViewConfig) => ViewConfig)) => {
      setConfigState((prev) => {
        const value = typeof next === 'function' ? next(prev) : next;
        persist(value, activeViewId);
        return value;
      });
    },
    [persist, activeViewId],
  );

  const kindViews = useMemo(() => (views.data ?? []).filter((v) => v.kind === kind), [views.data, kind]);
  const activeView = kindViews.find((v) => v._id === activeViewId) ?? null;
  const isDirty = activeView ? JSON.stringify({ ...base, ...activeView.config }) !== JSON.stringify(config) : false;

  const selectView = useCallback(
    (view: SavedView | null) => {
      const next = view ? { ...base, ...view.config } : base;
      setActiveViewId(view?._id ?? null);
      setConfigState(next);
      persist(next, view?._id ?? null);
    },
    [base, persist],
  );

  return { config, setConfig, views: kindViews, activeView, selectView, isDirty, reset: () => selectView(null) };
}

export type ViewState = ReturnType<typeof useViewState>;
