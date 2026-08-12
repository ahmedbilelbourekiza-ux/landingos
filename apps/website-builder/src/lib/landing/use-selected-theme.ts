"use client";

import * as React from "react";
import { DEFAULT_THEME, type LandingThemeData } from "@/types/theme";
import { useBuilderApi } from "@/lib/builder/api-base";

/**
 * The theme the editor's CURRENT selection resolves to.
 *
 * Extracted from the preview drawer when the miniature preview learned to
 * render the page's theme too (the theme-bleed fix): two previews each
 * fetching and matching the theme list their own way is the D-LP.3 shape —
 * a second vocabulary that drifts. One hook, two consumers.
 *
 * `themeId` is the editor's unsaved selection (`preview.general.themeId`),
 * so a merchant trying themes sees each candidate before saving. No id, or
 * an id the list does not carry, resolves to DEFAULT_THEME — exactly what
 * the public page renders for a page with no theme row.
 */
export function useSelectedLandingTheme(themeId: string | null): LandingThemeData {
  // Bound to the console API by BuilderApiProvider.
  const api = useBuilderApi();
  const [theme, setTheme] = React.useState<LandingThemeData>(DEFAULT_THEME);

  React.useEffect(() => {
    if (!themeId) { setTheme(DEFAULT_THEME); return; }
    let cancelled = false;
    fetch(api("/themes"))
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        // Platform envelope: the list is data.items (LB.2, B-05).
        if (json.success && Array.isArray(json.data?.items)) {
          const found = json.data.items.find((t: LandingThemeData) => t.id === themeId);
          setTheme(found ?? DEFAULT_THEME);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
    // `api` returns a new closure per render (the shipping-section lesson,
    // FEATURE_PASS_AUG12 §3) — depending on it would refetch every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeId]);

  return theme;
}
