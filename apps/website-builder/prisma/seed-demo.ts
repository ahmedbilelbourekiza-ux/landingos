// Demo-data enrichment seed.
//
// This populates the store with realistic sample content so the live preview
// looks and behaves like a real, in-use SaaS product: categories, multiple
// rich landing pages (media + variants + reviews + features + FAQs), global
// delivery prices for checkout, and a spread of orders across all statuses
// with status-history audit trails. It also resets the admin password to the
// documented default (admin / admin123) with mustChangePassword=false so the
// preview is explorable immediately without the force-change lock.
//
// Idempotent: every create is gated by an existence check, so re-running is
// safe. Run with:  npx tsx prisma/seed-demo.ts
//
// All prices are in Algerian Dinar (DZD). Arabic strings are used where the
// public storefront renders Arabic (announcement, button text, order snapshots).

import { db } from "../src/lib/db";
import bcrypt from "bcryptjs";

// ---------------------------------------------------------------------------
// 1. Admin — ensure the account exists with a usable password. Respects the
//    ADMIN_USERNAME / ADMIN_PASSWORD env vars (same as seed-admin.ts) so a
//    public deploy isn't forced back to admin123. On a fresh DB this creates
//    the admin; on an existing DB it leaves credentials untouched.
// ---------------------------------------------------------------------------
async function seedAdmin() {
  const username = process.env.ADMIN_USERNAME || "admin";
  const password = process.env.ADMIN_PASSWORD || "admin123";
  const existing = await db.admin.findUnique({ where: { username } });
  if (existing) {
    console.log(`  ✓ Admin '${username}' already exists — credentials left as-is`);
    return;
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const mustChange =
    process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD !== "admin123"
      ? false
      : false; // demo deploy: don't force a change, it's a fresh demo account
  await db.admin.create({
    data: { username, passwordHash, mustChangePassword: mustChange },
  });
  console.log(
    `  ✓ Admin created: username=${username} password=${"*".repeat(password.length)}`,
  );
}

// ---------------------------------------------------------------------------
// 2. Global delivery prices — covers major wilayas so checkout succeeds.
//    IDs 16 (Alger), 31 (Oran), 06 (Béjaïa), 25 (Constantine), 35 (Boumerdès).
// ---------------------------------------------------------------------------
const MAJOR_WILAYA_IDS = [16, 31, 6, 25, 35, 9, 19, 44, 5, 23, 2, 13];

async function seedDeliveryPrices() {
  let count = 0;
  for (const wilayaId of MAJOR_WILAYA_IDS) {
    const exists = await db.globalDeliveryPrice.findUnique({ where: { wilayaId } });
    if (exists) {
      count++;
      continue;
    }
    await db.globalDeliveryPrice.create({
      data: {
        wilayaId,
        homePrice: 600,
        deskPrice: 400,
      },
    });
    count++;
  }
  console.log(`  ✓ ${count} global delivery prices present`);
}

// ---------------------------------------------------------------------------
// 3. Categories.
// ---------------------------------------------------------------------------
type CategorySeed = {
  id: string;
  name: string;
  slug: string;
  description: string;
  icon: string;
  coverImage: string;
  sortOrder: number;
};

const CATEGORIES: CategorySeed[] = [
  {
    id: "cat-electronics",
    name: "إلكترونيات",
    slug: "electronics",
    description: "أحدث الأجهزة الإلكترونية والذكية بأسعار منافسة",
    icon: "Smartphone",
    coverImage: "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=800&q=80",
    sortOrder: 0,
  },
  {
    id: "cat-beauty",
    name: "العناية والجمال",
    slug: "beauty",
    description: "منتجات العناية الشخصية ومستحضرات التجميل الأصلية",
    icon: "Sparkles",
    coverImage: "https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=800&q=80",
    sortOrder: 1,
  },
  {
    id: "cat-home",
    name: "المنزل والمطبخ",
    slug: "home-kitchen",
    description: "كل ما تحتاجه لمنزلك ومطبخك بأفضل جودة",
    icon: "Home",
    coverImage: "https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=800&q=80",
    sortOrder: 2,
  },
  {
    id: "cat-fashion",
    name: "أزياء وإكسسوارات",
    slug: "fashion",
    description: "أحدث صيحات الموضة والإكسسوارات للرجال والنساء",
    icon: "Shirt",
    coverImage: "https://images.unsplash.com/photo-1445205170230-053b83016050?w=800&q=80",
    sortOrder: 3,
  },
  {
    id: "cat-health",
    name: "الصحة واللياقة",
    slug: "health-fitness",
    description: "منتجات صحية ومعدات رياضية للياقة بدنية أفضل",
    icon: "HeartPulse",
    coverImage: "https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=800&q=80",
    sortOrder: 4,
  },
];

async function seedCategories() {
  for (const c of CATEGORIES) {
    await db.category.upsert({
      where: { slug: c.slug },
      create: c,
      update: {
        name: c.name,
        description: c.description,
        icon: c.icon,
        coverImage: c.coverImage,
        sortOrder: c.sortOrder,
        isVisible: true,
      },
    });
  }
  console.log(`  ✓ ${CATEGORIES.length} categories seeded`);
}

// ---------------------------------------------------------------------------
// 4. Landing pages with rich content.
// ---------------------------------------------------------------------------

type MediaDef = { url: string; alt: string; order: number };
type VariantDef = { name: string; value: string; extraPrice: number; order: number };
type ReviewDef = { name: string; rating: number; text: string; avatar: string };
type FeatureDef = { icon: string; title: string; description: string };
type FaqDef = { question: string; answer: string };

type LandingSeed = {
  slug: string;
  title: string;
  description: string;
  price: number;
  oldPrice: number | null;
  currency: string;
  buttonText: string;
  ctaButtonText: string;
  announcement: string;
  seoTitle: string;
  seoDescription: string;
  categorySlug: string;
  themeId: string;
  status: "PUBLISHED" | "DRAFT" | "ARCHIVED";
  published: boolean;
  media: MediaDef[];
  variants: VariantDef[];
  reviews: ReviewDef[];
  features: FeatureDef[];
  faqs: FaqDef[];
  setting: {
    countdownEnabled: boolean;
    stickyBuyButton: boolean;
    floatingWhatsapp: boolean;
    showReviews: boolean;
    showFAQ: boolean;
    showFeatures: boolean;
    freeShipping: boolean;
  };
};

const AVATARS = [
  "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=120&h=120&fit=crop&q=80",
  "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=120&h=120&fit=crop&q=80",
  "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=120&h=120&fit=crop&q=80",
  "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=120&h=120&fit=crop&q=80",
  "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=120&h=120&fit=crop&q=80",
  "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=120&h=120&fit=crop&q=80",
];

const LANDINGS: LandingSeed[] = [
  {
    slug: "smart-watch-pro-x",
    title: "ساعة ذكية برو إكس — شاشة AMOLED ومقاومة للماء",
    description:
      "ساعة ذكية متطورة بشاشة AMOLED ساطعة، مقاومة للماء حتى 50 متر، قياس معدل ضربات القلب والأكسجين في الدم، وعمر بطارية يصل إلى 14 يوماً. مثالية للرياضة والحياة اليومية.",
    price: 7900,
    oldPrice: 12000,
    currency: "DZD",
    buttonText: "اطلب الآن",
    ctaButtonText: "أضف إلى السلة الآن",
    announcement: "🔥 عرض خاص: خصم 34% لفترة محدودة — توصيل مجاني!",
    seoTitle: "ساعة ذكية برو إكس بأفضل سعر في الجزائر",
    seoDescription: "اشترِ الساعة الذكية برو إكس بشاشة AMOLED ومقاومة للماء. توصيل سريع لكل الولايات والدفع عند الاستلام.",
    categorySlug: "electronics",
    themeId: "theme-modern-tech",
    status: "PUBLISHED",
    published: true,
    media: [
      { url: "https://images.unsplash.com/photo-1546868871-7041f2a55e12?w=900&q=80", alt: "ساعة ذكية برو إكس", order: 0 },
      { url: "https://images.unsplash.com/photo-1579586337278-3befd40fd17a?w=900&q=80", alt: "ساعة ذكية من الخلف", order: 1 },
      { url: "https://images.unsplash.com/photo-1508685096489-7aacd43bd3b1?w=900&q=80", alt: "ساعة ذكية على المعصم", order: 2 },
    ],
    variants: [
      { name: "اللون", value: "أسود", extraPrice: 0, order: 0 },
      { name: "اللون", value: "فضي", extraPrice: 0, order: 1 },
      { name: "اللون", value: "ذهبي", extraPrice: 500, order: 2 },
      { name: "الحزام", value: "رياضي", extraPrice: 0, order: 3 },
      { name: "الحزام", value: "جلد طبيعي", extraPrice: 800, order: 4 },
      { name: "الضمان", value: "سنة واحدة", extraPrice: 0, order: 5 },
      { name: "الضمان", value: "سنتان", extraPrice: 1200, order: 6 },
    ],
    reviews: [
      { name: "أحمد بن علي", rating: 5, text: "ساعة رائعة جداً، البطارية تدوم طويلاً والشاشة واضحة. التوصيل كان سريعاً.", avatar: AVATARS[0] },
      { name: "سارة مهدي", rating: 5, text: "منتج أصلي ومطابق للوصف. قياس ضربات القلب دقيق جداً. أنصح بها بشدة!", avatar: AVATARS[1] },
      { name: "يوسف قاسمي", rating: 4, text: "جودة ممتازة بسعر مناسب. فقط التطبيق يحتاج بعض التحديثات.", avatar: AVATARS[2] },
      { name: "نسرين بلحاج", rating: 5, text: "اشتريتها هدية لزوجي وأعجبته كثيراً. تغليف أنيق ومظهر فخم.", avatar: AVATARS[3] },
    ],
    features: [
      { icon: "BatteryFull", title: "بطارية تدوم 14 يوماً", description: "شحن واحد يكفي لأسبوعين كاملين من الاستخدام" },
      { icon: "Droplet", title: "مقاومة للماء 5ATM", description: "يمكنك السباحة والاستحمام دون إزالتها" },
      { icon: "HeartPulse", title: "مراقبة صحية", description: "قياس ضربات القلب والأكسجين والنوم على مدار الساعة" },
      { icon: "Bluetooth", title: "اتصال ذكي", description: "إشعارات المكالمات والرسائل مباشرة على معصمك" },
    ],
    faqs: [
      { question: "هل الساعة متوافقة مع كل الهواتف؟", answer: "نعم، الساعة متوافقة مع جميع هواتف Android و iPhone عبر تطبيق مجاني." },
      { question: "كم تستغرق مدة التوصيل؟", answer: "التوصيل يستغرق من 2 إلى 5 أيام عمل حسب الولاية، والدفع عند الاستلام." },
      { question: "هل يوجد ضمان؟", answer: "نعم، الساعة تأتي بضمان سنة كاملة ضد عيوب التصنيع." },
    ],
    setting: {
      countdownEnabled: true,
      stickyBuyButton: true,
      floatingWhatsapp: true,
      showReviews: true,
      showFAQ: true,
      showFeatures: true,
      freeShipping: false,
    },
  },
  {
    slug: "wireless-earbuds-max",
    title: "سماعات لاسلكية ماكس — عزل ضوضاء نشط",
    description:
      "سماعات لاسلكية بتقنية عزل الضوضاء النشط (ANC)، صوت نقي عالي الدقة، وعمر بطارية يصل إلى 30 ساعة مع علبة الشحن. تصميم مريح يناسب الاستخدام الطويل.",
    price: 5400,
    oldPrice: 8900,
    currency: "DZD",
    buttonText: "اطلب الآن",
    ctaButtonText: "احصل عليها الآن",
    announcement: "🎧 خصم 39% — الكمية محدودة!",
    seoTitle: "سماعات لاسلكية مع عزل الضوضاء بأفضل سعر",
    seoDescription: "سماعات بلوتوث لاسلكية بصوت نقي وعزل ضوضاء. مثالية للموسيقى والمكالمات.",
    categorySlug: "electronics",
    themeId: "theme-midnight-black",
    status: "PUBLISHED",
    published: true,
    media: [
      { url: "https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=900&q=80", alt: "سماعات لاسلكية ماكس", order: 0 },
      { url: "https://images.unsplash.com/photo-1606220588913-b3aacb4d2f46?w=900&q=80", alt: "علبة السماعات", order: 1 },
      { url: "https://images.unsplash.com/photo-1572569511254-d8f925fe2cbb?w=900&q=80", alt: "السماعات في الأذن", order: 2 },
    ],
    variants: [
      { name: "اللون", value: "أبيض", extraPrice: 0, order: 0 },
      { name: "اللون", value: "أسود", extraPrice: 0, order: 1 },
      { name: "الضمان", value: "6 أشهر", extraPrice: 0, order: 2 },
      { name: "الضمان", value: "سنة كاملة", extraPrice: 700, order: 3 },
    ],
    reviews: [
      { name: "كريم عمراني", rating: 5, text: "صوت لا يصدق وعزل ضوضاء ممتاز. أنصل بها في الصالة وماسمع والو!", avatar: AVATARS[4] },
      { name: "ليلى حمادي", rating: 5, text: "البطارية قوية والتصميم أنيق. تستاهل كل دينار.", avatar: AVATARS[5] },
      { name: "محمد أمين", rating: 4, text: "جودة صوت ممتازة، فقط حجم العلبة شوية كبير.", avatar: AVATARS[0] },
    ],
    features: [
      { icon: "Volume2", title: "عزل ضوضاء نشط", description: "استمتع بصوت نقي في أي بيئة مزعجة" },
      { icon: "BatteryCharging", title: "30 ساعة تشغيل", description: "علبة شحن تعطيك أسبوعاً كاملاً من الاستماع" },
      { icon: "Mic", title: "ميكروفون HD", description: "مكالمات واضحة حتى في الأماكن المفتوحة" },
      { icon: "Weight", title: "خفيفة الوزن", description: "مريحة للاستخدام طوال اليوم دون تعب" },
    ],
    faqs: [
      { question: "هل تعمل مع الأيفون والأندرويد؟", answer: "نعم، تتصل بسهولة مع جميع الأجهزة عبر البلوتوث 5.3." },
      { question: "هل هي مقاومة للعرق؟", answer: "نعم، حاصلة على شهادة IPX5 ومقاومة للعرق والرذاذ." },
    ],
    setting: {
      countdownEnabled: false,
      stickyBuyButton: true,
      floatingWhatsapp: false,
      showReviews: true,
      showFAQ: true,
      showFeatures: true,
      freeShipping: false,
    },
  },
  {
    slug: "vitamin-c-serum",
    title: "سيروم فيتامين C — نضارة وإشراق للبشرة",
    description:
      "سيروم مركّز بفيتامين C النقي 20% يوحّد لون البشرة، يقلل البقع الداكنة، ويمنحك نضارة فورية. مناسب لجميع أنواع البشرة. خالٍ من البارابين والكحول.",
    price: 3200,
    oldPrice: 4500,
    currency: "DZD",
    buttonText: "اطلب الآن",
    ctaButtonText: "أضف لروتينك اليوم",
    announcement: "✨ نفدت الكمية المرة الفاطة — رجعت بالمخزون!",
    seoTitle: "سيروم فيتامين C أصلي للنضارة وإشراق البشرة",
    seoDescription: "سيروم فيتامين C 20% لتوحيد لون البشرة وتقليل البقع. نتائج مرئية خلال أسبوعين.",
    categorySlug: "beauty",
    themeId: "theme-rose-pink",
    status: "PUBLISHED",
    published: true,
    media: [
      { url: "https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=900&q=80", alt: "سيروم فيتامين C", order: 0 },
      { url: "https://images.unsplash.com/photo-1556228720-195a672e8a03?w=900&q=80", alt: "السيروم والقطارة", order: 1 },
      { url: "https://images.unsplash.com/photo-1571781926291-c477ebfd024b?w=900&q=80", alt: "استخدام السيروم", order: 2 },
    ],
    variants: [
      { name: "الحجم", value: "30 مل", extraPrice: 0, order: 0 },
      { name: "الحجم", value: "50 مل", extraPrice: 900, order: 1 },
    ],
    reviews: [
      { name: "أمينة صالحي", rating: 5, text: "أحسن سيروم جربتو! بشرتي صرات أكثر إشراقاً والبقع بدات تختفي.", avatar: AVATARS[1] },
      { name: "هدى بن صالح", rating: 5, text: "منتج طبيعي وفعال، استعملته شهر والنتيجة باهرة.", avatar: AVATARS[5] },
      { name: "سمية لعور", rating: 4, text: "جيد جداً، الملمس خفيف ويمتص بسرعة. فقط السعر شوية غالي.", avatar: AVATARS[3] },
    ],
    features: [
      { icon: "Sparkles", title: "فيتامين C 20%", description: "تركيز عالٍ يوحّد لون البشرة ويمنح إشراقة" },
      { icon: "Leaf", title: "مكونات طبيعية", description: "خالٍ من البارابين والكحول والمواد الضارة" },
      { icon: "ShieldCheck", title: "لجميع أنواع البشرة", description: "تركيبة لطيفة تناسب البشرة الحساسة" },
      { icon: "Flower2", title: "رائحة منعشة", description: "تجربة استخدام ممتعة كل صباح" },
    ],
    faqs: [
      { question: "متى أرى النتائج؟", answer: "تبدأ النتائج الأولية خلال أسبوعين مع الاستخدام اليومي المنتظم." },
      { question: "هل يسبب حساسية؟", answer: "التركيبة لطيفة وخالية من المواد المهيجة، لكن ننصح باختبارها على منطقة صغيرة أولاً." },
    ],
    setting: {
      countdownEnabled: false,
      stickyBuyButton: true,
      floatingWhatsapp: true,
      showReviews: true,
      showFAQ: true,
      showFeatures: true,
      freeShipping: true,
    },
  },
  {
    slug: "air-fryer-5l",
    title: "قلاية هوائية 5 لتر — طعام صحي بلا زيت",
    description:
      "قلاية هوائية بسعة 5 لتر تكفي العائلة، تطبخ بقليل من الزيت أو بدونه، 8 برامج طبخ جاهزة، وشاشة لمس رقمية. توفير في الطاقة والوقت والدهون.",
    price: 12500,
    oldPrice: 17000,
    currency: "DZD",
    buttonText: "اطلب الآن",
    ctaButtonText: "اطبخ صحياً اليوم",
    announcement: "🍳 القلاية الأكثر مبيعاً — خصم 26%",
    seoTitle: "قلاية هوائية 5 لتر صحية بأفضل سعر في الجزائر",
    seoDescription: "قلاية هوائية بسعة كبيرة و8 برامج طبخ. طعام صحي ولذيذ بلا زيت. ضمان سنة.",
    categorySlug: "home-kitchen",
    themeId: "theme-fresh-green",
    status: "PUBLISHED",
    published: true,
    media: [
      { url: "https://images.unsplash.com/photo-1626806787461-102c1bfaaea1?w=900&q=80", alt: "قلاية هوائية", order: 0 },
      { url: "https://images.unsplash.com/photo-1585515320310-259814833e62?w=900&q=80", alt: "القلاية في المطبخ", order: 1 },
    ],
    variants: [
      { name: "اللون", value: "أسود", extraPrice: 0, order: 0 },
      { name: "اللون", value: "أبيض", extraPrice: 0, order: 1 },
    ],
    reviews: [
      { name: "فاطمة الزهراء", rating: 5, text: "خفيفة على البطن والجيب! البطاطس تجي مقرمشة بدون زيت. تستاهل.", avatar: AVATARS[1] },
      { name: "رضا مرابطي", rating: 5, text: "سعة 5 لتر كافية لعيلتي. التنظيف سهل والطعام يطلع رائع.", avatar: AVATARS[2] },
    ],
    features: [
      { icon: "Gauge", title: "5 لتر سعة كبيرة", description: "تكفي 4-6 أشخاص دفعة واحدة" },
      { icon: "Zap", title: "8 برامج أوتوماتيكية", description: "بطاطس، دجاج، سمك، شوي وحلويات بضغطة زر" },
      { icon: "Leaf", title: "99% أقل دهون", description: "طعام صحي بنفس الطعم المقرمش" },
      { icon: "Timer", title: "مؤقت ذكي", description: "توقف تلقائي عند انتهاء الوقت" },
    ],
    faqs: [
      { question: "هل تستهلك كهرباء كثيرة؟", answer: "لا، تستهلك طاقة أقل من الفرن التقليدي وتطبخ أسرع." },
      { question: "هل السلة قابلة للغسل؟", answer: "نعم، السلة آمنة في غسالة الصحون وسهلة التنظيف." },
    ],
    setting: {
      countdownEnabled: true,
      stickyBuyButton: true,
      floatingWhatsapp: false,
      showReviews: true,
      showFAQ: true,
      showFeatures: true,
      freeShipping: false,
    },
  },
  {
    slug: "leather-wallet-premium",
    title: "محفظة جلد طبيعي فاخرة — حماية RFID",
    description:
      "محفظة رجالية فاخرة من الجلد الطبيعي 100%، مع حماية RFID ضد السرقة الإلكترونية، تصميم نحيف أنيق، وجيوب متعددة للبطاقات.",
    price: 2800,
    oldPrice: null,
    currency: "DZD",
    buttonText: "اطلب الآن",
    ctaButtonText: "اختر لونك المفضل",
    announcement: "👔 مظهر أنيق بلمسة فاخرة",
    seoTitle: "محفظة جلد طبيعي رجالية فاخرة مع حماية RFID",
    seoDescription: "محفظة جلد طبيعي 100% بتصميم أنيق وحماية RFID. هدية مثالية.",
    categorySlug: "fashion",
    themeId: "theme-luxury-crimson",
    status: "PUBLISHED",
    published: true,
    media: [
      { url: "https://images.unsplash.com/photo-1627123424574-724758594e93?w=900&q=80", alt: "محفظة جلد فاخرة", order: 0 },
      { url: "https://images.unsplash.com/photo-1558821568-c1c5dda4d686?w=900&q=80", alt: "تفاصيل المحفظة", order: 1 },
    ],
    variants: [
      { name: "اللون", value: "بني", extraPrice: 0, order: 0 },
      { name: "اللون", value: "أسود", extraPrice: 0, order: 1 },
      { name: "اللون", value: "كحلي", extraPrice: 0, order: 2 },
    ],
    reviews: [
      { name: "عبد الرحمن خليفي", rating: 5, text: "جلد أصلي وفخم، الخياطة متقنة. أحسن من المحافظ الغالية في المحلات.", avatar: AVATARS[4] },
      { name: "إسلام بوزيد", rating: 5, text: "هدية زوجية ممتازة. التغليف راقي والمنتج فخم.", avatar: AVATARS[0] },
    ],
    features: [
      { icon: "ShieldCheck", title: "حماية RFID", description: "حمِل بطاقاتك بأمان ضد السرقة الإلكترونية" },
      { icon: "Award", title: "جلد طبيعي 100%", description: "جلد أصلي يدوم سنوات ويزداد جمالاً مع الوقت" },
      { icon: "Layers", title: "تصميم نحيف", description: "مريحة في الجيب دون انتفاخ" },
    ],
    faqs: [
      { question: "هل الجلد طبيعي فعلاً؟", answer: "نعم، جلد طبيعي 100% بشهادة جودة، وليس جلداً صناعياً." },
    ],
    setting: {
      countdownEnabled: false,
      stickyBuyButton: true,
      floatingWhatsapp: false,
      showReviews: true,
      showFAQ: true,
      showFeatures: true,
      freeShipping: false,
    },
  },
  {
    slug: "resistance-bands-set",
    title: "طقم أشرطة مقاومة — تمرين كامل في المنزل",
    description:
      "طقم 5 أشرطة مقاومة بمستويات شد مختلفة، مع مقابض ومثبتات للباب. مثالية لبناء العضلات واللياقة في المنزل. تأتي مع كيس حمل مجاني.",
    price: 1900,
    oldPrice: 2900,
    currency: "DZD",
    buttonText: "اطلب الآن",
    ctaButtonText: "ابدأ تمرينك اليوم",
    announcement: "💪 لياقتك تبدأ من هنا — خصم 34%",
    seoTitle: "أشرطة مقاومة رياضية للتمرين المنزلي",
    seoDescription: "طقم 5 أشرطة مقاومة بمستويات شد مختلفة. تمرين كامل للجسم في المنزل.",
    categorySlug: "health-fitness",
    themeId: "theme-fresh-green",
    status: "PUBLISHED",
    published: true,
    media: [
      { url: "https://images.unsplash.com/photo-1601925260368-ae2f83cf8b7f?w=900&q=80", alt: "طقم أشرطة المقاومة", order: 0 },
      { url: "https://images.unsplash.com/photo-1517344884509-a0c97ec11bcc?w=900&q=80", alt: "تمرين بالأشرطة", order: 1 },
    ],
    variants: [
      { name: "المستوى", value: "مبتدئ (5-15 كغ)", extraPrice: 0, order: 0 },
      { name: "المستوى", value: "متقدم (الطقم الكامل)", extraPrice: 600, order: 1 },
    ],
    reviews: [
      { name: "نبيل عثماني", rating: 5, text: "جودة ممتازة وكل المعدات كاملة. رجعت للياقة من خلالها.", avatar: AVATARS[2] },
    ],
    features: [
      { icon: "Dumbbell", title: "5 مستويات شد", description: "من المبتدئ إلى المتقدم، تناسب الجميع" },
      { icon: "Home", title: "تمرين منزلي كامل", description: "بديل للنادي الرياضي بكلفة أقل" },
      { icon: "Package", title: "طقم متكامل", description: "مقابض، مثبت باب، وكيس حمل مجاني" },
    ],
    faqs: [
      { question: "هل الأشرطة متينة؟", answer: "نعم، مصنوعة من المطاط الطبيعي عالي الجودة ومقاومة للقطع." },
    ],
    setting: {
      countdownEnabled: false,
      stickyBuyButton: true,
      floatingWhatsapp: true,
      showReviews: true,
      showFAQ: true,
      showFeatures: true,
      freeShipping: true,
    },
  },
  {
    slug: "4k-projector-home",
    title: "بروجكتور منزلي 4K — سينما في بيتك",
    description:
      "بروجكتور بدقة 4K، سطوع عالي، اتصال WiFi وبلوتوث، ومكبر صوت مدمج. حوّل غرفتك إلى سينما حقيقية. يدعم Netflix وYouTube مباشرة.",
    price: 32000,
    oldPrice: 45000,
    currency: "DZD",
    buttonText: "اطلب الآن",
    ctaButtonText: "حوّل بيتك لسينما",
    announcement: "🎬 تجربة سينما حقيقية — خصم 29%",
    seoTitle: "بروجكتور 4K منزلي بشاشة عملاقة وواي فاي",
    seoDescription: "بروجكتور 4K بسطوع عالي وواي فاي مدمج. شاهد الأفلام والمباريات على شاشة عملاقة.",
    categorySlug: "electronics",
    themeId: "theme-midnight-black",
    status: "DRAFT",
    published: false,
    media: [
      { url: "https://images.unsplash.com/photo-1626379953822-baec19c3accd?w=900&q=80", alt: "بروجكتور 4K", order: 0 },
    ],
    variants: [],
    reviews: [],
    features: [
      { icon: "Monitor", title: "دقة 4K فائقة", description: "صورة واضحة على شاشة حتى 300 إنش" },
      { icon: "Wifi", title: "WiFi وبلوتوث", description: "بث مباشر من Netflix وYouTube بدون كابلات" },
    ],
    faqs: [],
    setting: {
      countdownEnabled: false,
      stickyBuyButton: true,
      floatingWhatsapp: false,
      showReviews: true,
      showFAQ: true,
      showFeatures: true,
      freeShipping: false,
    },
  },
];

async function seedLandings() {
  let created = 0;
  for (const l of LANDINGS) {
    const existing = await db.landingPage.findUnique({ where: { slug: l.slug } });
    if (existing) continue; // idempotent — don't clobber edits

    const category = await db.category.findUnique({ where: { slug: l.categorySlug } });

    const page = await db.landingPage.create({
      data: {
        title: l.title,
        slug: l.slug,
        status: l.status,
        description: l.description,
        price: l.price,
        oldPrice: l.oldPrice,
        currency: l.currency,
        buttonText: l.buttonText,
        ctaButtonText: l.ctaButtonText,
        announcement: l.announcement,
        seoTitle: l.seoTitle,
        seoDescription: l.seoDescription,
        published: l.published,
        categoryId: category?.id,
        themeId: l.themeId,
        media: {
          create: l.media.map((m) => ({
            type: "IMAGE",
            url: m.url,
            altText: m.alt,
            displayOrder: m.order,
          })),
        },
        variants: {
          create: l.variants.map((v) => ({
            name: v.name,
            value: v.value,
            extraPrice: v.extraPrice,
            displayOrder: v.order,
          })),
        },
        reviews: {
          create: l.reviews.map((r, i) => ({
            customerName: r.name,
            customerAvatar: r.avatar,
            rating: r.rating,
            reviewText: r.text,
            displayOrder: i,
          })),
        },
        features: {
          create: l.features.map((f, i) => ({
            icon: f.icon,
            title: f.title,
            description: f.description,
            displayOrder: i,
          })),
        },
        faqs: {
          create: l.faqs.map((f, i) => ({
            question: f.question,
            answer: f.answer,
            displayOrder: i,
          })),
        },
        setting: {
          create: {
            countdownEnabled: l.setting.countdownEnabled,
            stickyBuyButton: l.setting.stickyBuyButton,
            floatingWhatsapp: l.setting.floatingWhatsapp,
            showReviews: l.setting.showReviews,
            showFAQ: l.setting.showFAQ,
            showFeatures: l.setting.showFeatures,
            freeShipping: l.setting.freeShipping,
          },
        },
      },
    });
    created++;
    console.log(`    ✓ ${l.status.padEnd(9)} ${l.slug}`);
  }
  console.log(`  ✓ ${created} demo landings created (${LANDINGS.length - created} already existed)`);
}

// ---------------------------------------------------------------------------
// 5. Orders — spread across statuses with history. Attached to the first
//    published landing so the dashboard order table/detail is populated.
// ---------------------------------------------------------------------------
const ORDER_STATUSES = ["NEW", "CONFIRMED", "PREPARING", "SHIPPED", "DELIVERED", "CANCELLED"] as const;

const CUSTOMERS = [
  { name: "محمد الأمين بن صالح", phone: "0561 23 45 67" },
  { name: "سارة مهدي", phone: "0770 11 22 33" },
  { name: "يوسف قاسمي", phone: "0555 88 99 00" },
  { name: "نسرين بلحاج", phone: "0661 44 55 66" },
  { name: "عبد الرحمن خليفي", phone: "0541 77 88 99" },
  { name: "أمينة صالحي", phone: "0780 33 22 11" },
  { name: "كريم عمراني", phone: "0556 12 34 56" },
  { name: "ليلى حمادي", phone: "0662 98 76 54" },
  { name: "إسلام بوزيد", phone: "0771 45 67 89" },
  { name: "فاطمة الزهراء", phone: "0562 11 22 33" },
  { name: "نبيل عثماني", phone: "0540 99 88 77" },
  { name: "هدى بن صالح", phone: "0782 66 55 44" },
];

const WILAYA_SNAPSHOTS = [
  { name: "الجزائر", baladia: "باب الوادي" },
  { name: "وهران", baladia: "السانية" },
  { name: "قسنطينة", baladia: "الخروب" },
  { name: "بجاية", baladia: "أقبو" },
  { name: "البليدة", baladia: "بوفاريك" },
  { name: "سطيف", baladia: "العلمة" },
];

async function seedOrders() {
  const publishedLandings = await db.landingPage.findMany({
    where: { published: true, status: "PUBLISHED" },
    include: { variants: true },
    orderBy: { createdAt: "asc" },
  });
  if (publishedLandings.length === 0) {
    console.log("  ⚠ No published landings — skipping orders");
    return;
  }

  const existingCount = await db.order.count();
  if (existingCount >= 8) {
    console.log(`  ✓ ${existingCount} orders already present — skipping`);
    return;
  }

  const now = Date.now();
  let created = 0;
  for (let i = 0; i < 12; i++) {
    const landing = publishedLandings[i % publishedLandings.length];
    const customer = CUSTOMERS[i % CUSTOMERS.length];
    const loc = WILAYA_SNAPSHOTS[i % WILAYA_SNAPSHOTS.length];
    const status = ORDER_STATUSES[i % ORDER_STATUSES.length];
    // Spread created dates over the last 18 days.
    const createdAt = new Date(now - i * 36 * 60 * 60 * 1000);

    const basePrice = landing.price.toNumber();
    const shipping = 600;
    const quantity = (i % 3) + 1;
    const variantExtra = landing.variants.length
      ? landing.variants[i % landing.variants.length].extraPrice.toNumber()
      : 0;
    const productPrice = basePrice + variantExtra;
    const totalPrice = productPrice * quantity + shipping;

    // Build a history trail up to the current status.
    const statusIndex = ORDER_STATUSES.indexOf(status);
    const history: { fromStatus: string | null; toStatus: string; at: Date }[] = [];
    history.push({ fromStatus: null, toStatus: "NEW", at: createdAt });
    for (let s = 1; s <= statusIndex; s++) {
      history.push({
        fromStatus: ORDER_STATUSES[s - 1],
        toStatus: ORDER_STATUSES[s],
        at: new Date(createdAt.getTime() + s * 6 * 60 * 60 * 1000),
      });
    }

    const selectedVariant = landing.variants[i % Math.max(landing.variants.length, 1)];
    const variantsJson = selectedVariant
      ? JSON.stringify([{ name: selectedVariant.name, value: selectedVariant.value }])
      : "[]";

    await db.order.create({
      data: {
        landingPageId: landing.id,
        customerName: customer.name,
        phone: customer.phone,
        wilaya: loc.name,
        baladia: loc.baladia,
        address: "",
        notes: i % 4 === 0 ? "يرجى الاتصال قبل التوصيل" : null,
        quantity,
        variants: variantsJson,
        productPrice,
        shippingPrice: shipping,
        totalPrice,
        status,
        statusHistory: {
          create: history.map((h) => ({
            fromStatus: h.fromStatus as never,
            toStatus: h.toStatus as never,
            createdAt: h.at,
          })),
        },
        createdAt,
      },
    });
    created++;
  }
  console.log(`  ✓ ${created} demo orders created across all statuses`);
}

// ---------------------------------------------------------------------------
// 6. Store settings — fill in branding/contact so Settings page is populated.
// ---------------------------------------------------------------------------
async function seedStoreSettings() {
  await db.storeSettings.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      storeName: "LandingOS الجزائر",
      storeDescription: "متجر الجزائر الأول لبيع المنتجات بالدفع عند الاستلام. منتجات أصلية بأفضل الأسعار وتوصيل لكل الولايات.",
      phone: "0561 23 45 67",
      email: "contact@landingos.dz",
      address: "شارع ديدوش مراد، الجزائر العاصمة",
      currency: "DZD",
      timezone: "Africa/Algiers",
      language: "ar",
      facebook: "https://facebook.com/landingos",
      instagram: "https://instagram.com/landingos",
      whatsapp: "213561234567",
    },
    update: {},
  });
  console.log("  ✓ Store settings present");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log("=== LandingOS demo-data enrichment ===\n");

  console.log("[1/6] Admin (reset to admin/admin123)...");
  await seedAdmin();
  console.log("");

  console.log("[2/6] Global delivery prices...");
  await seedDeliveryPrices();
  console.log("");

  console.log("[3/6] Categories...");
  await seedCategories();
  console.log("");

  console.log("[4/6] Landing pages...");
  await seedLandings();
  console.log("");

  console.log("[5/6] Orders...");
  await seedOrders();
  console.log("");

  console.log("[6/6] Store settings...");
  await seedStoreSettings();
  console.log("");

  console.log("=== Demo data enrichment complete ===");
}

main()
  .catch((e) => {
    console.error("Demo seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
