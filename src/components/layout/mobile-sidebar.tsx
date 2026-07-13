"use client";

import * as React from "react";
import { Menu } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Logo } from "@/components/shared/logo";
import { DashboardNav } from "./dashboard-nav";

// Mobile navigation drawer. Mirrors the desktop sidebar's content. Opens on
// demand so it never steals screen space on small viewports.
export function MobileSidebar({
  mustChangePassword = false,
}: {
  mustChangePassword?: boolean;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          aria-label="Open navigation"
        >
          <Menu className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 p-0">
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <SheetDescription className="sr-only">
          Dashboard navigation menu
        </SheetDescription>
        <div className="flex h-16 items-center border-b px-5">
          <Logo />
        </div>
        <div className="px-3 py-4" onClick={() => setOpen(false)}>
          <DashboardNav mustChangePassword={mustChangePassword} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
