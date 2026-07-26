import { db } from "@/lib/db";
import { ok, serverError } from "@/lib/api-response";

export async function GET() {
  try {
    const themes = await db.landingTheme.findMany({
      orderBy: { sortOrder: "asc" },
      select: {
        id: true, name: true,
        primary: true, primaryForeground: true, accent: true,
        background: true, card: true, text: true, muted: true, border: true,
      },
    });

    // Map DB themes to include extended visual tokens based on the theme
    const data = themes.map((t) => {
      const isLuxury = t.id === "theme-luxury-crimson";
      const isTech = t.id === "theme-modern-tech";
      const isGreen = t.id === "theme-fresh-green";
      const isPink = t.id === "theme-rose-pink";

      return {
        ...t,
        cardRadius: isLuxury ? "1rem" : isTech ? "0.5rem" : "0.875rem",
        buttonRadius: isLuxury ? "0.75rem" : isTech ? "0.375rem" : "0.625rem",
        inputRadius: isLuxury ? "0.5rem" : isTech ? "0.25rem" : "0.5rem",
        cardShadow: isLuxury
          ? "0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)"
          : isTech
            ? "0 1px 2px rgba(0,0,0,0.08)"
            : "0 2px 8px rgba(0,0,0,0.06)",
        badgeRadius: isLuxury ? "0.5rem" : isTech ? "0.25rem" : "0.375rem",
      };
    });

    return ok(data);
  } catch (error) {
    console.error("[api/themes] GET error:", error);
    return serverError("Failed to fetch themes");
  }
}
