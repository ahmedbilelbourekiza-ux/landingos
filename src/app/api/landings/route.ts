import { NextRequest } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { ok, fail, fromZodError, serverError } from "@/lib/api-response";

const createSchema = z.object({
  title: z.string().min(2, "Title must be at least 2 characters"),
  slug: z
    .string()
    .min(2)
    .regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers, and hyphens only"),
  price: z.coerce.number().positive("Price must be greater than 0"),
  oldPrice: z.coerce.number().positive().optional(),
  currency: z.string().default("DZD"),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).default("DRAFT"),
});

// GET /api/landings — list all landing pages (lightweight, for the CMS table)
export async function GET() {
  try {
    const pages = await db.landingPage.findMany({
      select: {
        id: true,
        title: true,
        slug: true,
        price: true,
        currency: true,
        status: true,
        updatedAt: true,
        media: { take: 1, orderBy: { displayOrder: "asc" }, select: { url: true } },
      },
      orderBy: { updatedAt: "desc" },
    });

    const data = pages.map((p) => ({
      id: p.id,
      title: p.title,
      slug: p.slug,
      price: p.price.toNumber(),
      currency: p.currency,
      status: p.status,
      thumbnailUrl: p.media[0]?.url ?? null,
      updatedAt: p.updatedAt.toISOString(),
    }));

    return ok(data);
  } catch (error) {
    console.error("[api/landings] GET error:", error);
    return serverError("Failed to fetch landing pages");
  }
}

// POST /api/landings — create a new landing page
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return fromZodError(parsed.error);

    // Check slug uniqueness
    const existing = await db.landingPage.findUnique({
      where: { slug: parsed.data.slug },
      select: { id: true },
    });
    if (existing) {
      return fail("SLUG_TAKEN", "This slug is already taken", 409);
    }

    const page = await db.landingPage.create({
      data: {
        title: parsed.data.title,
        slug: parsed.data.slug,
        price: parsed.data.price,
        oldPrice: parsed.data.oldPrice ?? null,
        currency: parsed.data.currency,
        status: parsed.data.status,
        published: parsed.data.status === "PUBLISHED",
        setting: { create: {} },
      },
      select: { id: true },
    });

    return ok({ id: page.id }, 201);
  } catch (error) {
    console.error("[api/landings] POST error:", error);
    return serverError("Failed to create landing page");
  }
}
