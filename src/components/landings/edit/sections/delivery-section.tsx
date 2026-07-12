"use client";

import * as React from "react";
import { Truck, Search, ChevronDown, ChevronRight, Loader2 } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatPrice } from "@/lib/landing/format";
import {
  SectionShell,
  useSectionState,
} from "@/components/landings/edit/section";

// The preview values the Delivery section lifts to the parent: the array of
// per-wilaya prices. The preview reads this to compute shipping when the
// customer selects a wilaya.
export interface DeliveryPriceEntry {
  wilayaId: number;
  wilayaName: string;
  homePrice: number;
  deskPrice: number | null;
}

export interface DeliveryPreviewValues {
  prices: DeliveryPriceEntry[];
}

interface WilayaData {
  id: number;
  code: string;
  name: string;
  baladias: { id: number; name: string }[];
}

export function DeliverySection({
  landingId,
  initialValues,
  onPreviewChange,
}: {
  landingId: string;
  initialValues: DeliveryPreviewValues;
  onPreviewChange: (values: DeliveryPreviewValues) => void;
}) {
  const [wilayas, setWilayas] = React.useState<WilayaData[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [prices, setPrices] = React.useState<Record<number, { home: string; desk: string }>>(
    () => buildPriceMap(initialValues.prices),
  );
  const [search, setSearch] = React.useState("");
  const [expanded, setExpanded] = React.useState<Set<number>>(new Set());

  const section = useSectionState({
    save: async () => {
      const payload = Object.entries(prices)
        .filter(([, v]) => v.home !== "")
        .map(([wilayaId, v]) => ({
          wilayaId: Number(wilayaId),
          homePrice: Number(v.home) || 0,
          deskPrice: v.desk === "" ? null : Number(v.desk),
        }));
      const res = await fetch(`/api/landings/${landingId}/delivery-prices`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prices: payload }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message || "Save failed");
    },
  });

  // Load wilayas + existing delivery prices on mount
  React.useEffect(() => {
    (async () => {
      try {
        const [wilayasRes, pricesRes] = await Promise.all([
          fetch("/api/wilayas"),
          fetch(`/api/landings/${landingId}/delivery-prices`),
        ]);
        const wilayasJson = await wilayasRes.json();
        const pricesJson = await pricesRes.json();
        if (wilayasJson.success) setWilayas(wilayasJson.data);
        if (pricesJson.success) {
          setPrices(buildPriceMap(pricesJson.data));
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [landingId]);

  // Lift preview values whenever prices change
  React.useEffect(() => {
    const entries: DeliveryPriceEntry[] = Object.entries(prices)
      .filter(([, v]) => v.home !== "")
      .map(([wilayaId, v]) => {
        const w = wilayas.find((w) => w.id === Number(wilayaId));
        return {
          wilayaId: Number(wilayaId),
          wilayaName: w?.name ?? `Wilaya ${wilayaId}`,
          homePrice: Number(v.home) || 0,
          deskPrice: v.desk === "" ? null : Number(v.desk),
        };
      });
    onPreviewChange({ prices: entries });
  }, [prices, wilayas, onPreviewChange]);

  const handlePriceChange = (wilayaId: number, field: "home" | "desk", value: string) => {
    setPrices((prev) => ({
      ...prev,
      [wilayaId]: { ...prev[wilayaId] ?? { home: "", desk: "" }, [field]: value },
    }));
    section.markDirty();
  };

  const toggleExpand = (wilayaId: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(wilayaId)) next.delete(wilayaId);
      else next.add(wilayaId);
      return next;
    });
  };

  const filtered = wilayas.filter((w) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return w.name.toLowerCase().includes(q) || w.code.includes(q);
  });

  return (
    <SectionShell
      id="delivery"
      title="Delivery"
      description="Set delivery prices for each wilaya."
      icon={Truck}
      state={section.state}
      onSave={section.save}
      onCancel={() => {
        setPrices(buildPriceMap(initialValues.prices));
        section.reset();
      }}
    >
      <div className="flex flex-col gap-4">
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
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="flex flex-col gap-1.5 max-h-96 overflow-y-auto">
            {filtered.map((w) => {
              const isOpen = expanded.has(w.id);
              const priceEntry = prices[w.id];
              return (
                <div key={w.id} className="rounded-lg border">
                  <button
                    type="button"
                    onClick={() => toggleExpand(w.id)}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-accent/50"
                  >
                    {isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                    <span className="text-xs font-mono text-muted-foreground">{w.code}</span>
                    <span className="flex-1 text-sm font-medium">{w.name}</span>
                    {priceEntry?.home && (
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {formatPrice(Number(priceEntry.home), "DZD")}
                        {priceEntry.desk && ` / ${formatPrice(Number(priceEntry.desk), "DZD")}`}
                      </span>
                    )}
                  </button>
                  {isOpen && (
                    <div className="flex flex-col gap-3 border-t px-3 py-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="flex flex-col gap-1">
                          <label className="text-xs text-muted-foreground">Home Delivery (DA)</label>
                          <Input
                            type="number"
                            min="0"
                            value={priceEntry?.home ?? ""}
                            onChange={(e) => handlePriceChange(w.id, "home", e.target.value)}
                            placeholder="0"
                            className="h-8"
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-xs text-muted-foreground">Desk Delivery (optional)</label>
                          <Input
                            type="number"
                            min="0"
                            value={priceEntry?.desk ?? ""}
                            onChange={(e) => handlePriceChange(w.id, "desk", e.target.value)}
                            placeholder="0"
                            className="h-8"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </SectionShell>
  );
}

function buildPriceMap(
  entries: DeliveryPriceEntry[],
): Record<number, { home: string; desk: string }> {
  const map: Record<number, { home: string; desk: string }> = {};
  for (const e of entries) {
    map[e.wilayaId] = {
      home: String(e.homePrice ?? ""),
      desk: e.deskPrice !== null ? String(e.deskPrice) : "",
    };
  }
  return map;
}
