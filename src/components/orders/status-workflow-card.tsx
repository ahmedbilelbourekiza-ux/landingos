"use client";

import * as React from "react";
import { Check, X, Loader2, ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { OrderStatusBadge } from "./order-status-badge";

type OrderStatus = "NEW" | "CONFIRMED" | "PREPARING" | "SHIPPED" | "DELIVERED" | "CANCELLED";

interface HistoryEntry {
  id: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  createdAt: string;
}

// Maps each status to the next forward action + button label.
const NEXT_ACTION: Partial<Record<OrderStatus, { to: OrderStatus; label: string }>> = {
  NEW: { to: "CONFIRMED", label: "Confirm Order" },
  CONFIRMED: { to: "PREPARING", label: "Start Preparation" },
  PREPARING: { to: "SHIPPED", label: "Mark as Shipped" },
  SHIPPED: { to: "DELIVERED", label: "Mark as Delivered" },
};

// Cancel is available from these statuses.
const CANCELABLE: OrderStatus[] = ["NEW", "CONFIRMED", "PREPARING", "SHIPPED"];

export function StatusWorkflowCard({
  orderId,
  currentStatus,
  initialHistory,
  onStatusChange,
}: {
  orderId: string;
  currentStatus: OrderStatus;
  initialHistory: HistoryEntry[];
  onStatusChange?: (newStatus: OrderStatus) => void;
}) {
  const [status, setStatus] = React.useState<OrderStatus>(currentStatus);
  const [history, setHistory] = React.useState<HistoryEntry[]>(initialHistory);
  const [transitioning, setTransitioning] = React.useState(false);
  const [pendingAction, setPendingAction] = React.useState<{ to: OrderStatus; label: string } | null>(null);

  const nextAction = NEXT_ACTION[status];
  const canCancel = CANCELABLE.includes(status);

  const handleConfirm = async () => {
    if (!pendingAction) return;
    setTransitioning(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toStatus: pendingAction.to }),
      });
      const json = await res.json();
      if (json.success) {
        setStatus(json.data.order.status);
        setHistory(json.data.history);
        onStatusChange?.(json.data.order.status);
      }
    } finally {
      setTransitioning(false);
      setPendingAction(null);
    }
  };

  return (
    <div className="rounded-2xl border bg-card shadow-sm">
      <header className="border-b px-5 py-3">
        <h2 className="text-sm font-semibold">Status Workflow</h2>
      </header>
      <div className="flex flex-col gap-4 px-5 py-4">
        {/* Current status */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Current Status</span>
          <OrderStatusBadge status={status} />
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2 border-t pt-3">
          {nextAction && (
            <Button
              onClick={() => setPendingAction(nextAction)}
              disabled={transitioning}
              className="w-full"
            >
              {transitioning && <Loader2 className="size-4 animate-spin" />}
              {nextAction.label}
            </Button>
          )}
          {canCancel && (
            <Button
              variant="outline"
              onClick={() => setPendingAction({ to: "CANCELLED", label: "Cancel Order" })}
              disabled={transitioning}
              className="w-full text-destructive hover:text-destructive"
            >
              <X className="size-4" />
              Cancel Order
            </Button>
          )}
          {!nextAction && !canCancel && (
            <p className="py-2 text-center text-sm text-muted-foreground">
              {status === "DELIVERED" ? "Order delivered — no further actions." : "Order cancelled — no further actions."}
            </p>
          )}
        </div>

        {/* History timeline */}
        <div className="border-t pt-3">
          <span className="text-xs font-medium text-muted-foreground">Status History</span>
          <div className="mt-2 flex flex-col gap-0">
            {history.map((entry, i) => (
              <div key={entry.id} className="flex flex-col gap-0">
                <div className="flex items-center gap-2 py-1">
                  <span className="grid size-6 place-items-center rounded-full border bg-muted">
                    {entry.fromStatus === null ? (
                      <span className="text-[10px]">●</span>
                    ) : (
                      <Check className="size-3" />
                    )}
                  </span>
                  <span className="text-sm font-medium">{entry.toStatus}</span>
                  <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                    {new Date(entry.createdAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                {i < history.length - 1 && (
                  <div className="ml-3 h-4 w-px bg-border" />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Confirmation dialog */}
      <Dialog open={!!pendingAction} onOpenChange={(open) => !open && setPendingAction(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {pendingAction?.to === "CANCELLED"
                ? "Cancel this order?"
                : `Mark this order as ${pendingAction?.to}?`}
            </DialogTitle>
            <DialogDescription>
              {pendingAction?.to === "CANCELLED"
                ? "This will cancel the order. The customer will need to be notified."
                : `The order status will change from ${status} to ${pendingAction?.to}.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="ghost" onClick={() => setPendingAction(null)} disabled={transitioning}>
              Cancel
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={transitioning}
              variant={pendingAction?.to === "CANCELLED" ? "destructive" : "default"}
            >
              {transitioning && <Loader2 className="size-4 animate-spin" />}
              {pendingAction?.to === "CANCELLED" ? "Yes, Cancel Order" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
