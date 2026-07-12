"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Package, Search, X, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { OrdersTable, type OrderListItem } from "@/components/orders/orders-table";
import { OrderCard } from "@/components/orders/order-card";
import { OrderStatusBadge } from "@/components/orders/order-status-badge";

type StatusFilter = "ALL" | "NEW" | "CONFIRMED" | "PREPARING" | "SHIPPED" | "DELIVERED" | "CANCELLED";

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "NEW", label: "New" },
  { value: "CONFIRMED", label: "Confirmed" },
  { value: "PREPARING", label: "Preparing" },
  { value: "SHIPPED", label: "Shipped" },
  { value: "DELIVERED", label: "Delivered" },
  { value: "CANCELLED", label: "Cancelled" },
];

interface OrdersResponse {
  orders: OrderListItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export default function OrdersPage() {
  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState<StatusFilter>("ALL");
  const [sort, setSort] = React.useState("newest");
  const [page, setPage] = React.useState(1);
  const [data, setData] = React.useState<OrdersResponse | null>(null);
  const [loading, setLoading] = React.useState(true);

  // Debounce search
  const debouncedSearch = React.useDeferredValue(search);

  React.useEffect(() => {
    setPage(1);
  }, [debouncedSearch, status, sort]);

  React.useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      limit: "20",
      sort,
      status,
    });
    if (debouncedSearch) params.set("search", debouncedSearch);

    fetch(`/api/orders?${params}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setData(json.data);
      })
      .finally(() => setLoading(false));
  }, [page, sort, status, debouncedSearch]);

  const handleDelete = async (order: OrderListItem) => {
    if (!confirm(`Delete order ${order.orderNumber}?`)) return;
    await fetch(`/api/orders/${order.id}`, { method: "DELETE" });
    // Refetch
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: "20", sort, status });
    if (debouncedSearch) params.set("search", debouncedSearch);
    const res = await fetch(`/api/orders?${params}`);
    const json = await res.json();
    if (json.success) setData(json.data);
    setLoading(false);
  };

  const handleCopyPhone = (order: OrderListItem) => {
    navigator.clipboard?.writeText(order.phone);
  };

  const handleRowActions = (order: OrderListItem) => ({
    onView: () => console.log("[Orders] view", order.id),
    onCopyPhone: () => handleCopyPhone(order),
    onDelete: () => handleDelete(order),
  });

  const orders = data?.orders ?? [];
  const isEmpty = !loading && orders.length === 0;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="flex flex-col gap-6"
      >
        {/* Header */}
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Orders</h1>
          <p className="text-sm text-muted-foreground">
            Manage incoming customer orders.
          </p>
        </div>

        {/* Toolbar */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {/* Status tabs */}
          <div className="flex items-center gap-1 overflow-x-auto" role="tablist" aria-label="Filter orders by status">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.value}
                role="tab"
                aria-selected={status === tab.value}
                onClick={() => setStatus(tab.value)}
                className={cn(
                  "relative shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  status === tab.value ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
                {status === tab.value && (
                  <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-foreground" />
                )}
              </button>
            ))}
          </div>

          {/* Search + Sort */}
          <div className="flex items-center gap-2">
            <div className="relative w-full sm:w-56">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search orders..."
                aria-label="Search orders"
                className="h-9 pl-9 pr-9"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  aria-label="Clear search"
                  className="absolute right-2.5 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
            <Select value={sort} onValueChange={setSort}>
              <SelectTrigger className="h-9 w-[130px]" aria-label="Sort orders">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest</SelectItem>
                <SelectItem value="oldest">Oldest</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : isEmpty ? (
          <div className="flex flex-col items-center justify-center gap-5 py-20 text-center">
            <span aria-hidden className="grid size-16 place-items-center rounded-2xl border bg-muted/40 text-muted-foreground">
              <Package className="size-7" strokeWidth={1.5} />
            </span>
            <div className="flex flex-col gap-1.5">
              <h3 className="text-base font-semibold">No orders yet.</h3>
              <p className="max-w-xs text-sm text-muted-foreground">
                {search || status !== "ALL"
                  ? "Try a different search or filter."
                  : "Orders will appear here when customers place them."}
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden lg:block">
              <OrdersTable orders={orders} onRowActions={handleRowActions} />
            </div>
            {/* Mobile cards */}
            <div className="flex flex-col gap-2 lg:hidden">
              {orders.map((order) => (
                <OrderCard key={order.id} order={order} onRowActions={handleRowActions} />
              ))}
            </div>

            {/* Pagination */}
            {data && data.totalPages > 1 && (
              <div className="flex items-center justify-between border-t pt-4">
                <p className="text-sm text-muted-foreground">
                  Page {data.page} of {data.totalPages} · {data.total} orders
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                  >
                    <ChevronLeft className="size-4" />
                    Prev
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
                    disabled={page >= data.totalPages}
                  >
                    Next
                    <ChevronRight className="size-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </motion.div>
    </div>
  );
}
