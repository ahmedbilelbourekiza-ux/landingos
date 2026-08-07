"use client";

import * as React from "react";
import { Layers, Plus, AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { type VariantGroup } from "@/lib/landing/mock-landings";
import {
  SectionShell,
  useSectionState,
} from "@/components/landings/edit/section";
import { VariantGroupEditor } from "./variant-group-editor";
import { useBuilderApi } from "@/lib/builder/api-base";

export interface VariantsPreviewValues {
  groups: VariantGroup[];
}

const MAX_GROUPS = 3;
const CURRENCY = "DZD";

export function VariantsSection({
  landingId,
  initialValues,
  onPreviewChange,
}: {
  landingId: string;
  initialValues: VariantsPreviewValues;
  onPreviewChange: (values: VariantsPreviewValues) => void;
}) {
  // Where this editor sends its requests. The legacy dashboard and the
  // console mount the same components against different bases.
  const api = useBuilderApi();
  const [groups, setGroups] = React.useState<VariantGroup[]>(initialValues.groups);

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
        })),
      );
      const res = await fetch(api(`/landings/${landingId}/variants`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: flatVariants }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message || "Save failed");
    },
  });
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

  // --- Save / Cancel ---
  const handleSave = async () => {
    // Validate: every group must have a name and at least one option with a label.
    for (const g of groups) {
      if (!g.name.trim()) {
        setValidationError("Every group must have a name.");
        return;
      }
      if (g.options.length === 0) {
        setValidationError(`"${g.name}" needs at least one option.`);
        return;
      }
      for (const o of g.options) {
        if (!o.label.trim()) {
          setValidationError(`Every option in "${g.name}" needs a label.`);
          return;
        }
      }
    }
    setValidationError(null);
    await section.save();
  };

  const handleCancel = () => {
    setGroups(initialValues.groups);
    setValidationError(null);
    section.reset();
  };

  return (
    <SectionShell
      id="variants"
      title="Variants"
      description="Colors, sizes, and product options."
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
            No variant groups yet. Add one below.
          </div>
        )}

        {groups.map((group, i) => (
          <VariantGroupEditor
            key={group.id}
            group={group}
            index={i}
            currency={CURRENCY}
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
          Add Group
          <span className="ml-auto text-xs text-muted-foreground">
            {groups.length}/{MAX_GROUPS}
          </span>
        </Button>
      </div>
    </SectionShell>
  );
}
