import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import sharp from 'sharp';

import { asPlatform, withTenant, disconnect, deleteTenant } from '@landingos/db';
import { createSession, destroySessionsForUser, SESSION_COOKIE, hashPassword } from '@landingos/auth';

import {
  buildCompletionRequest,
  readCompletionResponse,
  readCompletionUsage,
  generationTimeoutMs,
} from '../src/lib/erp/ai-complete.ts';
import {
  monthStartUtc,
  nextMonthStartUtc,
  parseLimitOverride,
  DEFAULT_MONTHLY_AI_CALLS,
  AI_QUOTA_PRODUCT,
  AI_QUOTA_LIMIT_KEY,
} from '../src/lib/erp/ai-quota.ts';
import {
  buildGenerationMessages,
  parseGeneratedCopy,
  extractJsonObject,
  westernizeDigits,
  GenerationParseError,
} from '../src/lib/landing/ai-generate.ts';

/* =============================================================================
 * LB.24 — the AI landing-page generator.
 *
 * Two halves, the tracking suite's layout:
 *
 * PURE — the provider wire shapes and the copy contract, asserted without a
 * server or a network. These are the pieces that talk to OTHER PEOPLE'S
 * services and to a model whose output is untrusted; their behaviour must be
 * checkable on a laptop with nothing running.
 *
 * END-TO-END — the generate route against the running server, with the
 * "model" being a local stub the AiProvider row's own baseUrl points at
 * (the ZR-carrier pattern: per-row URL, ephemeral port, no env, no restart).
 * What these pin: the merchant's facts stay authoritative (price is never
 * the model's to change), a failed generation writes NOTHING, photos must be
 * the tenant's own uploads, and the tenant's API key goes to the provider
 * and nowhere else.
 * ========================================================================== */

const BASE = process.env.CONSOLE_URL ?? 'http://127.0.0.1:3000';
const HAS_DB = Boolean(process.env.PLATFORM_DATABASE_URL || process.env.DATABASE_URL);
const serverUp = await fetch(BASE + '/console/login', { redirect: 'manual' })
  .then((r) => r.status < 500)
  .catch(() => false);
const skip = !HAS_DB || !serverUp;

const stamp = Date.now();

const CFG = {
  type: 'openai-compat' as string | null,
  baseUrl: 'http://127.0.0.1:9/v1',
  apiKey: 'k',
  defaultModel: 'm',
  temperature: null as number | null,
  maxTokens: null as number | null,
  timeoutMs: null as number | null,
};

const FACTS = {
  productName: 'ساعة ذكية برو',
  price: 4900,
  oldPrice: 6900,
  currency: 'DZD',
  sellingPoints: ['شاشة AMOLED', 'مقاومة للماء', 'بطارية 10 أيام'],
  category: null,
};

/* ---------------------------------------------------------------------------
 * PURE — wire shapes
 * ------------------------------------------------------------------------ */

