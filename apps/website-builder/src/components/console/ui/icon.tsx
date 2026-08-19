import {
  BarChart3, BellRing, Box, Briefcase, Calculator, ChevronDown, ChevronsUpDown,
  ClipboardList, FileText, FolderOpen, LayoutDashboard, LayoutTemplate, Layers,
  LineChart, Package, Palette, PhoneCall, PhoneMissed, Route, Settings, Sparkles,
  Store, Tag, Truck, UserCog, Users, CircleDashed,
  type LucideIcon,
} from "lucide-react";

/* =============================================================================
 * The shell's icon registry — UI.9.
 *
 * `ProductNavItem.icon` has carried a lucide name since the contract was
 * written, its own comment says "resolved by the shell's icon registry (lucide
 * today)", and **no such registry existed**. `console-shell.tsx` computed the
 * name, passed it to `ConsoleNav`, and `ConsoleNav` destructured it and
 * rendered only the title — so the ERP's fifteen navigation items were fifteen
 * identical lines of text and every declared icon in both manifests was dead
 * data. This file is the missing half.
 *
 * WHY A MAP AND NOT A DYNAMIC IMPORT. `lucide-react` exports ~1,500 components;
 * reaching one by string at runtime either pulls the whole library into the
 * bundle or needs a lazy boundary on a navigation item, which is a spinner in a
 * sidebar. An explicit map is one line per icon and ships exactly the icons
 * that are declared.
 *
 * WHY IT FALLS BACK RATHER THAN THROWING. A manifest is a product's own file
 * and may name an icon this shell has not imported yet. A missing icon must
 * degrade to a neutral mark — the item still navigates, which is what it is for
 * — and never take the console down. That is D-LP.2's rule pointed the other
 * way: refusing is right when the alternative is INVENTING something (a
 * fabricated tracking number); here there is nothing to invent and the label
 * beside it already says what the item is.
 * ========================================================================== */

const ICONS: Record<string, LucideIcon> = {
  "bar-chart-3": BarChart3,
  "bell-ring": BellRing,
  box: Box,
  briefcase: Briefcase,
  calculator: Calculator,
  "clipboard-list": ClipboardList,
  "file-text": FileText,
  "folder-open": FolderOpen,
  "layout-dashboard": LayoutDashboard,
  "layout-template": LayoutTemplate,
  layers: Layers,
  "line-chart": LineChart,
  package: Package,
  palette: Palette,
  "phone-call": PhoneCall,
  "phone-missed": PhoneMissed,
  route: Route,
  settings: Settings,
  sparkles: Sparkles,
  store: Store,
  tag: Tag,
  truck: Truck,
  "user-cog": UserCog,
  users: Users,
};

export function NavIcon({
  name,
  className = "size-4 shrink-0",
}: {
  readonly name: string;
  readonly className?: string;
}) {
  const Icon = ICONS[name] ?? CircleDashed;
  // Always decorative: every place this renders has a visible text label beside
  // it. An icon announced next to the word it illustrates is the label read
  // twice.
  return <Icon aria-hidden="true" className={className} />;
}

export { ChevronDown, ChevronsUpDown };
