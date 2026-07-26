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

export interface LandingRowActions {
  onPreview: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onPublish: () => void;
  onArchive: () => void;
  onDelete: () => void;
}

export function LandingActionsMenu({
  landing,
  actions,
  className,
}: {
  landing: LandingListItem;
  actions: LandingRowActions;
  className?: string;
}) {
  const isPublished = landing.status === "PUBLISHED";

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
        <DropdownMenuItem onClick={actions.onPreview}>
          <Eye className="mr-2 size-4" />
          Preview
        </DropdownMenuItem>
        <DropdownMenuItem onClick={actions.onEdit}>
          <Pencil className="mr-2 size-4" />
          Edit
        </DropdownMenuItem>
        <DropdownMenuItem onClick={actions.onDuplicate}>
          <Copy className="mr-2 size-4" />
          Duplicate
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={actions.onPublish}>
          <Globe className="mr-2 size-4" />
          {isPublished ? "Unpublish" : "Publish"}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={actions.onArchive}>
          <Archive className="mr-2 size-4" />
          Archive
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={actions.onDelete}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="mr-2 size-4" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
