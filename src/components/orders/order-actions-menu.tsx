"use client";

import { Eye, Copy, Trash2, MoreHorizontal } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface OrderRowActions {
  onView: () => void;
  onCopyPhone: () => void;
  onDelete: () => void;
}

export function OrderActionsMenu({
  actions,
  className,
}: {
  actions: OrderRowActions;
  className?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("size-8", className)}
          aria-label="Order actions"
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onClick={actions.onView}>
          <Eye className="mr-2 size-4" />
          View Details
        </DropdownMenuItem>
        <DropdownMenuItem onClick={actions.onCopyPhone}>
          <Copy className="mr-2 size-4" />
          Copy Phone
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
