"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Loader2, AlertCircle, Phone, ShoppingCart, PhoneOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { formatPrice } from "@/lib/landing/format";
import { cn } from "@/lib/utils";

interface Draft {
  id: string;
  customerName: string | null;
  phone: string | null;
  wilaya: string | null;
  baladia: string | null;
  quantity: number;
  totalPrice: number | null;
  productTitle: string;
  converted: boolean;
  notified: boolean;
  createdAt: string;
  updatedAt: string;
}

type Filter = "abandoned" | "converted" | "all";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "abandoned", label: "Abandoned" },
  { key: "converted", label: "Recovered" },
  { key: "all", label: "All" },
];

export default function AbandonedPage() {
  const [drafts, setDrafts] = React.useState<Draft[]>([]);
  const [total, setTotal] = React.useState(0);
  const [filter, setFilter] = React.useState<Filter>("abandoned");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const fetchDrafts = React.useCallback(async (current: Filter) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/draft-orders?filter=${current}&limit=100`);
      const json = await res.json();
      if (json.success) {
        setDrafts(json.data.drafts);
        setTotal(json.data.total);
      } else {
        setError(json.error?.message || "فشل تحميل الطلبات المتروكة");
      }
    } catch {
      setError("تعذّر الاتصال بالخادم. تحقّق من اتصالك بالشبكة.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { fetchDrafts(filter); }, [fetchDrafts, filter]);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="flex flex-col gap-6"
      >
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Abandoned Checkouts</h1>
          <p className="text-sm text-muted-foreground">
            Visitors who entered a phone number but never placed the order. Captured
            automatically as they type — call them back.
          </p>
        </div>

        <div className="flex gap-1 rounded-lg border p-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                filter === f.key
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="mx-auto max-w-md py-20">
            <Alert variant="destructive">
              <AlertCircle className="size-4" />
              <AlertTitle>تعذّر التحميل</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
            <Button onClick={() => fetchDrafts(filter)} variant="outline" className="mt-4 w-full">
              إعادة المحاولة
            </Button>
          </div>
        ) : drafts.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
            <PhoneOff className="size-8 text-muted-foreground/40" />
            <h3 className="text-base font-semibold">
              {filter === "converted" ? "No recovered leads yet." : "No abandoned checkouts."}
            </h3>
            <p className="max-w-sm text-sm text-muted-foreground">
              {filter === "abandoned"
                ? "When a visitor types their phone number but doesn't finish ordering, they'll show up here."
                : "Leads that started as abandoned checkouts and later became real orders appear here."}
            </p>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {total} {total === 1 ? "lead" : "leads"}
            </p>
            <div className="flex flex-col gap-2">
              {drafts.map((d) => (
                <div key={d.id} className="flex items-center gap-3 rounded-xl border bg-card p-3">
                  <span
                    className={cn(
                      "grid size-10 shrink-0 place-items-center rounded-lg border",
                      d.converted
                        ? "bg-green-500/10 text-green-600 dark:text-green-400"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {d.converted ? <ShoppingCart className="size-4" /> : <Phone className="size-4" />}
                  </span>

                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">
                        {d.customerName || <span className="text-muted-foreground">No name given</span>}
                      </span>
                      {d.converted && (
                        <span className="shrink-0 rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-400">
                          Recovered
                        </span>
                      )}
                    </div>
                    <span className="truncate text-xs text-muted-foreground">
                      <a href={`tel:${d.phone}`} className="font-mono hover:underline">
                        {d.phone}
                      </a>
                      {" · "}
                      {d.productTitle}
                      {d.wilaya ? ` · ${d.wilaya}` : ""}
                      {d.baladia ? `, ${d.baladia}` : ""}
                    </span>
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-0.5">
                    {d.totalPrice !== null && (
                      <span className="text-sm font-semibold tabular-nums">
                        {formatPrice(d.totalPrice, "DZD")}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {new Date(d.updatedAt).toLocaleString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}
