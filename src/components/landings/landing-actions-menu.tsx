"use client";

import {
  Eye,
  Pencil,
  Copy,
  Globe,
  Archive,
  Trash2,
  MoreHorizontal,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { LandingListItem } from "@/lib/landing/mock-landings";

// Row actions menu. All items are wired to nothing yet — this is frontend
// only. The handlers are stubs that log, so the menu is real and clickable
// for UX review, but no data mutates. When CRUD lands, each item calls the
// matching API route; the menu structure stays identical.
//
// The "Publish / Unpublish" label flips based on current status: a DRAFT or
// ARCHIVED page can be published; a PUBLISHED page can be unpublished (back
// to DRAFT). ARCHIVED rows additionally surface "Unarchive" via the same
// item — kept as "Publish" here for simplicity since that's the dominant
// action; the future API can normalize the state machine.
export function LandingActionsMenu({
  landing,
  className,
}: {
  landing: LandingListItem;
  className?: string;
}) {
  const isPublished = landing.status === "PUBLISHED";

  const handle = (action: string) => () => {
    console.log(`[LandingOS] action "${action}" on`, landing.id);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("size-8", className)}
          aria-label={`Actions for ${landing.title}`}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onClick={handle("preview")}>
          <Eye className="mr-2 size-4" />
          Preview
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handle("edit")}>
          <Pencil className="mr-2 size-4" />
          Edit
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handle("duplicate")}>
          <Copy className="mr-2 size-4" />
          Duplicate
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handle(isPublished ? "unpublish" : "publish")}>
          <Globe className="mr-2 size-4" />
          {isPublished ? "Unpublish" : "Publish"}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handle("archive")}>
          <Archive className="mr-2 size-4" />
          Archive
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={handle("delete")}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="mr-2 size-4" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