describe('the three provider wire shapes (pure)', () => {
  test('openai-compat: /chat/completions, Bearer auth, floored max_tokens', () => {
    const wire = buildCompletionRequest(CFG, buildGenerationMessages(FACTS));
    assert.equal(wire.url, 'http://127.0.0.1:9/v1/chat/completions');
    assert.equal(wire.headers.authorization, 'Bearer k');
    const body = wire.body as any;
    assert.equal(body.model, 'm');
    assert.equal(body.messages[0].role, 'system');
    assert.equal(body.messages[1].role, 'user');
    // A chat-sized token cap must not truncate a JSON generation.
    assert.ok(body.max_tokens >= 2048);
  });

  test('anthropic: /messages, x-api-key + version header, system out of band', () => {
    const wire = buildCompletionRequest(
      { ...CFG, type: 'anthropic', baseUrl: null, defaultModel: null },
      [{ role: 'system', content: 'S' }, { role: 'user', content: 'U' }],
    );
    assert.equal(wire.url, 'https://api.anthropic.com/v1/messages');
    assert.equal(wire.headers['x-api-key'], 'k');
    assert.equal(wire.headers['anthropic-version'], '2023-06-01');
    const body = wire.body as any;
    // Preset model fills a null defaultModel — same rule as the connection test.
    assert.ok(body.model.length > 0);
    assert.equal(body.system, 'S');
    assert.ok(body.messages.every((m: any) => m.role === 'user'));
  });

  test('gemini: key rides the query string, never a header; systemInstruction present', () => {
    const wire = buildCompletionRequest(
      { ...CFG, type: 'gemini', baseUrl: 'http://g/v1beta', defaultModel: 'gem' },
      [{ role: 'system', content: 'S' }, { role: 'user', content: 'U' }],
    );
    assert.ok(wire.url.includes('/models/gem:generateContent?key=k'));
    assert.equal(Object.keys(wire.headers).length, 1); // content-type only
    const body = wire.body as any;
    assert.equal(body.systemInstruction.parts[0].text, 'S');
    assert.equal(body.contents[0].role, 'user');
  });

  test('response readers pull the text out of each provider shape', () => {
    assert.equal(
      readCompletionResponse('openai-compat', { choices: [{ message: { content: 'a' } }] }),
      'a',
    );
    assert.equal(
      readCompletionResponse('anthropic', {
        content: [{ type: 'text', text: 'b' }, { type: 'tool_use' }, { type: 'text', text: 'c' }],
      }),
      'bc',
    );
    assert.equal(
      readCompletionResponse('gemini', {
        candidates: [{ content: { parts: [{ text: 'd' }, { text: 'e' }] } }],
      }),
      'de',
    );
  });

  test('the generation timeout floors at 30s and respects a larger setting', () => {
    assert.equal(generationTimeoutMs({ ...CFG, timeoutMs: 5_000 }), 30_000);
    assert.equal(generationTimeoutMs({ ...CFG, timeoutMs: 90_000 }), 90_000);
    assert.equal(generationTimeoutMs({ ...CFG, timeoutMs: 500_000 }), 120_000);
  });

  test('AQ.1 — usage readers pull token counts out of each provider shape, null when absent', () => {
    assert.deepEqual(
      readCompletionUsage('openai-compat', { usage: { prompt_tokens: 10, completion_tokens: 20 } }),
      { promptTokens: 10, completionTokens: 20 },
    );
    assert.deepEqual(
      readCompletionUsage('anthropic', { usage: { input_tokens: 5, output_tokens: 7 } }),
      { promptTokens: 5, completionTokens: 7 },
    );
    assert.deepEqual(
      readCompletionUsage('gemini', { usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4 } }),
      { promptTokens: 3, completionTokens: 4 },
    );
    // A provider that reports nothing costs nothing in accuracy: nulls, not NaN.
    assert.deepEqual(readCompletionUsage('openai-compat', { choices: [] }), {
      promptTokens: null,
      completionTokens: null,
    });
    assert.deepEqual(readCompletionUsage('anthropic', { usage: { input_tokens: 'x' } }), {
      promptTokens: null,
      completionTokens: null,
    });
  });
});

/* ---------------------------------------------------------------------------
 * PURE — the spend quota's window and limit rules (AQ.1)
 * ------------------------------------------------------------------------ */

describe('the spend quota window and limit (pure)', () => {
  test('the window is the UTC calendar month, whatever the local clock says', () => {
    const inside = new Date(Date.UTC(2026, 7, 19, 23, 59, 59));
    assert.equal(monthStartUtc(inside).toISOString(), '2026-08-01T00:00:00.000Z');
    assert.equal(nextMonthStartUtc(inside).toISOString(), '2026-09-01T00:00:00.000Z');
    // December rolls into January of the NEXT year.
    const dec = new Date(Date.UTC(2026, 11, 31, 12));
    assert.equal(nextMonthStartUtc(dec).toISOString(), '2027-01-01T00:00:00.000Z');
  });

  test('a limit override must be a non-negative integer; anything else falls back', () => {
    assert.equal(parseLimitOverride(50), 50);
    // 0 is a real value: AI off for this tenant, not "use the default".
    assert.equal(parseLimitOverride(0), 0);
    for (const bad of [-1, 1.5, '200', true, null, undefined, {}, NaN]) {
      assert.equal(parseLimitOverride(bad), null, `accepted ${JSON.stringify(bad)}`);
    }
    assert.ok(DEFAULT_MONTHLY_AI_CALLS > 0);
  });
});

