"use client";

import * as React from "react";
import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { SectionHeader } from "./section-header";
import { SectionFooter } from "./section-footer";
import type { SectionState } from "./use-section-state";

// The active-editing shell for a section. Wraps the section's form fields
// (passed as children) in a card with a status-aware header and a footer
// that shows Cancel/Save only when there are unsaved changes.
//
// This is the shell every real section will use once its fields land. The
// section owns its own state via useSectionState() and passes it down; the
// shell is purely presentational. A section looks like:
//
//   const section = useSectionState({ save: async () => {...} });
//   return (
//     <SectionShell
//       id="pricing" title="Pricing" description="..." icon={Tag}
//       state={section.state}
//       onSave={section.save} onCancel={section.reset}
//     >
//       <PricingFields onChange={section.markDirty} />
//     </SectionShell>
//   );
export function SectionShell({
  id,
  title,
  description,
  icon,
  state,
  onSave,
  onCancel,
  children,
  className,
}: {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  state: SectionState;
  onSave: () => void;
  onCancel: () => void;
  children: React.ReactNode;
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
        "scroll-mt-24 overflow-hidden rounded-2xl border bg-card shadow-sm",
        className,
      )}
      aria-labelledby={`${id}-title`}
    >
      <SectionHeader
        id={id}
        title={title}
        description={description}
        icon={icon}
        status={state.status}
      />
      <div className="px-6 py-6">{children}</div>
      <SectionFooter state={state} onSave={onSave} onCancel={onCancel} />
    </motion.section>
  );
}
