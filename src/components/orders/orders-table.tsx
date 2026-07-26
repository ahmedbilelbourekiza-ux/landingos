import Image from "next/image";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatPrice } from "@/lib/landing/format";
import { formatRelative } from "@/lib/landing/date";
import { OrderStatusBadge } from "./order-status-badge";
import { OrderActionsMenu, type OrderRowActions } from "./order-actions-menu";

export interface OrderListItem {
  id: string;
  orderNumber: string;
  customerName: string;
  phone: string;
  wilaya: string;
  quantity: number;
  totalPrice: number;
  status: "NEW" | "CONFIRMED" | "PREPARING" | "SHIPPED" | "DELIVERED" | "CANCELLED";
  createdAt: string;
  productTitle: string;
  productThumbnail: string;
}

export function OrdersTable({
  orders,
  onRowActions,
}: {
  orders: OrderListItem[];
  onRowActions: (order: OrderListItem) => OrderRowActions;
}) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-[20%]">Order #</TableHead>
            <TableHead className="w-[22%]">Product</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead className="hidden md:table-cell">Phone</TableHead>
            <TableHead className="hidden lg:table-cell">Wilaya</TableHead>
            <TableHead className="hidden sm:table-cell">Qty</TableHead>
            <TableHead>Total</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden md:table-cell">Date</TableHead>
            <TableHead className="w-12 text-right">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map((order) => (
            <TableRow key={order.id}>
              <TableCell>
                <span className="font-mono text-xs font-semibold">{order.orderNumber}</span>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <div className="relative size-9 shrink-0 overflow-hidden rounded-lg border bg-muted">
                    {order.productThumbnail && (
                      <Image
                        src={order.productThumbnail}
                        alt={order.productTitle}
                        fill
                        sizes="36px"
                        className="object-cover"
                      />
                    )}
                  </div>
                  <span className="truncate text-sm font-medium">{order.productTitle}</span>
                </div>
              </TableCell>
              <TableCell>
                <span className="text-sm font-medium">{order.customerName}</span>
              </TableCell>
              <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                {order.phone}
              </TableCell>
              <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                {order.wilaya}
              </TableCell>
              <TableCell className="hidden tabular-nums sm:table-cell">{order.quantity}</TableCell>
              <TableCell className="tabular-nums">DA {order.totalPrice.toLocaleString()}</TableCell>
              <TableCell>
                <OrderStatusBadge status={order.status} />
              </TableCell>
              <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                {formatRelative(order.createdAt)}
              </TableCell>
              <TableCell className="text-right">
                <OrderActionsMenu actions={onRowActions(order)} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