/* ---------------------------------------------------------------------------
 * PURE — the prompt and the copy contract
 * ------------------------------------------------------------------------ */

const VALID_COPY = {
  title: 'ساعة ذكية برو — أناقة وقوة في يدك',
  slug: 'saa-dhakia-pro',
  announcement: 'توصيل 58 ولاية والدفع كي توصلك',
  description:
    'هاذي الساعة ماشي كي وحدة أخرى — شاشة AMOLED تبان حتى في الشمس، بصح اللي يميزها بزاف هي البطارية تاع 10 أيام.\n\nمقاومة للماء، تلبسها في أي بلاصة وما تخافش عليها.',
  ctaButtonText: 'اطلب الآن',
  benefits: [
    { icon: 'truck', title: 'توصيل لباب الدار', description: 'نوصلوها لك وين ما كنت في 58 ولاية' },
    { icon: 'wallet', title: 'الدفع عند الاستلام', description: 'تخلص غير كي توصلك السلعة' },
    { icon: 'not-a-real-icon', title: 'ضمان الجودة', description: null },
  ],
  faqs: [
    // Hedged on purpose: delivery windows and return promises are the
    // merchant's facts, not the model's — the prompt says so.
    { question: 'قداش يدوم التوصيل؟', answer: 'على حساب الولاية — نأكدولك المدة كي نتواصلو معاك.' },
    { question: 'كيفاش نخلص؟', answer: 'الدفع عند الاستلام — تخلص كي توصلك.' },
    { question: 'واش نديرو إذا كان مشكل؟', answer: 'تواصل معنا ونشوفو الحل — رضاك يهمنا.' },
  ],
  seoTitle: 'ساعة ذكية برو بأفضل سعر في الجزائر',
  seoDescription: 'ساعة ذكية بشاشة AMOLED وبطارية 10 أيام — توصيل لكل الولايات والدفع عند الاستلام.',
};

describe('the prompt and the copy contract (pure)', () => {
  test('the prompt states the register: Algerian Darija, not translated MSA', () => {
    const [system, user] = buildGenerationMessages(FACTS);
    assert.ok(system.content.includes('الدارجة الجزائرية'));
    assert.ok(system.content.includes('الدفع عند الاستلام'));
    // The two deliberate lines: no invented facts, no fabricated reviews.
    assert.ok(system.content.includes('لا تخترع'));
    assert.ok(system.content.includes('لا تكتب آراء زبائن'));
    // The facts travel verbatim; the icon vocabulary is spelled out.
    assert.ok(user.content.includes('"productName": "ساعة ذكية برو"'));
    assert.ok(user.content.includes('shield-check'));
  });

  test('Eastern and Persian numerals are transliterated, fences stripped', () => {
    assert.equal(westernizeDigits('السعر ٢٩٩٠ دج و۵ أيام'), 'السعر 2990 دج و5 أيام');
    assert.equal(extractJsonObject('```json\n{"a":1}\n```'), '{"a":1}');
    assert.equal(extractJsonObject('no object here'), null);
  });

  test('valid copy parses; the unknown icon degrades to the default', () => {
    const copy = parseGeneratedCopy('```json\n' + JSON.stringify(VALID_COPY) + '\n```');
    assert.equal(copy.title, VALID_COPY.title);
    assert.equal(copy.benefits[0].icon, 'truck');
    assert.equal(copy.benefits[2].icon, 'badge-check');
    assert.equal(copy.faqs.length, 3);
  });

  test('garbage, truncation and contract misses refuse with a named parse error', () => {
    assert.throws(() => parseGeneratedCopy('البرودكت رائع جداً!'), GenerationParseError);
    assert.throws(
      () => parseGeneratedCopy(JSON.stringify(VALID_COPY).slice(0, 120)),
      GenerationParseError,
    );
    const { faqs, ...noFaqs } = VALID_COPY;
    assert.throws(() => parseGeneratedCopy(JSON.stringify(noFaqs)), GenerationParseError);
  });
});

