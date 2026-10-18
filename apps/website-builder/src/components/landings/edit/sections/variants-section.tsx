"use client";

import * as React from "react";
import { Layers, Plus, AlertCircle, ExternalLink, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { type VariantGroup } from "@/lib/landing/mock-landings";
import {
  SectionShell,
  useSectionState,
  refuseIfFailed,
} from "@/components/landings/edit/section";
import { VariantGroupEditor } from "./variant-group-editor";
import { useBuilderApi } from "@/lib/builder/api-base";
import { readLevel, stockKey, type VariantStockContext } from "@/lib/landing/variant-stock";
import type { StockCell } from "./variant-option-row";

export interface VariantsPreviewValues {
  groups: VariantGroup[];
}

const MAX_GROUPS = 3;
const CURRENCY = "DZD";

export function VariantsSection({
  landingId,
  initialValues,
  onPreviewChange,
  stock = { mode: "none" },
}: {
  landingId: string;
  initialValues: VariantsPreviewValues;
  onPreviewChange: (values: VariantsPreviewValues) => void;
  /** VS.1 — the Manager stock context, decided on the server. */
  stock?: VariantStockContext;
}) {
  // Where this editor sends its requests. The legacy dashboard and the
  // console mount the same components against different bases.
  const api = useBuilderApi();
  const t = useTranslations();
  const [groups, setGroups] = React.useState<VariantGroup[]>(initialValues.groups);
  const router = useRouter();

  /* VS.1 — the Manager's levels (refreshed from each save's answer) and the
   * levels being typed, as TEXT keyed by option id. Only a typed level that
   * differs from the stored one is sent; the server turns it into a movement. */
  const [levels, setLevels] = React.useState<Readonly<Record<string, number>>>(
    stock.mode === "linked" ? stock.levels : {},
  );
  // A send-to-Manager re-reads the screen (`router.refresh()`), which hands
  // this section a NEW context; the levels must follow it, not the first one.
  React.useEffect(() => {
    if (stock.mode === "linked") setLevels(stock.levels);
  }, [stock]);
  const [stockText, setStockText] = React.useState<Record<string, string>>({});
  const [sending, setSending] = React.useState(false);
  const [sendError, setSendError] = React.useState(false);

  // Stock per option only exists when the page has ONE group: with two, a
  // level belongs to a combination ("M / Blue"), which no single row holds.
  const stockGroup = stock.mode === "linked" && groups.length === 1 ? groups[0] : null;
  const changedLevels = stockGroup
    ? stockGroup.options.flatMap((o) => {
        const text = stockText[o.id];
        if (text === undefined) return [];
        const level = readLevel(text);
        const key = stockKey(stockGroup.name, o.label);
        return level !== null && key in levels && levels[key] !== level ? [{ value: o.label, level }] : [];
      })
    : [];

  const section = useSectionState({
    save: async () => {
      // Array order IS the display order; the route assigns it from position.
      // `items` is the route's vocabulary (LB.2 — `variants` was silently a
      // 422 on every save).
      const flatVariants = groups.flatMap((g) =>
        g.options.map((opt) => ({
          name: g.name,
          value: opt.label,
          extraPrice: opt.extraPrice,
          // VP.1 — null is "the product price", sent as such.
          price: opt.price ?? null,
        })),
      );
      const res = await fetch(api(`/landings/${landingId}/variants`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: flatVariants }),
      });
      const json = await res.json();
      refuseIfFailed(json);

      // VS.1 — the levels go second, against the options just saved.
      if (changedLevels.length) {
        const sres = await fetch(api(`/landings/${landingId}/stock`), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ levels: changedLevels }),
        });
        const sjson = await sres.json();
        refuseIfFailed(sjson);
        setLevels(sjson.data.levels);
        setStockText({});
      }
    },
  });

  /* VS.1 — send (or re-send) this page to the Manager, then re-read the
   * screen so the server decides the stock context again. Uses the SAVED
   * options: unsaved edits are not what the Manager receives. */
  const sendToManager = async () => {
    setSending(true);
    setSendError(false);
    try {
      const res = await fetch(api("/publish-to-erp"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "one", landingPageId: landingId }),
      });
      const json = await res.json();
      if (!json?.success) throw new Error(String(json?.error?.code ?? ""));
      router.refresh();
    } catch {
      setSendError(true);
    } finally {
      setSending(false);
    }
  };

  const stockCells: Record<string, StockCell> = {};
  if (stockGroup && stock.mode === "linked") {
    for (const o of stockGroup.options) {
      const key = stockKey(stockGroup.name, o.label);
      stockCells[o.id] = !(key in levels)
        ? { state: "missing" }
        : {
            state: stock.canWrite ? "edit" : "readonly",
            text: stockText[o.id] ?? String(levels[key]),
            onChange: (text) => {
              setStockText((prev) => ({ ...prev, [o.id]: text }));
              section.markDirty();
            },
          };
    }
  }
  const someMissing = Object.values(stockCells).some((c) => c.state === "missing");
  const [validationError, setValidationError] = React.useState<string | null>(null);

  // --- Lift preview values to parent ---
  React.useEffect(() => {
    onPreviewChange({ groups });
  }, [groups, onPreviewChange]);

  // --- Group operations ---
  const addGroup = () => {
    if (groups.length >= MAX_GROUPS) return;
    const newGroup: VariantGroup = {
      id: `grp-${Date.now()}`,
      name: "",
      options: [],
    };
    setGroups((prev) => [...prev, newGroup]);
    section.markDirty();
  };

  const updateGroup = (id: string, patch: Partial<VariantGroup>) => {
    setGroups((prev) =>
      prev.map((g) => (g.id === id ? { ...g, ...patch } : g)),
    );
    section.markDirty();
  };

  const deleteGroup = (id: string) => {
    setGroups((prev) => prev.filter((g) => g.id !== id));
    section.markDirty();
  };

  /* VP.1 — own prices live on ONE group (the PUT refuses a second). The first
   * group holding any is the one; every other group's price box is locked
   * and says where the prices are. */
  const pricedGroup =
    groups.find((g) => g.options.some((o) => o.price !== null && o.price !== undefined)) ?? null;

  // --- Save / Cancel ---
  const handleSave = async () => {
    // Validate: every group must have a name and at least one option with a label.
    for (const g of groups) {
      if (!g.name.trim()) {
        setValidationError(t("builder.editor.groupNameRequired"));
        return;
      }
      if (g.options.length === 0) {
        setValidationError(t("builder.editor.groupNeedsOption", { name: g.name }));
        return;
      }
      for (const o of g.options) {
        if (!o.label.trim()) {
          setValidationError(t("builder.editor.optionNeedsLabel", { name: g.name }));
          return;
        }
      }
    }
    setValidationError(null);
    await section.save();
  };

  const handleCancel = () => {
    setGroups(initialValues.groups);
    setStockText({});
    setValidationError(null);
    section.reset();
  };

  return (
    <SectionShell
      id="variants"
      title={t("builder.editor.variants")}
      description={t("builder.editor.variantsDesc")}
      icon={Layers}
      state={section.state}
      onSave={handleSave}
      onCancel={handleCancel}
    >
      <div className="flex flex-col gap-4">
        {validationError && (
          <p
            className="flex items-center gap-1.5 text-xs text-destructive"
            role="alert"
          >
            <AlertCircle className="size-3.5" />
            {validationError}
          </p>
        )}

        {groups.length === 0 && (
          <div className="flex items-center justify-center rounded-xl border border-dashed py-8 text-sm text-muted-foreground">
            {t("builder.editor.noVariantGroups")}
          </div>
        )}

        {groups.length > 0 && (
          <p className="text-xs text-muted-foreground">{t("builder.editor.variantPriceHint")}</p>
        )}

        {/* VS.1 — where this page's stock lives, said in the section where a
            merchant was typing stock into the add-on box. */}
        {groups.length > 0 && stock.mode !== "none" && (
          <div className="rounded-lg border border-dashed p-3 text-xs" data-testid="variant-stock-note">
            {stock.mode === "unlinked" && <p>{t("builder.editor.stockUnlinked")}</p>}
            {stock.mode === "linked" && groups.length === 1 && (
              <p>{t(stock.canWrite ? "builder.editor.stockSingle" : "builder.editor.stockSingleReadOnly")}</p>
            )}
            {stock.mode === "linked" && groups.length > 1 && (
              <p>
                {t("builder.editor.stockMulti")}{" "}
                <a
                  href={`/console/erp/products?variants=${encodeURIComponent(stock.productId)}#variant-editor`}
                  className="inline-flex items-center gap-1 font-medium underline underline-offset-2"
                  data-testid="variant-stock-manager-link"
                >
                  {t("builder.editor.stockOpenManager")}
                  <ExternalLink className="size-3" aria-hidden />
                </a>
              </p>
            )}
            {stock.mode === "linked" && someMissing && <p className="mt-1">{t("builder.editor.stockMissing")}</p>}
            {(stock.mode === "unlinked" || (stock.mode === "linked" && someMissing)) && stock.canSend && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                disabled={sending || section.state.status === "dirty"}
                onClick={() => void sendToManager()}
                data-testid="variant-stock-send"
              >
                <Send className="size-3.5" />
                {t("builder.editor.stockSend")}
              </Button>
            )}
            {(stock.mode === "unlinked" || someMissing) && section.state.status === "dirty" && stock.canSend && (
              <p className="mt-1 text-muted-foreground">{t("builder.editor.stockSaveFirst")}</p>
            )}
            {sendError && <p className="mt-1 text-destructive" role="alert">{t("builder.editor.stockSendFailed")}</p>}
          </div>
        )}

        {groups.map((group, i) => (
          <VariantGroupEditor
            key={group.id}
            group={group}
            index={i}
            currency={CURRENCY}
            priceLockedTo={pricedGroup && pricedGroup.id !== group.id ? pricedGroup.name : null}
            stockCells={stockCells}
            onChange={updateGroup}
            onDelete={deleteGroup}
          />
        ))}

        <Button
          type="button"
          variant="outline"
          onClick={addGroup}
          disabled={groups.length >= MAX_GROUPS}
          className="w-full"
        >
          <Plus className="size-4" />
          {t("builder.editor.addGroup")}
          <span className="ms-auto text-xs text-muted-foreground">
            {groups.length}/{MAX_GROUPS}
          </span>
        </Button>
      </div>
    </SectionShell>
  );
}
