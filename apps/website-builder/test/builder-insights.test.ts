import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { asPlatform, withTenant, disconnect, deleteTenant } from '@landingos/db';
import { createSession, destroySessionsForUser, SESSION_COOKIE, hashPassword } from '@landingos/auth';

import {
  flattenSummaryMetrics,
  buildInsightMessages,
  parseInsightAnswer,
  InsightParseError,
  INSIGHT_COOLDOWN_MS,
  INSIGHT_MIN_VIEWS,
  type InsightSummary,
} from '../src/lib/landing/ai-insight.ts';
import { AI_QUOTA_PRODUCT, AI_QUOTA_LIMIT_KEY } from '../src/lib/erp/ai-quota.ts';

/* =============================================================================
 * BH.3 — the AI behavior analysis.
 *
 * PURE — the grounding contract: a recommendation without its real number is
 * dropped, an answer with no grounded recommendation is refused, and the
 * metric vocabulary the validator checks is the one the prompt advertises.
 *
 * END-TO-END — the analyze route against the running server with a stub
 * provider (builder-ai's exact pattern): the data floor, the cooldown
 * re-show, the AQ.1 quota around the second spender, ungrounded answers
 * storing nothing, and the Traffic screen rendering what was stored.
 * ========================================================================== */

const BASE = process.env.CONSOLE_URL ?? 'http://127.0.0.1:3000';
const HAS_DB = Boolean(process.env.PLATFORM_DATABASE_URL || process.env.DATABASE_URL);
const serverUp = await fetch(BASE + '/console/login', { redirect: 'manual' })
  .then((r) => r.status < 500)
  .catch(() => false);
const skip = !HAS_DB || !serverUp;

const stamp = Date.now();

/* ---------------------------------------------------------------------------
 * PURE — grounding
 * ------------------------------------------------------------------------ */

const SUMMARY: InsightSummary = {
  windowDays: 30,
  pageTitle: 'ساعة ذكية برو',
  views: 120,
  orders: 3,
  behavior: {
    measured: 40,
    sawForm: 25,
    furthest: { hero: 5, description: 20, faq: 15 },
    faqOpens: 20,
    galleryChanges: 60,
    variantChanges: 8,
    stickyBuyClicks: 12,
    whatsappClicks: 4,
    avgActiveMs: 5000,
  },
  faqQuestions: [
    { key: 'faq.q1', question: 'قداش يدوم التوصيل؟', opens: 14 },
    { key: 'faq.q2', question: 'كيفاش نخلص؟', opens: 6 },
  ],
  drafts: { started: 9, withPhone: 5 },
};

const REC = {
  section: 'faq',
  finding: 'سؤال التوصيل فُتح 14 مرة — إنه أكبر شك عند الزوار.',
  suggestion: 'أضف مدة التوصيل الحقيقية لولايتك الرئيسية في جواب السؤال الأول.',
  metric: 'faq.q1',
  value: 14,
};

describe('the grounding contract (pure)', () => {
  test('the flat metric vocabulary carries every number, dotted and stable', () => {
    const m = flattenSummaryMetrics(SUMMARY);
    assert.equal(m.views, 120);
    assert.equal(m.orders, 3);
    assert.equal(m['behavior.measured'], 40);
    assert.equal(m['furthest.description'], 20);
    assert.equal(m['faq.q1'], 14);
    assert.equal(m['drafts.withPhone'], 5);
    // No behavior → no behavior keys, rather than zeros pretending to be data.
    const bare = flattenSummaryMetrics({ ...SUMMARY, behavior: null, faqQuestions: [] });
    assert.equal(bare['behavior.measured'], undefined);
    assert.equal(bare.views, 120);
  });

  test('the prompt shows the model the summary AND the citable keys', () => {
    const [system, user] = buildInsightMessages(SUMMARY);
    assert.ok(system.content.includes('metric'));
    assert.ok(user.content.includes('"faq.q1": 14'));
    assert.ok(user.content.includes('"views": 120'));
    assert.ok(user.content.includes('recommendations'));
  });

  test('a grounded recommendation survives; unknown metrics and misquoted values are dropped', () => {
    const answer = JSON.stringify({
      recommendations: [
        REC,
        { ...REC, metric: 'made.up', finding: 'رقم مخترع لا وجود له في المعطيات.' },
        { ...REC, value: 99999, finding: 'قيمة منقولة بشكل خاطئ عن المعطيات.' },
      ],
    });
    const grounded = parseInsightAnswer(answer, SUMMARY);
    assert.equal(grounded.length, 1);
    assert.equal(grounded[0].metric, 'faq.q1');
  });

  test('zero grounded recommendations refuses the whole answer', () => {
    const answer = JSON.stringify({
      recommendations: [{ ...REC, metric: 'invented.metric' }],
    });
    assert.throws(() => parseInsightAnswer(answer, SUMMARY), InsightParseError);
  });

  test('garbage, fences and Eastern numerals behave as the generation parser taught', () => {
    assert.throws(() => parseInsightAnswer('تحليل ممتاز!', SUMMARY), InsightParseError);
    // EVERY "14" becomes Eastern — including the bare `"value": ١٤`, which is
    // not even valid JSON until westernizeDigits has run.
    const fenced =
      '```json\n' +
      JSON.stringify({ recommendations: [{ ...REC, value: 14 }] }).replaceAll('14', '١٤') +
      '\n```';
    const grounded = parseInsightAnswer(fenced, SUMMARY);
    assert.equal(grounded[0].value, 14);
  });

  test('the knobs are the proposed product defaults', () => {
    assert.equal(INSIGHT_COOLDOWN_MS, 24 * 60 * 60 * 1000);
    assert.equal(INSIGHT_MIN_VIEWS, 100);
  });
});

