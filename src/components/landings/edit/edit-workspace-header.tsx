"use client";

import Link from "next/link";
import { ArrowLeft, Eye, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { LandingStatusBadge } from "@/components/landings/landing-status-badge";
import type { LandingListItem } from "@/lib/landing/mock-landings";

// Sticky top bar of the edit workspace. Holds identity (back + title +
// status) on the left and the primary actions on the right. Preview and
// Save are disabled today — they activate when their features land. The
// header is sticky so these actions stay reachable while scrolling through
// a long page of section cards.
export function EditWorkspaceHeader({ landing }: { landing: LandingListItem }) {
  return (
    <header className="sticky top-16 z-20 flex h-14 items-center justify-between gap-3 border-b bg-background/80 px-4 backdrop-blur-md sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          asChild
          aria-label="Back to Landing Pages"
        >
          <Link href="/dashboard/landings">
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <span className="truncate text-sm font-medium">{landing.title}</span>
        <LandingStatusBadge status={landing.status} />
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Button variant="outline" size="sm" disabled>
          <Eye className="size-4" />
          <span className="hidden sm:inline">Preview</span>
        </Button>
        <Button size="sm" disabled>
          <Save className="size-4" />
          <span className="hidden sm:inline">Save</span>
        </Button>
      </div>
    </header>
  );
}
