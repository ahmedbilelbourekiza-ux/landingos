import {
  Sparkles,
  Droplet,
  ShieldCheck,
  Leaf,
  Truck,
  Wallet,
  Package,
  Award,
  type LucideIcon,
} from "lucide-react";

// Maps the string icon keys stored in landing data (features, benefits) to
// actual lucide components. Keeping this in one place means the data layer
// stays serializable (plain strings, safe for Prisma/JSON) while the render
// layer resolves them to components. Add new keys here as sections grow.
const ICONS: Record<string, LucideIcon> = {
  sparkles: Sparkles,
  droplet: Droplet,
  shield: ShieldCheck,
  leaf: Leaf,
  truck: Truck,
  wallet: Wallet,
  package: Package,
  award: Award,
};

export function resolveIcon(name: string): LucideIcon {
  return ICONS[name] ?? Sparkles;
}
