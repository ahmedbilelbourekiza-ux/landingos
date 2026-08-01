"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Truck, Search, Loader2, Check, AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface WilayaPrice {
  id: number;
  code: string;
  name: string;
  nameAr: string | null;
  homePrice: number | null;
  deskPrice: number | null;
}

export default function DeliveryPricesPage() {
  const [wilayas, setWilayas] = React.useState<WilayaPrice[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [edits, setEdits] = React.useState<Record<number, { home: string; desk: string }>>({});

  const fetchPrices = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/delivery-prices");
      const json = await res.json();
      if (json.success) {
        setWilayas(json.data);
      } else {
        setError(json.error?.message || "فشل تحميل أسعار التوصيل");
      }
    } catch {
      setError("تعذّر الاتصال بالخادم. تحقّق من اتصالك بالشبكة.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchPrices();
  }, [fetchPrices]);

  const handleEdit = (id: number, field: "home" | "desk", value: string) => {
    setEdits((prev) => ({
      ...prev,
      [id]: { ...prev[id] ?? { home: "", desk: "" }, [field]: value },
    }));
  };

  const hasEdits = Object.keys(edits).length > 0;

  const handleSave = async () => {
    setSaving(true);
    const prices = Object.entries(edits).map(([id, val]) => ({
      wilayaId: Number(id),
      homePrice: Number(val.home) || 0,
      deskPrice: val.desk ? Number(val.desk) : null,
    }));
    try {
      const res = await fetch("/api/settings/delivery-prices", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prices }),
      });
      const json = await res.json();
      if (json.success) {
        setSaved(true);
        setEdits({});
        setTimeout(() => setSaved(false), 2000);
        await fetchPrices();
      }
    } finally {
      setSaving(false);
    }
  };

  const filtered = wilayas.filter((w) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return w.name.toLowerCase().includes(q) || w.code.includes(q) || (w.nameAr ?? "").includes(q);
  });

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="flex flex-col gap-6"
      >
        {/* Header */}
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Delivery Prices</h1>
          <p className="text-sm text-muted-foreground">
            Global delivery prices shared by all landing pages.
          </p>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search wilayas..."
            className="pl-9"
          />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="mx-auto max-w-md py-20">
            <Alert variant="destructive">
              <AlertCircle className="size-4" />
              <AlertTitle>تعذّر تحميل أسعار التوصيل</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
            <Button onClick={fetchPrices} variant="outline" className="mt-4 w-full">
              <Loader2 className="size-4" />
              إعادة المحاولة
            </Button>
          </div>
        ) : (
          <>
            {/* Wilaya list */}
            <div className="flex flex-col gap-2 max-h-[60vh] overflow-y-auto">
              {filtered.map((w) => {
                const edit = edits[w.id];
                const homeVal = edit?.home ?? (w.homePrice !== null ? String(w.homePrice) : "");
                const deskVal = edit?.desk ?? (w.deskPrice !== null ? String(w.deskPrice) : "");
                const isEdited = !!edit;
                return (
                  <div
                    key={w.id}
                    className={cn(
                      "flex items-center gap-3 rounded-xl border bg-card p-3 transition-colors",
                      isEdited && "border-primary/40",
                    )}
                  >
                    <span className="w-10 shrink-0 text-center font-mono text-xs text-muted-foreground">
                      {w.code}
                    </span>
                    <span className="w-32 shrink-0 text-sm font-medium truncate">
                      {w.nameAr ?? w.name}
                    </span>
                    <div className="flex flex-1 items-center gap-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">Home</span>
                        <Input
                          type="number"
                          min="0"
                          value={homeVal}
                          onChange={(e) => handleEdit(w.id, "home", e.target.value)}
                          placeholder="—"
                          className="h-8 w-24"
                        />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">Desk</span>
                        <Input
                          type="number"
                          min="0"
                          value={deskVal}
                          onChange={(e) => handleEdit(w.id, "desk", e.target.value)}
                          placeholder="—"
                          className="h-8 w-24"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Save button */}
            <div className="flex items-center justify-between border-t pt-4">
              <p className="text-sm text-muted-foreground">
                {hasEdits ? `${Object.keys(edits).length} wilaya(s) modified` : "All changes saved"}
              </p>
              <Button onClick={handleSave} disabled={!hasEdits || saving}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : saved ? <Check className="size-4" /> : null}
                {saving ? "Saving..." : saved ? "Saved" : "Save Changes"}
              </Button>
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}
