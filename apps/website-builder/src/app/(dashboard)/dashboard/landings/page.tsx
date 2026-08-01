"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Loader2, AlertCircle } from "lucide-react";

import type { LandingListItem } from "@/lib/landing/mock-landings";
import type { LandingPageStatus } from "@/types/landing";
import { LandingsHeader } from "@/components/landings/landings-header";
import { SearchBar } from "@/components/landings/search-bar";
import { FilterTabs, type FilterValue } from "@/components/landings/filter-tabs";
import { SortSelect, type SortValue } from "@/components/landings/sort-select";
import { LandingTable } from "@/components/landings/landing-table";
import { LandingCard } from "@/components/landings/landing-card";
import { LandingEmptyState } from "@/components/landings/landing-empty-state";
import { LandingActionsMenu } from "@/components/landings/landing-actions-menu";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export default function LandingsPage() {
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState<FilterValue>("ALL");
  const [sort, setSort] = React.useState<SortValue>("updated");
  const [landings, setLandings] = React.useState<LandingListItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const router = useRouter();
  const handleCreate = () => router.push("/dashboard/landings/new");

  const fetchLandings = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/landings");
      const json = await res.json();
      if (json.success) {
        setLandings(json.data);
      } else {
        setError(json.error?.message || "فشل تحميل الصفحات");
      }
    } catch {
      setError("تعذّر الاتصال بالخادم. تحقّق من اتصالك بالشبكة.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchLandings();
  }, [fetchLandings]);

  const handleDelete = async (landing: LandingListItem) => {
    if (!confirm(`Delete "${landing.title}"? This cannot be undone.`)) return;
    await fetch(`/api/landings/${landing.id}`, { method: "DELETE" });
    fetchLandings();
  };

  const handleEdit = (landing: LandingListItem) => {
    router.push(`/dashboard/landings/${landing.id}/edit`);
  };

  const handleRowActions = (landing: LandingListItem) => ({
    onPreview: () => window.open(`/l/${landing.slug}`, "_blank"),
    onEdit: () => handleEdit(landing),
    onDuplicate: () => {},
    onPublish: () => {},
    onArchive: () => {},
    onDelete: () => handleDelete(landing),
  });

  const counts = React.useMemo<Record<FilterValue, number>>(
    () => ({
      ALL: landings.length,
      DRAFT: landings.filter((l) => l.status === "DRAFT").length,
      PUBLISHED: landings.filter((l) => l.status === "PUBLISHED").length,
      ARCHIVED: landings.filter((l) => l.status === "ARCHIVED").length,
    }),
    [landings],
  );

  const visible = React.useMemo(() => {
    let list = landings;
    if (filter !== "ALL") {
      list = list.filter((l) => l.status === (filter as LandingPageStatus));
    }
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((l) => l.title.toLowerCase().includes(q));

    return [...list].sort((a, b) => {
      const ta = new Date(a.updatedAt).getTime();
      const tb = new Date(b.updatedAt).getTime();
      if (sort === "oldest") return ta - tb;
      return tb - ta;
    });
  }, [landings, filter, query, sort]);

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

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="mx-auto max-w-md py-20">
            <Alert variant="destructive">
              <AlertCircle className="size-4" />
              <AlertTitle>تعذّر تحميل الصفحات</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
            <Button onClick={fetchLandings} variant="outline" className="mt-4 w-full">
              <Loader2 className="size-4" />
              إعادة المحاولة
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <FilterTabs value={filter} counts={counts} onChange={setFilter} />
              <div className="flex items-center gap-2">
                <SearchBar value={query} onChange={setQuery} className="w-full sm:w-64" />
                <SortSelect value={sort} onChange={setSort} />
              </div>
            </div>

            {visible.length === 0 ? (
              <LandingEmptyState
                title={isFilteredEmpty ? "No matching landing pages." : "No landing pages yet."}
                message={isFilteredEmpty ? "Try a different search or filter." : "Create your first landing page."}
                onCreate={isFilteredEmpty ? undefined : handleCreate}
              />
            ) : (
              <>
                <div className="hidden lg:block">
                  <LandingTable landings={visible} onRowActions={handleRowActions} />
                </div>
                <div className="flex flex-col gap-2 lg:hidden">
                  {visible.map((landing) => (
                    <LandingCard key={landing.id} landing={landing} onRowActions={handleRowActions} />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </motion.div>
    </div>
  );
}
