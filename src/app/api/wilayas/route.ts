import { db } from "@/lib/db";
import { ok, serverError } from "@/lib/api-response";

// GET /api/wilayas — returns all 58 wilayas with their baladias. Used by
// the Delivery section and the order form's wilaya/baladia selectors.
export async function GET() {
  try {
    const wilayas = await db.wilaya.findMany({
      include: {
        baladias: { orderBy: { name: "asc" } },
      },
      orderBy: { code: "asc" },
    });

    const data = wilayas.map((w) => ({
      id: w.id,
      code: w.code,
      name: w.name,
      nameAr: w.nameAr,
      baladias: w.baladias.map((b) => ({
        id: b.id,
        name: b.name,
        nameAr: b.nameAr,
      })),
    }));

    return ok(data);
  } catch (error) {
    console.error("[api/wilayas] GET error:", error);
    return serverError("Failed to fetch wilayas");
  }
}
