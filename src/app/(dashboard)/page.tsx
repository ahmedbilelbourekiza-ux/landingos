"use client";

import { motion } from "framer-motion";
import { CheckCircle2 } from "lucide-react";

import { siteConfig } from "@/config/site";

// Foundation checkpoint. Confirms the app boots, the dashboard shell renders,
// and theming/animations are wired. Replaced by real dashboard content later.
export default function DashboardPage() {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="flex flex-col items-center text-center"
      >
        <motion.span
          initial={{ scale: 0.85, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.45, ease: "easeOut", delay: 0.05 }}
          className="mb-6 inline-flex size-12 items-center justify-center rounded-xl bg-foreground text-background"
        >
          <CheckCircle2 className="size-6" />
        </motion.span>

        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {siteConfig.name} Ready
        </h1>
        <p className="mt-3 max-w-sm text-sm text-muted-foreground">
          Foundation initialized. The system is online and waiting for the
          first development task.
        </p>

        <div className="mt-8 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-block size-1.5 rounded-full bg-emerald-500" />
          All systems operational
        </div>
      </motion.div>
    </div>
  );
}
