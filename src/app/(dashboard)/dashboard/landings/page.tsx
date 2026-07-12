"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";

import { mockLandings, type LandingListItem } from "@/lib/landing/mock-landings";
import type { LandingPageStatus } from "@/types/landing";
import { LandingsHeader } from "@/components/landings/landings-header";
import { SearchBar } from "@/components/landings/search-bar";
import { FilterTabs, type FilterValue } from "@/components/landings/filter-tabs";
import { SortSelect, type SortValue } from "@/components/landings/sort-select";
import { LandingTable } from "@/components/landings/landing-table";
import { LandingCard } from "@/components/landings/landing-card";
import { LandingEmptyState } from "@/components/landings/landing-empty-state";

// Note: metadata must live in a server component, but this page is a client
// component (it holds filter/search state). The title is set via the root
// layout's template ("%s · LandingOS") through a nested metadata export in
// a server wrapper if needed; for now the dashboard layout's default title
// applies, which is acceptable for an internal tool.

// Local CMS state: search query, status filter, and sort order. All derived
// lists (filtered + sorted) are computed with useMemo so the table and card
// views never re-render unnecessarily. Kept entirely in the page component —
// no store needed for a single-view, single-user internal tool.
export default function LandingsPage() {
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState<FilterValue>("ALL");
  const [sort, setSort] = React.useState<SortValue>("updated");

  const router = useRouter();
  const handleCreate = () => {
    router.push("/dashboard/landings/new");
  };

  // Counts per status for the filter tabs. "All" is the total. Computed once
  // per render over the static mock array — cheap, and stays correct when
  // real data arrives because the source is the same array.
  const counts = React.useMemo<Record<FilterValue, number>>(
    () => ({
      ALL: mockLandings.length,
      DRAFT: mockLandings.filter((l) => l.status === "DRAFT").length,
      PUBLISHED: mockLandings.filter((l) => l.status === "PUBLISHED").length,
      ARCHIVED: mockLandings.filter((l) => l.status === "ARCHIVED").length,
    }),
    [],
  );

  const visible = React.useMemo(() => {
    let list: LandingListItem[] = mockLandings;

    if (filter !== "ALL") {
      list = list.filter((l) => l.status === (filter as LandingPageStatus));
    }

    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((l) => l.title.toLowerCase().includes(q));
    }

    const sorted = [...list].sort((a, b) => {
      const ta = new Date(a.updatedAt).getTime();
      const tb = new Date(b.updatedAt).getTime();
      if (sort === "newest") return tb - ta;
      if (sort === "oldest") return ta - tb;
      // "updated" — most recently updated first. Same as newest in this mock
      // since updatedAt is the only timestamp exposed; diverges once the
      // list view also carries createdAt.
      return tb - ta;
    });

    return sorted;
  }, [filter, query, sort]);

  const isFilteredEmpty = query.trim() !== "" || filter !== "ALL";

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="flex flex-col gap-8"
      >
        <LandingsHeader onCreate={handleCreate} />

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <FilterTabs value={filter} counts={counts} onChange={setFilter} />
          <div className="flex items-center gap-2">
            <SearchBar
              value={query}
              onChange={setQuery}
              className="w-full sm:w-64"
            />
            <SortSelect value={sort} onChange={setSort} />
          </div>
        </div>

        {visible.length === 0 ? (
          <LandingEmptyState
            title={isFilteredEmpty ? "No matching landing pages." : "No landing pages yet."}
            message={
              isFilteredEmpty
                ? "Try a different search or filter."
                : "Create your first landing page."
            }
            onCreate={isFilteredEmpty ? undefined : handleCreate}
          />
        ) : (
          <>
            <div className="hidden lg:block">
              <LandingTable landings={visible} />
            </div>
            <div className="flex flex-col gap-2 lg:hidden">
              {visible.map((landing) => (
                <LandingCard key={landing.id} landing={landing} />
              ))}
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}
