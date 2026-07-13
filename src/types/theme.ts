// Semantic theme tokens used by the LandingTemplate. Components reference
// these via CSS variables — never raw hex values.
export interface LandingThemeData {
  id: string;
  name: string;
  primary: string;
  primaryForeground: string;
  accent: string;
  background: string;
  card: string;
  text: string;
  muted: string;
  border: string;
}

// Fallback theme (Luxury Crimson) used when a landing has no theme assigned.
export const DEFAULT_THEME: LandingThemeData = {
  id: "default",
  name: "Luxury Crimson",
  primary: "#991B1B",
  primaryForeground: "#FFFFFF",
  accent: "#D4AF37",
  background: "#FAF9F6",
  card: "#FFFFFF",
  text: "#111827",
  muted: "#F3F4F6",
  border: "#E5E7EB",
};
