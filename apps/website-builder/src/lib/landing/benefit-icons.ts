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

/* LB.13 — the picker offered its options as raw lucide keys.
 *
 * A merchant choosing a badge read "shield-check" and "refresh-ccw" in an
 * Arabic console, which is the M-04 complaint in its purest form: an
 * identifier on screen where a name belongs. The names describe WHAT THE ICON
 * DEPICTS rather than what it might mean — "Droplet", not "Freshness" — because
 * what a droplet stands for is the merchant's decision, not the editor's.
 *
 * Keyed off BENEFIT_ICONS so the two cannot drift: a key added there without a
 * name here is caught by the editor-i18n test rather than shipping as a blank
 * option. */
export const BENEFIT_ICON_NAME_KEYS: Record<keyof typeof BENEFIT_ICONS & string, string> = {
  truck: "builder.editor.iconTruck",
  wallet: "builder.editor.iconWallet",
  "shield-check": "builder.editor.iconShieldCheck",
  award: "builder.editor.iconAward",
  sparkles: "builder.editor.iconSparkles",
  droplet: "builder.editor.iconDroplet",
  star: "builder.editor.iconStar",
  gift: "builder.editor.iconGift",
  clock: "builder.editor.iconClock",
  "thumbs-up": "builder.editor.iconThumbsUp",
  package: "builder.editor.iconPackage",
  "refresh-ccw": "builder.editor.iconRefreshCcw",
  "badge-check": "builder.editor.iconBadgeCheck",
  heart: "builder.editor.iconHeart",
  leaf: "builder.editor.iconLeaf",
  zap: "builder.editor.iconZap",
};
