import { db } from "../src/lib/db";

const THEMES = [
  {
    id: "theme-luxury-crimson",
    name: "Luxury Crimson",
    primary: "#991B1B",
    primaryForeground: "#FFFFFF",
    accent: "#D4AF37",
    background: "#FAF9F6",
    card: "#FFFFFF",
    text: "#111827",
    muted: "#F3F4F6",
    border: "#E5E7EB",
    isBuiltIn: true,
    sortOrder: 0,
  },
  {
    id: "theme-midnight-black",
    name: "Midnight Black",
    primary: "#111827",
    primaryForeground: "#FFFFFF",
    accent: "#F59E0B",
    background: "#FFFFFF",
    card: "#FFFFFF",
    text: "#111827",
    muted: "#F3F4F6",
    border: "#E5E7EB",
    isBuiltIn: true,
    sortOrder: 1,
  },
  {
    id: "theme-modern-tech",
    name: "Modern Tech",
    primary: "#DC2626",
    primaryForeground: "#FFFFFF",
    accent: "#1F2937",
    background: "#FFFFFF",
    card: "#FFFFFF",
    text: "#111827",
    muted: "#F3F4F6",
    border: "#E5E7EB",
    isBuiltIn: true,
    sortOrder: 2,
  },
  {
    id: "theme-fresh-green",
    name: "Fresh Green",
    primary: "#15803D",
    primaryForeground: "#FFFFFF",
    accent: "#FACC15",
    background: "#F8FFF8",
    card: "#FFFFFF",
    text: "#111827",
    muted: "#F0FDF4",
    border: "#DCFCE7",
    isBuiltIn: true,
    sortOrder: 3,
  },
  {
    id: "theme-rose-pink",
    name: "Rose Pink",
    primary: "#DB2777",
    primaryForeground: "#FFFFFF",
    accent: "#F472B6",
    background: "#FFF7FB",
    card: "#FFFFFF",
    text: "#111827",
    muted: "#FDF2F8",
    border: "#FCE7F3",
    isBuiltIn: true,
    sortOrder: 4,
  },
];

async function main() {
  console.log("Seeding themes...");
  for (const t of THEMES) {
    await db.landingTheme.upsert({
      where: { id: t.id },
      create: t,
      update: t,
    });
  }
  const count = await db.landingTheme.count();
  console.log(`Done. ${count} themes seeded.`);
}

main().catch(console.error).finally(() => db.$disconnect());
