"use client";

import * as React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Package,
  FileText,
  TrendingUp,
  Clock,
  Loader2,
  AlertCircle,
  ArrowUpRight,
  ShoppingCart,
  CheckCircle2,
  Truck,
  XCircle,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
} from "recharts";

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

// Dashboard overview. Replaces the foundation checkpoint with a real analytics
// surface: revenue + order KPIs, an orders-over-time chart, an order-status
// breakdown, and recent-order / landing lists. All data is fetched live from
// the existing admin APIs (orders + landings) and aggregated client-side, so
// the numbers always reflect the real database — no static mock numbers.

interface OrderRow {
  id: string;
  orderNumber: string;
  customerName: string;
  phone: string;
  wilaya: string;
  quantity: number;
  totalPrice: number;
  status: string;
  createdAt: string;
  productTitle: string;
  productThumbnail: string;
}

interface LandingRow {
  id: string;
  title: string;
  slug: string;
  price: number;
  status: string;
  updatedAt: string;
}

interface DashboardData {
  totalOrders: number;
  totalRevenue: number;
  newOrders: number;
  deliveredOrders: number;
  publishedLandings: number;
  draftLandings: number;
  chartData: { day: string; orders: number; revenue: number }[];
  statusBreakdown: { name: string; value: number; color: string }[];
  recentOrders: OrderRow[];
  recentLandings: LandingRow[];
}

const STATUS_META: Record<
  string,
  { label: string; color: string; bg: string; text: string }
> = {
  NEW: { label: "New", color: "#3b82f6", bg: "bg-blue-100 dark:bg-blue-950/40", text: "text-blue-700 dark:text-blue-300" },
  CONFIRMED: { label: "Confirmed", color: "#8b5cf6", bg: "bg-violet-100 dark:bg-violet-950/40", text: "text-violet-700 dark:text-violet-300" },
  PREPARING: { label: "Preparing", color: "#f59e0b", bg: "bg-amber-100 dark:bg-amber-950/40", text: "text-amber-700 dark:text-amber-300" },
  SHIPPED: { label: "Shipped", color: "#06b6d4", bg: "bg-cyan-100 dark:bg-cyan-950/40", text: "text-cyan-700 dark:text-cyan-300" },
  DELIVERED: { label: "Delivered", color: "#10b981", bg: "bg-emerald-100 dark:bg-emerald-950/40", text: "text-emerald-700 dark:text-emerald-300" },
  CANCELLED: { label: "Cancelled", color: "#ef4444", bg: "bg-rose-100 dark:bg-rose-950/40", text: "text-rose-700 dark:text-rose-300" },
};

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("fr-DZ", {
    maximumFractionDigits: 0,
  }).format(value);
}

// Build a rolling 14-day series from raw orders.
function buildChart(orders: OrderRow[]) {
  const days: { day: string; orders: number; revenue: number }[] = [];
  const now = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    d.setHours(0, 0, 0, 0);
    const label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    days.push({ day: label, orders: 0, revenue: 0 });
  }
  const startOfWindow = new Date(now);
  startOfWindow.setDate(now.getDate() - 13);
  startOfWindow.setHours(0, 0, 0, 0);

  for (const o of orders) {
    const created = new Date(o.createdAt);
    if (created < startOfWindow) continue;
    const idx = Math.floor(
      (created.getTime() - startOfWindow.getTime()) / (24 * 60 * 60 * 1000),
    );
    if (idx >= 0 && idx < days.length) {
      days[idx].orders += 1;
      if (o.status !== "CANCELLED") {
        days[idx].revenue += o.totalPrice;
      }
    }
  }
  return days;
}

function aggregate(orders: OrderRow[], landings: LandingRow[]): DashboardData {
  const completed = orders.filter((o) => o.status !== "CANCELLED");
  const totalRevenue = completed.reduce((sum, o) => sum + o.totalPrice, 0);

  const breakdown: Record<string, number> = {};
  for (const o of orders) {
    breakdown[o.status] = (breakdown[o.status] ?? 0) + 1;
  }
  const statusBreakdown = Object.entries(breakdown).map(([name, value]) => ({
    name,
    value,
    color: STATUS_META[name]?.color ?? "#94a3b8",
  }));

  return {
    totalOrders: orders.length,
    totalRevenue,
    newOrders: breakdown.NEW ?? 0,
    deliveredOrders: breakdown.DELIVERED ?? 0,
    publishedLandings: landings.filter((l) => l.status === "PUBLISHED").length,
    draftLandings: landings.filter((l) => l.status === "DRAFT").length,
    chartData: buildChart(orders),
    statusBreakdown,
    recentOrders: [...orders]
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
      .slice(0, 6),
    recentLandings: [...landings]
      .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))
      .slice(0, 5),
  };
}

