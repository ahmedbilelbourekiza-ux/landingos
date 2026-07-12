"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Copy, ExternalLink, Trash2, Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Client-side actions for the order details page. The page itself is a server
// component (reads from Prisma); this component handles the interactive bits:
// back navigation, copy to clipboard, open landing, delete order.

export function OrderDetailsActions({
  orderId,
  phone,
  address,
  landingSlug,
}: {
  orderId: string;
  phone: string;
  address: string;
  landingSlug: string | null;
}) {
  const router = useRouter();
  const [copied, setCopied] = React.useState<string | null>(null);

  const copy = (text: string, label: string) => {
    navigator.clipboard?.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleDelete = async () => {
    if (!confirm("Delete this order? This cannot be undone.")) return;
    await fetch(`/api/orders/${orderId}`, { method: "DELETE" });
    router.push("/dashboard/orders");
  };

  return (
    <div className="flex shrink-0 items-center gap-2">
      {/* Copy Phone — always visible on desktop */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => copy(phone, "phone")}
        className="hidden md:inline-flex"
      >
        {copied === "phone" ? <Check className="size-4" /> : <Copy className="size-4" />}
        <span className="hidden lg:inline">{copied === "phone" ? "Copied" : "Phone"}</span>
      </Button>

      {/* More actions dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <ExternalLink className="size-4" />
            <span className="hidden sm:inline">Actions</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onClick={() => copy(phone, "phone")}>
            <Copy className="mr-2 size-4" />
            Copy Phone
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => copy(address, "address")}>
            <Copy className="mr-2 size-4" />
            Copy Address
          </DropdownMenuItem>
          {landingSlug && (
            <DropdownMenuItem asChild>
              <Link href={`/l/${landingSlug}`} target="_blank">
                <ExternalLink className="mr-2 size-4" />
                Open Landing
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={handleDelete}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="mr-2 size-4" />
            Delete Order
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function BackToOrdersButton() {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8 shrink-0"
      aria-label="Back to Orders"
      asChild
    >
      <Link href="/dashboard/orders">
        <ArrowLeft className="size-4" />
      </Link>
    </Button>
  );
}
