"use client";

import * as React from "react";
import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

// The reusable shell for every edit section. Each section in the workspace
// is one of these cards — same structure, same spacing, same anchor id for
// scroll navigation. The `children` slot is where future editing forms plug
// in; today every card renders <SectionComingSoon /> via the default.
//
// The card is intentionally dumb: it knows nothing about which section it is
// beyond its id/title/description. All editing state will live in the
// section-specific component passed as children, keeping this shell stable
// forever.
export function EditSectionCard({
  id,
  title,
  description,
  icon: Icon,
  children,
  className,
}: {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.section
      id={id}
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className={cn(
        "scroll-mt-24 rounded-2xl border bg-card shadow-sm",
        className,
      )}
      aria-labelledby={`${id}-title`}
    >
      <header className="flex items-start gap-3 border-b px-6 py-5">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg border bg-muted/40 text-muted-foreground">
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="flex flex-col gap-0.5">
          <h2 id={`${id}-title`} className="text-base font-semibold tracking-tight">
            {title}
          </h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </header>
      <div className="px-6 py-8">{children}</div>
    </motion.section>
  );
}
