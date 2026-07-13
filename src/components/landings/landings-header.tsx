"use client";

import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";

// Page header for the landings management section. Title + subtitle on the
// left, primary action on the right. The "+ New Landing" button navigates
// to the new-page route (wired by the parent page).
export function LandingsHeader({
  onCreate,
}: {
  onCreate: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Landing Pages
        </h1>
        <p className="text-sm text-muted-foreground">
          Manage all product landing pages.
        </p>
      </div>
      <Button onClick={onCreate} className="self-start sm:self-auto">
        <Plus className="size-4" />
        New Landing
      </Button>
    </div>
  );
}