/* ---------------------------------------------------------------------------
 * END-TO-END
 * ------------------------------------------------------------------------ */

describe('POST /api/builder/landings/[id]/analyze (end to end)', { skip }, () => {
  let tenantId = '';
  let pageId = '';
  let thinPageId = '';
  let faqIds: string[] = [];
  const userIds: string[] = [];
  const tokens: Record<string, string> = {};

  let stub: Server | null = null;
  let stubUrl = '';
  const hits: Array<{ path: string; body: any }> = [];
  const behaviour = { status: 200, answer: '' };

  async function makeUser(role: string, label: string) {
    const email = `bh3-${label}-${stamp}@landingos.test`;
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

  async function api(path: string, token: string | undefined, body: unknown = {}) {
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

  const ledger = () =>
    withTenant(tenantId, (tx) =>
      (tx as any).aiUsageEvent.findMany({ orderBy: { createdAt: 'asc' } }),
    );
  const insightCount = () =>
    withTenant(tenantId, (tx) => (tx as any).landingInsight.count());

  /* The seeded truth the stub's citations must match: 120 views, 40 measured
   * (activeMs 5000), 25 sawForm, faq.q1 opened 14 times, 9 drafts (5 with a
   * phone). Deterministic on purpose — grounding is value-exact. */
  const GROUNDED_ANSWER = JSON.stringify({
    recommendations: [
      {
        section: 'faq',
        finding: 'سؤال التوصيل فُتح 14 مرة في 30 يوماً — أكبر شك عند الزوار.',
        suggestion: 'أضف مدة توصيل واقعية لولاياتك الرئيسية في جواب هذا السؤال.',
        metric: 'faq.q1',
        value: 14,
      },
      {
        section: 'form',
        finding: 'من 120 زيارة بدأ 9 زوار فقط الاستمارة.',
        suggestion: 'قرّب الاستمارة من أعلى الصفحة أو أبرز زر الطلب أكثر.',
        metric: 'views',
        value: 120,
      },
      {
        section: 'general',
        finding: 'رقم مخترع يجب أن يُرفض آلياً قبل التخزين.',
        suggestion: 'هذه التوصية يجب ألا تظهر للتاجر أبداً.',
        metric: 'views',
        value: 424242,
      },
    ],
  });

  before(async () => {
    if (skip) return;

    stub = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        let body: any = null;
        try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
        hits.push({ path: req.url ?? '', body });
        res.statusCode = behaviour.status;
        res.setHeader('content-type', 'application/json');
        res.end(
          behaviour.status === 200
            ? JSON.stringify({
                choices: [{ message: { content: behaviour.answer } }],
                usage: { prompt_tokens: 55, completion_tokens: 66 },
              })
            : JSON.stringify({ error: { message: 'stub says no' } }),
        );
      });
    });
    await new Promise<void>((resolve, reject) => {
      stub!.once('error', reject);
      stub!.listen(0, '127.0.0.1', resolve);
    });
    stubUrl = `http://127.0.0.1:${(stub!.address() as AddressInfo).port}/v1`;

    const t = await asPlatform().tenant.create({
      data: { slug: `bh3-${stamp}`, name: 'BH3 Insights' },
    });
    tenantId = t.id;
    await withTenant(tenantId, async (tx) => {
      await (tx as any).subscription.create({
        data: { tenantId, status: 'ACTIVE', entitlements: ['product.website-builder'] },
      });
      await (tx as any).aiProvider.create({
        data: {
          tenantId,
          name: 'stub',
          type: 'openai-compat',
          baseUrl: stubUrl,
          apiKey: 'sk-test-secret-bh3',
          defaultModel: 'test-model',
          active: true,
          isDefault: true,
        },
      });
    });
    await makeUser('OWNER', 'owner');
    await makeUser('VIEWER', 'viewer');

    // The analyzed page: two FAQs, real traffic, real behavior.
    await withTenant(tenantId, async (tx) => {
      const page = await (tx as any).landingPage.create({
        data: {
          tenantId,
          title: 'ساعة ذكية برو',
          slug: 'bh3-watch',
          status: 'PUBLISHED',
          published: true,
          price: 4900,
          faqs: {
            create: [
              { tenantId, question: 'قداش يدوم التوصيل؟', answer: 'على حساب الولاية.', displayOrder: 0 },
              { tenantId, question: 'كيفاش نخلص؟', answer: 'الدفع عند الاستلام.', displayOrder: 1 },
            ],
          },
        },
        select: { id: true, faqs: { select: { id: true }, orderBy: { displayOrder: 'asc' } } },
      });
      pageId = page.id;
      faqIds = page.faqs.map((f: any) => f.id);

      const thin = await (tx as any).landingPage.create({
        data: {
          tenantId, title: 'صفحة بلا زيارات', slug: 'bh3-thin',
          status: 'PUBLISHED', published: true, price: 1000,
        },
        select: { id: true },
      });
      thinPageId = thin.id;

      // 120 views: 40 measured (activeMs 5000; 25 of them saw the form;
      // 14 opened faq q1 — 6 of those also q2), 80 unmeasured.
      const visits: any[] = [];
      for (let i = 0; i < 120; i++) {
        const measured = i < 40;
        visits.push({
          tenantId,
          landingPageId: pageId,
          pageKind: 'landing',
          visitorToken: `bh3-v-${stamp}-${i}`,
          sourceChannel: 'facebook',
          ...(measured
            ? {
                viewId: `bh3-view-${stamp}-${i}`,
                activeMs: 5000,
                sawForm: i < 25,
                furthestSection: i < 5 ? 'hero' : i < 25 ? 'description' : 'faq',
                faqOpens: i < 14 ? (i < 6 ? 2 : 1) : 0,
                faqOpenedIds: i < 14 ? (i < 6 ? faqIds : [faqIds[0]]) : [],
                galleryChanges: 1,
                variantChanges: 0,
                stickyBuyClicked: i < 12,
                whatsappClicked: i < 4,
              }
            : {}),
        });
      }
      await (tx as any).storefrontVisit.createMany({ data: visits });

      // The drafts funnel: 9 started, 5 left a phone.
      await (tx as any).draftOrder.createMany({
        data: Array.from({ length: 9 }, (_, i) => ({
          tenantId,
          token: `bh3-draft-${stamp}-${i}`,
          landingPageId: pageId,
          ...(i < 5 ? { phone: '0550000000' } : {}),
        })),
      });
    });
  });

  after(async () => {
    if (skip) return;
    for (const id of userIds) {
      await destroySessionsForUser(id);
      await withTenant(tenantId, (tx) =>
        (tx as any).membership.deleteMany({ where: { userId: id } }),
      );
      await asPlatform().user.delete({ where: { id } }).catch(() => {});
    }
    if (tenantId) await deleteTenant(tenantId).catch(() => {});
    await disconnect();
    if (stub) await new Promise<void>((resolve) => stub!.close(() => resolve()));
  });

  test('anonymous is 401; a VIEWER is 403', async () => {
    const anon = await api(`/api/builder/landings/${pageId}/analyze`, undefined);
    assert.equal(anon.status, 401);
    const viewer = await api(`/api/builder/landings/${pageId}/analyze`, tokens.viewer);
    assert.equal(viewer.status, 403);
  });

  test('below the data floor: a named refusal BEFORE provider or quota are touched', async () => {
    const before = (await ledger()).length;
    const res = await api(`/api/builder/landings/${thinPageId}/analyze`, tokens.owner);
    assert.equal(res.status, 422, JSON.stringify(res.body));
    assert.equal(res.body.error.code, 'INSUFFICIENT_DATA');
    assert.equal(res.body.error.needed, INSIGHT_MIN_VIEWS);
    assert.equal((await ledger()).length, before, 'a floor refusal must not touch the quota');
    assert.equal(hits.length, 0);
  });

  test('the whole flow: aggregates in, only GROUNDED recommendations stored', async () => {
    behaviour.status = 200;
    behaviour.answer = GROUNDED_ANSWER;
    const res = await api(`/api/builder/landings/${pageId}/analyze`, tokens.owner);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.cached, false);
    // The invented-number item was dropped in validation; two survived.
    assert.equal(res.body.data.recommendations.length, 2);
    assert.ok(!JSON.stringify(res.body).includes('424242'));
    assert.ok(!JSON.stringify(res.body).includes('sk-test-secret-bh3'));

    // What the model was shown: aggregates and keys, never a phone number.
    // The summary rides INSIDE the user message string, so read it there;
    // the PII check runs over the whole wire body, escaping and all.
    const hit = hits.at(-1)!;
    const userMessage = String(hit.body.messages.at(-1)?.content ?? '');
    assert.ok(userMessage.includes('"views": 120'));
    assert.ok(userMessage.includes('faq.q1'));
    assert.ok(!JSON.stringify(hit.body).includes('0550000000'), 'draft PII must never reach the provider');

    // The ledger: one behavior_insight row, settled ok with the token counts.
    const rows = await ledger();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, 'behavior_insight');
    assert.equal(rows[0].status, 'ok');
    assert.equal(rows[0].promptTokens, 55);

    // The stored insight keeps its input beside its output.
    const stored = await withTenant(tenantId, (tx) =>
      (tx as any).landingInsight.findFirst({ where: { landingPageId: pageId } }),
    );
    assert.equal(stored.windowDays, 30);
    assert.equal(stored.inputSummary.views, 120);
    assert.equal(stored.inputSummary.behavior.measured, 40);
    assert.equal(stored.recommendations.length, 2);
  });

  test('inside the cooldown: the stored analysis is RE-SHOWN, nothing is billed', async () => {
    const hitsBefore = hits.length;
    const rowsBefore = (await ledger()).length;
    const res = await api(`/api/builder/landings/${pageId}/analyze`, tokens.owner);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.cached, true);
    assert.equal(res.body.data.recommendations.length, 2);
    assert.equal(hits.length, hitsBefore, 'a cached answer must not contact the provider');
    assert.equal((await ledger()).length, rowsBefore);
  });

  test('an answer with NO grounded recommendation stores nothing — and the spend is honest', async () => {
    // Age the stored insight past the cooldown rather than deleting it: the
    // next call regenerates, fails grounding, and the OLD insight remains
    // the newest stored one.
    await withTenant(tenantId, (tx) =>
      (tx as any).landingInsight.updateMany({
        where: { landingPageId: pageId },
        data: { createdAt: new Date(Date.now() - INSIGHT_COOLDOWN_MS - 60_000) },
      }),
    );
    const countBefore = await insightCount();
    behaviour.answer = JSON.stringify({
      recommendations: [
        {
          section: 'general',
          finding: 'توصية برقم مخترع بالكامل يجب أن تُرفض قبل التخزين.',
          suggestion: 'لا يجب أن تصل هذه إلى التاجر بأي شكل.',
          metric: 'views',
          value: 31337,
        },
      ],
    });
    const res = await api(`/api/builder/landings/${pageId}/analyze`, tokens.owner);
    assert.equal(res.status, 502, JSON.stringify(res.body));
    assert.equal(res.body.error.code, 'AI_INVALID_OUTPUT');
    assert.equal(await insightCount(), countBefore, 'an ungrounded answer must store nothing');
    // The call happened; the ledger says so, honestly (settled ok — the
    // provider answered; only the grounding failed).
    const rows = await ledger();
    assert.equal(rows.at(-1)!.status, 'ok');
  });

  test('AQ.1 gates this spender too: over the limit is 429 and no model contact', async () => {
    const used = (await ledger()).length;
    await withTenant(tenantId, (tx) =>
      (tx as any).productSetting.create({
        data: { tenantId, product: AI_QUOTA_PRODUCT, key: AI_QUOTA_LIMIT_KEY, value: used },
      }),
    );
    try {
      const hitsBefore = hits.length;
      const res = await api(`/api/builder/landings/${pageId}/analyze`, tokens.owner);
      assert.equal(res.status, 429, JSON.stringify(res.body));
      assert.equal(res.body.error.code, 'AI_QUOTA_EXCEEDED');
      assert.equal(hits.length, hitsBefore);
    } finally {
      await withTenant(tenantId, (tx) =>
        (tx as any).productSetting.deleteMany({
          where: { product: AI_QUOTA_PRODUCT, key: AI_QUOTA_LIMIT_KEY },
        }),
      );
    }
  });

  test('the Traffic screen renders the stored recommendations beside the behavior they analyze', async () => {
    const html = await fetch(BASE + '/console/builder/analytics?days=30', {
      headers: { cookie: `${SESSION_COOKIE}=${tokens.owner}` },
    }).then((r) => r.text());
    assert.ok(html.includes('data-testid="analytics-insights"'));
    assert.ok(html.includes(`data-testid="insight-${pageId}"`));
    assert.ok(html.includes(`data-testid="analyze-page-${pageId}"`));
    // The grounded finding is on the page; the refused one never is.
    assert.ok(html.includes('فُتح 14 مرة'));
    assert.ok(!html.includes('424242'));
  });
});
