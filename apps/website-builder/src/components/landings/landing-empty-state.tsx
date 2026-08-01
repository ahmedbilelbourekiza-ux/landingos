"use client";

import { motion } from "framer-motion";
import { FileText, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";

// Empty state for the landings list. Shown both when there are zero landing
// pages total and when a search/filter returns no results. The message is
// contextual via `onCreate` being optional — when absent (filtered empty),
// the CTA button is hidden and only the illustration + message remain.
export function LandingEmptyState({
  title = "No landing pages yet.",
  message = "Create your first landing page.",
  onCreate,
}: {
  title?: string;
  message?: string;
  onCreate?: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="flex flex-col items-center justify-center gap-5 px-6 py-20 text-center"
    >
      <span
        aria-hidden
        className="grid size-16 place-items-center rounded-2xl border bg-muted/40 text-muted-foreground"
      >
        <FileText className="size-7" strokeWidth={1.5} />
      </span>
      <div className="flex flex-col gap-1.5">
        <h3 className="text-base font-semibold">{title}</h3>
        <p className="max-w-xs text-sm text-muted-foreground">{message}</p>
      </div>
      {onCreate && (
        <Button onClick={onCreate} className="mt-1">
          <Plus className="size-4" />
          Create Landing
        </Button>
      )}
    </motion.div>
  );
}