export default function DashboardPage() {
  const [data, setData] = React.useState<DashboardData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch all orders (paginated — grab up to 500 to cover demo volume) and
      // all landings in parallel, then aggregate client-side.
      const [ordersRes, landingsRes] = await Promise.all([
        fetch("/api/orders?limit=500&sort=oldest"),
        fetch("/api/landings"),
      ]);
      const ordersJson = await ordersRes.json();
      const landingsJson = await landingsRes.json();
      if (!ordersJson.success) throw new Error(ordersJson.error?.message);
      if (!landingsJson.success) throw new Error(landingsJson.error?.message);
      setData(
        aggregate(ordersJson.data.orders ?? [], landingsJson.data ?? []),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-md px-4 py-20">
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle>Failed to load dashboard</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <Button onClick={load} variant="outline" className="mt-4 w-full">
          <Loader2 className="size-4" />
          Retry
        </Button>
      </div>
    );
  }

  const kpis = [
    {
      label: "Total Revenue",
      value: `${formatCurrency(data.totalRevenue)} DZD`,
      icon: TrendingUp,
      hint: "From non-cancelled orders",
      accent: "text-emerald-600 dark:text-emerald-400",
      ring: "bg-emerald-500/10",
    },
    {
      label: "Total Orders",
      value: formatCurrency(data.totalOrders),
      icon: ShoppingCart,
      hint: `${data.newOrders} new · ${data.deliveredOrders} delivered`,
      accent: "text-blue-600 dark:text-blue-400",
      ring: "bg-blue-500/10",
    },
    {
      label: "Published Pages",
      value: formatCurrency(data.publishedLandings),
      icon: FileText,
      hint: `${data.draftLandings} draft`,
      accent: "text-violet-600 dark:text-violet-400",
      ring: "bg-violet-500/10",
    },
    {
      label: "Avg. Order Value",
      value: `${formatCurrency(
        data.totalOrders ? Math.round(data.totalRevenue / data.totalOrders) : 0,
      )} DZD`,
      icon: Package,
      hint: "Per completed order",
      accent: "text-amber-600 dark:text-amber-400",
      ring: "bg-amber-500/10",
    },
  ];

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
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Dashboard
          </h1>
          <p className="text-sm text-muted-foreground">
            An overview of your store performance over the last 14 days.
          </p>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {kpis.map((kpi, i) => {
            const Icon = kpi.icon;
            return (
              <motion.div
                key={kpi.label}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: i * 0.05 }}
              >
                <Card className="overflow-hidden">
                  <CardContent className="flex items-start justify-between gap-3">
                    <div className="flex flex-col gap-1">
                      <span className="text-sm text-muted-foreground">
                        {kpi.label}
                      </span>
                      <span className="text-2xl font-semibold tracking-tight">
                        {kpi.value}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {kpi.hint}
                      </span>
                    </div>
                    <span
                      className={cn(
                        "grid size-10 shrink-0 place-items-center rounded-xl",
                        kpi.ring,
                      )}
                    >
                      <Icon className={cn("size-5", kpi.accent)} />
                    </span>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Orders / revenue over time */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Orders & Revenue</CardTitle>
              <CardDescription>Last 14 days</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-72 w-full" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={data.chartData}
                    margin={{ top: 8, right: 8, left: 8, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="ord" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      className="stroke-border"
                    />
                    <XAxis
                      dataKey="day"
                      tickLine={false}
                      axisLine={false}
                      fontSize={11}
                      className="text-muted-foreground"
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      fontSize={11}
                      className="text-muted-foreground"
                      width={40}
                    />
                    <Tooltip
                      contentStyle={{
                        borderRadius: 12,
                        border: "1px solid hsl(var(--border))",
                        background: "hsl(var(--popover))",
                        color: "hsl(var(--popover-foreground))",
                        fontSize: 12,
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="revenue"
                      stroke="#10b981"
                      strokeWidth={2}
                      fill="url(#rev)"
                      name="Revenue (DZD)"
                    />
                    <Area
                      type="monotone"
                      dataKey="orders"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      fill="url(#ord)"
                      name="Orders"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Status breakdown */}
          <Card>
            <CardHeader>
              <CardTitle>Order Status</CardTitle>
              <CardDescription>Distribution across all orders</CardDescription>
            </CardHeader>
            <CardContent>
              {data.statusBreakdown.length === 0 ? (
                <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">
                  No orders yet
                </div>
              ) : (
                <>
                  <div className="h-44 w-full" dir="ltr">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={data.statusBreakdown}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={42}
                          outerRadius={66}
                          paddingAngle={2}
                        >
                          {data.statusBreakdown.map((entry) => (
                            <Cell key={entry.name} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            borderRadius: 12,
                            border: "1px solid hsl(var(--border))",
                            background: "hsl(var(--popover))",
                            color: "hsl(var(--popover-foreground))",
                            fontSize: 12,
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    {data.statusBreakdown.map((s) => {
                      const meta = STATUS_META[s.name];
                      return (
                        <div
                          key={s.name}
                          className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5"
                        >
                          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <span
                              className="size-2 rounded-full"
                              style={{ background: s.color }}
                            />
                            {meta?.label ?? s.name}
                          </span>
                          <span className="text-xs font-semibold">{s.value}</span>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Recent orders + recent landings */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <div>
                <CardTitle>Recent Orders</CardTitle>
                <CardDescription>Latest customer purchases</CardDescription>
              </div>
              <Button asChild variant="ghost" size="sm">
                <Link href="/dashboard/orders">
                  View all
                  <ArrowUpRight className="size-3.5" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-1">
              {data.recentOrders.length === 0 ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                  <Clock className="size-4" />
                  No orders yet
                </div>
              ) : (
                data.recentOrders.map((o) => {
                  const meta = STATUS_META[o.status];
                  return (
                    <Link
                      key={o.id}
                      href={`/dashboard/orders/${o.id}`}
                      className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-accent"
                    >
                      <span
                        className={cn(
                          "grid size-9 shrink-0 place-items-center rounded-lg",
                          meta?.bg ?? "bg-muted",
                        )}
                      >
                        {o.status === "DELIVERED" ? (
                          <CheckCircle2 className={cn("size-4", meta?.text)} />
                        ) : o.status === "CANCELLED" ? (
                          <XCircle className={cn("size-4", meta?.text)} />
                        ) : o.status === "SHIPPED" ? (
                          <Truck className={cn("size-4", meta?.text)} />
                        ) : (
                          <Package className={cn("size-4", meta?.text)} />
                        )}
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-medium">
                          {o.customerName}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {o.productTitle}
                        </span>
                      </div>
                      <div className="flex flex-col items-end gap-0.5">
                        <span className="text-sm font-semibold">
                          {formatCurrency(o.totalPrice)} DZD
                        </span>
                        <Badge
                          variant="secondary"
                          className={cn("h-5 px-1.5 text-[10px]", meta?.bg, meta?.text)}
                        >
                          {meta?.label ?? o.status}
                        </Badge>
                      </div>
                    </Link>
                  );
                })
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <div>
                <CardTitle>Recent Pages</CardTitle>
                <CardDescription>Recently updated landing pages</CardDescription>
              </div>
              <Button asChild variant="ghost" size="sm">
                <Link href="/dashboard/landings">
                  View all
                  <ArrowUpRight className="size-3.5" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-1">
              {data.recentLandings.length === 0 ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                  <FileText className="size-4" />
                  No landing pages yet
                </div>
              ) : (
                data.recentLandings.map((l) => (
                  <Link
                    key={l.id}
                    href={`/dashboard/landings/${l.id}/edit`}
                    className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-accent"
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-violet-500/10">
                      <FileText className="size-4 text-violet-600 dark:text-violet-400" />
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">
                        {l.title}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        /{l.slug}
                      </span>
                    </div>
                    <div className="flex flex-col items-end gap-0.5">
                      <span className="text-sm font-semibold">
                        {formatCurrency(l.price)} DZD
                      </span>
                      <Badge
                        variant="secondary"
                        className={cn(
                          "h-5 px-1.5 text-[10px]",
                          l.status === "PUBLISHED" &&
                            "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
                          l.status === "DRAFT" &&
                            "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
                          l.status === "ARCHIVED" &&
                            "bg-muted text-muted-foreground",
                        )}
                      >
                        {l.status}
                      </Badge>
                    </div>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </motion.div>
    </div>
  );
}
