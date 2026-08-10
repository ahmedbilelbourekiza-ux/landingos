import {
  Award,
  BadgeCheck,
  Clock,
  Droplet,
  Gift,
  Heart,
  Leaf,
  Package,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
  Star,
  ThumbsUp,
  Truck,
  Wallet,
  Zap,
  type LucideIcon,
} from "lucide-react";

/* The curated benefit-icon set — LB.12.
 *
 * ONE map shared by the editor's picker and the storefront's renderer, so the
 * picker cannot offer an icon the page cannot draw and a stored key that
 * left the set (or came from an import) degrades to the default instead of a
 * blank. Keys are the lucide kebab names, matching what the legacy mock data
 * already stored ("sparkles", "droplet"). */
export const BENEFIT_ICONS: Record<string, LucideIcon> = {
  truck: Truck,
  wallet: Wallet,
  "shield-check": ShieldCheck,
  award: Award,
  sparkles: Sparkles,
  droplet: Droplet,
  star: Star,
  gift: Gift,
  clock: Clock,
  "thumbs-up": ThumbsUp,
  package: Package,
  "refresh-ccw": RefreshCcw,
  "badge-check": BadgeCheck,
  heart: Heart,
  leaf: Leaf,
  zap: Zap,
};

export const DEFAULT_BENEFIT_ICON = "badge-check";
