"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type SortValue = "newest" | "oldest" | "updated";

const OPTIONS: { value: SortValue; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "updated", label: "Recently Updated" },
];

// Sort selector. Compact trigger with an arrow icon; the label prefix
// ("Sort:") is visually hidden from sighted users but kept in the accessible
// name so screen readers announce context.
export function SortSelect({
  value,
  onChange,
}: {
  value: SortValue;
  onChange: (value: SortValue) => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as SortValue)}>
      <SelectTrigger className="h-9 w-[170px]" aria-label="Sort landing pages">
        <span className="text-muted-foreground">Sort:</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {OPTIONS.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