/* ---------------------------------------------------------------------------
 * END-TO-END — the generate route against the running server
 * ------------------------------------------------------------------------ */

describe('POST /api/builder/landings/generate (end to end)', { skip }, () => {
  let tenantA = '';
  let tenantB = '';
  const userIds: string[] = [];
  const tokens: Record<string, string> = {};

  let stub: Server | null = null;
  let stubUrl = '';
  interface Hit { path: string; headers: Record<string, unknown>; body: any }
  const hits: Hit[] = [];
  // Each test sets what the "model" answers next.
  const behaviour = { status: 200, answer: JSON.stringify(VALID_COPY), delayMs: 0 };

  let photoUrl = '';
  let photo2Url = '';

  async function makeUser(tenantId: string, role: string, label: string) {
    const email = `ai-${label}-${stamp}@landingos.test`;
    const u = await asPlatform().user.create({
      data: { email, name: email, passwordHash: await hashPassword('x') },
    });
    userIds.push(u.id);
    await withTenant(tenantId, (tx) =>
      (tx as any).membership.create({ data: { tenantId, userId: u.id, role } }),
    );
    const { token } = await createSession(u.id, tenantId);
    tokens[label] = token;
  }

  async function api(path: string, token: string | undefined, body: unknown) {
    const res = await fetch(BASE + path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { cookie: `${SESSION_COOKIE}=${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return { status: res.status, body: json };
  }

  const generateBody = (extra: Record<string, unknown> = {}) => ({
    productName: 'ساعة ذكية برو',
    price: 4900,
    oldPrice: 6900,
    sellingPoints: ['شاشة AMOLED', 'مقاومة للماء', 'بطارية 10 أيام'],
    ...extra,
  });

  const pageCount = () =>
    withTenant(tenantA, (tx) => (tx as any).landingPage.count());

  async function uploadPhoto(token: string, bytes: Buffer, name: string) {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), name);
    const res = await fetch(BASE + '/api/builder/upload', {
      method: 'POST',
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
      body: form,
    });
    const json = await res.json();
    assert.equal(res.status, 200, JSON.stringify(json));
    return json.data.url as string;
  }

  before(async () => {
    if (skip) return;

    stub = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        let body: any = null;
        try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
        hits.push({ path: req.url ?? '', headers: req.headers as any, body });
        setTimeout(() => {
          res.statusCode = behaviour.status;
          res.setHeader('content-type', 'application/json');
          res.end(
            behaviour.status === 200
              ? JSON.stringify({
                  choices: [{ message: { content: behaviour.answer } }],
                  // What AQ.1's ledger should capture from an openai-compat answer.
                  usage: { prompt_tokens: 101, completion_tokens: 202 },
                })
              : JSON.stringify({ error: { message: 'stub says no' } }),
          );
        }, behaviour.delayMs);
      });
    });
    await new Promise<void>((resolve, reject) => {
      stub!.once('error', reject);
      stub!.listen(0, '127.0.0.1', resolve);
    });
    stubUrl = `http://127.0.0.1:${(stub!.address() as AddressInfo).port}/v1`;

    for (const [slug, ref] of [[`ai-a-${stamp}`, 'A'], [`ai-b-${stamp}`, 'B']] as const) {
      const t = await asPlatform().tenant.create({ data: { slug, name: `AI ${ref}` } });
      if (ref === 'A') tenantA = t.id; else tenantB = t.id;
      await withTenant(t.id, (tx) =>
        (tx as any).subscription.create({
          data: { tenantId: t.id, status: 'ACTIVE', entitlements: ['product.website-builder'] },
        }),
      );
    }
    await makeUser(tenantA, 'OWNER', 'owner');
    await makeUser(tenantA, 'VIEWER', 'viewer');

    // The photos the generation attaches: a red square reads as a real
    // palette (theme expected), uploaded through the ordinary pipeline.
    const red = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 196, g: 30, b: 58 } },
    }).png().toBuffer();
    photoUrl = await uploadPhoto(tokens.owner, red, 'red.png');
    const blue = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 20, g: 60, b: 180 } },
    }).png().toBuffer();
    photo2Url = await uploadPhoto(tokens.owner, blue, 'blue.png');
  });

  after(async () => {
    if (skip) return;
    for (const id of userIds) {
      await destroySessionsForUser(id);
      for (const t of [tenantA, tenantB].filter(Boolean)) {
        await withTenant(t, (tx) => (tx as any).membership.deleteMany({ where: { userId: id } }));
      }
      await asPlatform().user.delete({ where: { id } }).catch(() => {});
    }
    for (const id of [tenantA, tenantB].filter(Boolean)) {
      await deleteTenant(id).catch(() => {});
    }
    await disconnect();
    if (stub) await new Promise<void>((resolve) => stub!.close(() => resolve()));
  });

  test('anonymous is 401; a VIEWER is 403 — the write permission gates it', async () => {
    const anon = await api('/api/builder/landings/generate', undefined, generateBody());
    assert.equal(anon.status, 401);
    const viewer = await api('/api/builder/landings/generate', tokens.viewer, generateBody());
    assert.equal(viewer.status, 403);
  });

  test('no provider configured: 501 NO_AI_PROVIDER, and the screen says so', async () => {
    const res = await api('/api/builder/landings/generate', tokens.owner, generateBody());
    assert.equal(res.status, 501);
    assert.equal(res.body.error.code, 'NO_AI_PROVIDER');

    const html = await fetch(BASE + '/console/builder/pages/new', {
      headers: { cookie: `${SESSION_COOKIE}=${tokens.owner}` },
    }).then((r) => r.text());
    assert.ok(html.includes('data-testid="ai-generate-unavailable"'));
    assert.ok(!html.includes('data-testid="ai-generate-panel"'));
  });

  test('with a provider row, the create screen offers the panel', async () => {
    await withTenant(tenantA, (tx) =>
      (tx as any).aiProvider.create({
        data: {
          tenantId: tenantA,
          name: 'stub',
          type: 'openai-compat',
          baseUrl: stubUrl,
          apiKey: 'sk-test-secret-lb24',
          defaultModel: 'test-model',
          active: true,
          isDefault: true,
        },
      }),
    );
    const html = await fetch(BASE + '/console/builder/pages/new', {
      headers: { cookie: `${SESSION_COOKIE}=${tokens.owner}` },
    }).then((r) => r.text());
    assert.ok(html.includes('data-testid="ai-generate-panel"'));
  });

  test('the whole flow: facts in, a reviewed-in-the-editor DRAFT out', async () => {
    behaviour.status = 200;
    // The stub answers with a fence, an unknown icon and Eastern numerals —
    // everything normalization must absorb on the way to the database.
    behaviour.answer =
      '```json\n' +
      JSON.stringify({
        ...VALID_COPY,
        announcement: 'توصيل ٥٨ ولاية والدفع كي توصلك',
      }) +
      '\n```';

    const res = await api('/api/builder/landings/generate', tokens.owner, generateBody({
      imageUrls: [photoUrl, photo2Url],
    }));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.status, 'DRAFT');
    // An Arabic product name slugifies to nothing; the model's latin slug is
    // the fallback that keeps the URL human-readable.
    assert.equal(res.body.data.slug, 'saa-dhakia-pro');
    // The tenant's key must never ride back out in the envelope.
    assert.ok(!JSON.stringify(res.body).includes('sk-test-secret-lb24'));

    // What the provider was actually asked, with the tenant's own key.
    const hit = hits.at(-1)!;
    assert.ok(hit.path.endsWith('/chat/completions'));
    assert.equal(hit.headers.authorization, 'Bearer sk-test-secret-lb24');
    assert.equal(hit.body.model, 'test-model');
    assert.ok(String(hit.body.messages[0].content).includes('الدارجة الجزائرية'));

    const page = await withTenant(tenantA, (tx) =>
      (tx as any).landingPage.findUnique({
        where: { id: res.body.data.id },
        include: {
          media: { orderBy: { displayOrder: 'asc' } },
          features: { orderBy: { displayOrder: 'asc' } },
          faqs: { orderBy: { displayOrder: 'asc' } },
          reviews: true,
          theme: true,
        },
      }),
    );

    // The merchant's facts stayed authoritative.
    assert.equal(page.status, 'DRAFT');
    assert.equal(page.published, false);
    assert.equal(Number(page.price), 4900);
    assert.equal(Number(page.oldPrice), 6900);
    assert.equal(page.currency, 'DZD');

    // The model's words landed — with the numerals westernized.
    assert.equal(page.title, VALID_COPY.title);
    assert.equal(page.announcement, 'توصيل 58 ولاية والدفع كي توصلك');
    assert.equal(page.seoTitle, VALID_COPY.seoTitle);
    assert.ok(page.description.includes('بصح اللي يميزها بزاف'));

    // Benefits with the unknown icon degraded, FAQs in order, NO reviews.
    assert.equal(page.features.length, 3);
    assert.equal(page.features[0].icon, 'truck');
    assert.equal(page.features[2].icon, 'badge-check');
    assert.equal(page.faqs.length, 3);
    assert.equal(page.reviews.length, 0);

    // The merchant's photos: gallery placement, order kept, honest alt text.
    assert.equal(page.media.length, 2);
    assert.equal(page.media[0].url, photoUrl);
    assert.equal(page.media[0].placement, 'GALLERY');
    assert.equal(page.media[0].displayOrder, 0);
    assert.equal(page.media[0].altText, 'ساعة ذكية برو');

    // LB.22's palette on the red hero became a real selectable theme row.
    assert.ok(page.themeId);
    assert.ok(page.theme.primary.startsWith('#'));
    assert.equal(page.theme.isBuiltIn, false);
  });

  test('a malformed answer writes NOTHING — no half-page to discover', async () => {
    const countBefore = await pageCount();
    behaviour.status = 200;
    behaviour.answer = 'المنتج رائع جداً، صفحة ممتازة!';
    const res = await api('/api/builder/landings/generate', tokens.owner, generateBody());
    assert.equal(res.status, 502);
    assert.equal(res.body.error.code, 'AI_INVALID_OUTPUT');
    assert.equal(await pageCount(), countBefore);
  });

  test('an upstream failure is a named 502, and writes nothing', async () => {
    const countBefore = await pageCount();
    behaviour.status = 500;
    const res = await api('/api/builder/landings/generate', tokens.owner, generateBody());
    assert.equal(res.status, 502);
    assert.equal(res.body.error.code, 'AI_UPSTREAM_ERROR');
    // The provider's key does not leak through the error detail either.
    assert.ok(!JSON.stringify(res.body).includes('sk-test-secret-lb24'));
    assert.equal(await pageCount(), countBefore);
    behaviour.status = 200;
  });

  test("another tenant's photo is refused before the model is ever asked", async () => {
    const hitsBefore = hits.length;
    const res = await api('/api/builder/landings/generate', tokens.owner, generateBody({
      imageUrls: [`/uploads/tenants/${tenantB}/stolen.png`],
    }));
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'IMAGE_NOT_OWNED');
    assert.equal(hits.length, hitsBefore);
  });

  test('an old price at or below the price is refused', async () => {
    const res = await api('/api/builder/landings/generate', tokens.owner, generateBody({
      oldPrice: 4900,
    }));
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'INVALID_INPUT');
  });

  test('a model slower than the 15s transaction budget still lands a page', async () => {
    // The review's headline finding: the first version awaited the provider
    // INSIDE withTenant's 15s interactive transaction, so any real-world
    // generation slower than that returned 500 AFTER billing the tenant's
    // key. The three-phase shape (D-LP.5.1) is what this pins.
    behaviour.status = 200;
    behaviour.answer = JSON.stringify(VALID_COPY);
    behaviour.delayMs = 16_500;
    try {
      const res = await api('/api/builder/landings/generate', tokens.owner, generateBody());
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(res.body.data.status, 'DRAFT');
    } finally {
      behaviour.delayMs = 0;
    }
  });

  test('slug clashes de-clash with suffixes, the duplicate rule', async () => {
    behaviour.answer = JSON.stringify(VALID_COPY);
    const first = await api('/api/builder/landings/generate', tokens.owner, generateBody({
      slug: 'gen-clash',
    }));
    assert.equal(first.status, 201);
    assert.equal(first.body.data.slug, 'gen-clash');
    const second = await api('/api/builder/landings/generate', tokens.owner, generateBody({
      slug: 'gen-clash',
    }));
    assert.equal(second.status, 201);
    assert.equal(second.body.data.slug, 'gen-clash-2');
  });

  test('LB.54 — a caller-supplied letterless slug is REFUSED, not published', async () => {
    /* This route was the ONE write path LB.54 never gated. Measured before the
       fix, against this same build: `slug: "0"` with an Arabic product name
       created a page at `/0` — the exact address whose 404 LB.54 was written
       to close — while POST /api/builder/landings refused the identical value
       with 422. Four write paths, one rule, one copy missing. */
    behaviour.answer = JSON.stringify(VALID_COPY);
    for (const slug of ['0', '2024', '0-1']) {
      const r = await api('/api/builder/landings/generate', tokens.owner, generateBody({ slug }));
      assert.equal(r.status, 422, `slug ${JSON.stringify(slug)} was accepted: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.error.code, 'INVALID_INPUT');
      assert.match(r.body.error.message, /at least one letter/);
    }
    // The rule is about LETTERS, not about digits — a digit-carrying address
    // that also has a letter is still perfectly typable and must survive.
    const ok = await api('/api/builder/landings/generate', tokens.owner, generateBody({ slug: '2024-promo' }));
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(ok.body.data.slug, '2024-promo');
  });

  test("LB.54 — a letterless slug FROM THE MODEL is ignored, not refused", async () => {
    /* The merchant never typed this one, so refusing would throw away a
       generation they paid for over a word they did not choose. It falls
       through to the letter-bearing default instead, on a DRAFT, which is the
       first thing the editor shows them. Measured before the fix: a model
       answering "0" produced /0-2 and "2024" produced /2024. */
    for (const modelSlug of ['0', '2024']) {
      behaviour.answer = JSON.stringify({ ...VALID_COPY, slug: modelSlug });
      const r = await api('/api/builder/landings/generate', tokens.owner,
        generateBody({ productName: 'ساعة برو' }));
      assert.equal(r.status, 201, JSON.stringify(r.body));
      assert.match(r.body.data.slug, /[a-z]/,
        `the model's ${JSON.stringify(modelSlug)} became the address: ${r.body.data.slug}`);
      assert.ok(!/^0/.test(r.body.data.slug), `slug still starts from the model's digits: ${r.body.data.slug}`);
    }
    // And a GOOD model slug is still used — the guard must not throw the
    // model's real contribution away with the bad one.
    behaviour.answer = JSON.stringify({ ...VALID_COPY, slug: 'saa-pro-lux' });
    const good = await api('/api/builder/landings/generate', tokens.owner,
      generateBody({ productName: 'ساعة برو' }));
    assert.equal(good.status, 201, JSON.stringify(good.body));
    assert.equal(good.body.data.slug, 'saa-pro-lux', 'a letter-bearing model slug must still win');
  });

  /* -------------------------------------------------------------------------
   * AQ.1 — the spend quota around this route
   * ---------------------------------------------------------------------- */

  const ledger = () =>
    withTenant(tenantA, (tx) =>
      (tx as any).aiUsageEvent.findMany({ orderBy: { createdAt: 'asc' } }),
    );

  test('AQ.1 — a successful generation lands ONE ledger row, settled ok with the token counts', async () => {
    const before = await ledger();
    behaviour.status = 200;
    behaviour.answer = JSON.stringify(VALID_COPY);
    const res = await api('/api/builder/landings/generate', tokens.owner, generateBody());
    assert.equal(res.status, 201, JSON.stringify(res.body));

    const rows = await ledger();
    assert.equal(rows.length, before.length + 1);
    const row = rows.at(-1)!;
    assert.equal(row.kind, 'landing_generation');
    assert.equal(row.status, 'ok');
    assert.equal(row.provider, 'openai-compat');
    assert.equal(row.model, 'test-model');
    assert.equal(row.promptTokens, 101);
    assert.equal(row.completionTokens, 202);
  });

  test('AQ.1 — an upstream failure still counts, settled failed: the key may have been billed', async () => {
    const before = await ledger();
    behaviour.status = 500;
    const res = await api('/api/builder/landings/generate', tokens.owner, generateBody());
    assert.equal(res.status, 502);
    behaviour.status = 200;

    const rows = await ledger();
    assert.equal(rows.length, before.length + 1);
    assert.equal(rows.at(-1)!.status, 'failed');
    assert.equal(rows.at(-1)!.promptTokens, null);
  });

  test('AQ.1 — a refusal BEFORE the provider is contacted releases its reservation', async () => {
    // Passes the shape check (own-tenant path, safe filename) but no such
    // file exists, so the hero read refuses inside the call phase — the one
    // post-reservation, provably pre-call refusal the route has.
    const before = await ledger();
    const hitsBefore = hits.length;
    const res = await api('/api/builder/landings/generate', tokens.owner, generateBody({
      imageUrls: [`/uploads/tenants/${tenantA}/never-uploaded.png`],
    }));
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'IMAGE_NOT_OWNED');
    assert.equal(hits.length, hitsBefore, 'the model must not have been contacted');
    assert.equal((await ledger()).length, before.length, 'the reservation must be released');
  });

  test('AQ.1 — over the limit: 429 with the numbers, the model never contacted, nothing written', async () => {
    const used = (await ledger()).length;
    // Clamp this tenant's allowance to exactly what it has already spent.
    await withTenant(tenantA, (tx) =>
      (tx as any).productSetting.create({
        data: { tenantId: tenantA, product: AI_QUOTA_PRODUCT, key: AI_QUOTA_LIMIT_KEY, value: used },
      }),
    );
    try {
      const hitsBefore = hits.length;
      const pagesBefore = await pageCount();
      const res = await api('/api/builder/landings/generate', tokens.owner, generateBody());
      assert.equal(res.status, 429, JSON.stringify(res.body));
      assert.equal(res.body.error.code, 'AI_QUOTA_EXCEEDED');
      assert.equal(res.body.error.used, used);
      assert.equal(res.body.error.limit, used);
      assert.ok(String(res.body.error.resetsAt).endsWith('T00:00:00.000Z'));
      assert.equal(hits.length, hitsBefore, 'a refused call must never reach the provider');
      assert.equal(await pageCount(), pagesBefore);
      assert.equal((await ledger()).length, used, 'a refusal must not consume quota');

      // The create screen says so up front: the notice replaces the submit.
      const html = await fetch(BASE + '/console/builder/pages/new', {
        headers: { cookie: `${SESSION_COOKIE}=${tokens.owner}` },
      }).then((r) => r.text());
      assert.ok(html.includes('data-testid="ai-usage-line"'));
      assert.ok(html.includes('data-testid="ai-quota-exhausted"'));
      assert.ok(!html.includes('data-testid="ai-generate-submit"'));
    } finally {
      await withTenant(tenantA, (tx) =>
        (tx as any).productSetting.deleteMany({
          where: { product: AI_QUOTA_PRODUCT, key: AI_QUOTA_LIMIT_KEY },
        }),
      );
    }
  });

  test('AQ.1 — under the limit again, the screen offers the button and a generation goes through', async () => {
    behaviour.status = 200;
    behaviour.answer = JSON.stringify(VALID_COPY);
    const html = await fetch(BASE + '/console/builder/pages/new', {
      headers: { cookie: `${SESSION_COOKIE}=${tokens.owner}` },
    }).then((r) => r.text());
    assert.ok(html.includes('data-testid="ai-generate-submit"'));
    assert.ok(!html.includes('data-testid="ai-quota-exhausted"'));
    const res = await api('/api/builder/landings/generate', tokens.owner, generateBody());
    assert.equal(res.status, 201, JSON.stringify(res.body));
  });
});
