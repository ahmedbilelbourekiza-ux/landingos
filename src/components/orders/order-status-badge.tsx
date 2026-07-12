import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type OrderStatus = "NEW" | "CONFIRMED" | "PREPARING" | "SHIPPED" | "DELIVERED" | "CANCELLED";

const STYLES: Record<OrderStatus, { className: string; dot: string }> = {
  NEW: {
    className: "border-transparent bg-amber-500/10 text-amber-700 dark:text-amber-400",
    dot: "bg-amber-500",
  },
  CONFIRMED: {
    className: "border-transparent bg-blue-500/10 text-blue-700 dark:text-blue-400",
    dot: "bg-blue-500",
  },
  PREPARING: {
    className: "border-transparent bg-purple-500/10 text-purple-700 dark:text-purple-400",
    dot: "bg-purple-500",
  },
  SHIPPED: {
    className: "border-transparent bg-indigo-500/10 text-indigo-700 dark:text-indigo-400",
    dot: "bg-indigo-500",
  },
  DELIVERED: {
    className: "border-transparent bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    dot: "bg-emerald-500",
  },
  CANCELLED: {
    className: "border-transparent bg-red-500/10 text-red-700 dark:text-red-400",
    dot: "bg-red-500",
  },
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const style = STYLES[status] ?? STYLES.NEW;
  return (
    <Badge variant="outline" className={cn("gap-1.5 font-medium", style.className)}>
      <span className={cn("size-1.5 rounded-full", style.dot)} aria-hidden />
      {status}
    </Badge>
  );
}
