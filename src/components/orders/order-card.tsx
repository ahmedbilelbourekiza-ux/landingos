import Image from "next/image";

import { formatRelative } from "@/lib/landing/date";
import { OrderStatusBadge } from "./order-status-badge";
import { OrderActionsMenu, type OrderRowActions } from "./order-actions-menu";
import type { OrderListItem } from "./orders-table";

export function OrderCard({
  order,
  onRowActions,
}: {
  order: OrderListItem;
  onRowActions: (order: OrderListItem) => OrderRowActions;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card p-3">
      <div className="relative size-12 shrink-0 overflow-hidden rounded-lg border bg-muted">
        {order.productThumbnail && (
          <Image
            src={order.productThumbnail}
            alt={order.productTitle}
            fill
            sizes="48px"
            className="object-cover"
          />
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-semibold">{order.orderNumber}</span>
          <span className="truncate text-sm font-medium">{order.customerName}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="truncate">{order.productTitle}</span>
          <span className="text-border">·</span>
          <span>{order.wilaya}</span>
          <span className="text-border">·</span>
          <span className="tabular-nums">DA {order.totalPrice.toLocaleString()}</span>
        </div>
        <div className="flex items-center gap-2">
          <OrderStatusBadge status={order.status} />
          <span className="text-[11px] text-muted-foreground">{formatRelative(order.createdAt)}</span>
        </div>
      </div>

      <OrderActionsMenu actions={onRowActions(order)} className="shrink-0" />
    </div>
  );
}
