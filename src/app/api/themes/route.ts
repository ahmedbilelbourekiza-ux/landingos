import { db } from "@/lib/db";
import { ok, serverError } from "@/lib/api-response";

// GET /api/themes — list all available themes for the selector UI
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

    return ok(themes);
  } catch (error) {
    console.error("[api/themes] GET error:", error);
    return serverError("Failed to fetch themes");
  }
}
