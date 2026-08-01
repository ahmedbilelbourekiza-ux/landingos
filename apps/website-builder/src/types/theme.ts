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
  // Extended visual tokens
  cardRadius: string;
  buttonRadius: string;
  inputRadius: string;
  cardShadow: string;
  badgeRadius: string;
}

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
  cardRadius: "1rem",
  buttonRadius: "0.75rem",
  inputRadius: "0.5rem",
  cardShadow: "0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)",
  badgeRadius: "0.5rem",
};
