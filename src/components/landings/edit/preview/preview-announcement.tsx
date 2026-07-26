"use client";

import { motion } from "framer-motion";
import type { PreviewState } from "@/types/preview";

// Announcement bar. Shows the announcement text on a solid bar, or an empty
// strip when no announcement is set.
export function PreviewAnnouncement({ preview }: { preview: PreviewState }) {
  const { announcement } = preview.general;
  if (announcement) {
    return (
      <div className="bg-foreground px-3 py-1.5 text-center text-[10px] font-medium text-background">
        <span className="line-clamp-1">{announcement}</span>
      </div>
    );
  }
  return <div className="h-7 bg-muted/40" />;
}
