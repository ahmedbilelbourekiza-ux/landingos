import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';

/* =============================================================================
 * test/version-history-loop.test.ts — the render loop behind the live
 * "version history flickers forever" bug (reported 26 Aug 2026).
 *
 * WHAT ACTUALLY HAPPENED. `useBuilderApi()` returned a brand-new closure on
 * every render, so the dialog's `load` callback (deps: [api, landingId]) was
 * new on every render, so its `useEffect` (deps: [open, load]) re-fired after
 * every render while the dialog was open. Each firing fetched and set state;
 * each state change rendered; each render re-fired the effect. One click on
 * "Version history" measured 23+ network requests in eight seconds, the view
 * flashing loading↔ready the whole time and never settling. The loop shipped
 * 20 Aug with LB.14b — VH.1 never touched the dialog — and no suite could see
 * it, because no suite mounted the component: a route test cannot catch a
 * render loop any more than it could catch LB.23b's unreachable button.
 *
 * So this file mounts the REAL component. Not a replica: a copy of the
 * dialog's effect wiring would keep passing while the real file regressed.
 * `support/tsx-loader.mjs` (registered below, per-file, no runner change)
 * resolves the `@/` aliases and transforms the JSX that bare node cannot.
 *
 * THE TWO PINS, from the failure outward:
 *   1. the hook contract — `useBuilderApi` must return a referentially
 *      stable function across re-renders (17 components put it in dep
 *      arrays; identity churn voids every one of them);
 *   2. the observable behaviour — an open dialog fetches its list ONCE and
 *      SETTLES, still showing content and still at one request after time
 *      passes and after parent re-renders. "Loads once" would miss a loop
 *      that loads, flickers and loads again — the settling is the assertion.
 * ========================================================================== */

register('./support/tsx-loader.mjs', import.meta.url);

/* ---- a browser, before react-dom is imported ----------------------------- */

const { Window } = await import('happy-dom');
const win = new Window({ url: 'http://localhost/' });

/* Everything the browser window owns that node lacks, wholesale — the
 * component tree (react-dom, radix, lucide) probes dozens of constructors and
 * a hand-kept list is a whack-a-mole of ReferenceErrors. Functions are bound
 * to the window so `getComputedStyle` and friends keep their `this`. */
for (const key of Object.getOwnPropertyNames(win)) {
  /* The EVENT family is overridden even when node has its own class: a
   * CustomEvent built by node's constructor fails happy-dom's instanceof
   * check at dispatch time (radix dispatches on the document). Nothing else
   * that already exists is touched — a blanket override of uppercase names
   * reaches JS builtins and crashes V8 outright (measured: "Assertion
   * failed: isolate_data"). */
  const isSpecial = ['window', 'document', 'navigator'].includes(key);
  const isEventClass = /Event$/.test(key) || key === 'EventTarget';
  if (key in globalThis && !isSpecial && !isEventClass) continue;
  const value = (win as any)[key];
  try {
    Object.defineProperty(globalThis, key, {
      value: typeof value === 'function' && /^[a-z]/.test(key) ? value.bind(win) : value,
      configurable: true,
      writable: true,
    });
  } catch {
    /* a few globals are locked in newer node; the ones that matter assign */
  }
}

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

/* ---- the real modules, through the loader -------------------------------- */

const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { NextIntlClientProvider } = await import('next-intl');
const { BuilderApiProvider, useBuilderApi } = await import('../src/lib/builder/api-base.tsx');
const { VersionHistoryDialog } = await import(
  '../src/components/landings/edit/version-history-dialog.tsx'
);

const messages = JSON.parse(
  readFileSync(new URL('../../../packages/i18n/src/messages/en.json', import.meta.url), 'utf8'),
);
const h = React.createElement;

/** Mount under the same providers the console gives the editor. */
function mount(node: unknown) {
  const host = win.document.createElement('div');
  win.document.body.appendChild(host);
  const root = createRoot(host as never);
  return {
    root,
    render: (child: unknown) =>
      root.render(
        h(NextIntlClientProvider, { locale: 'en', messages } as never,
          h(BuilderApiProvider, { base: '/api/builder' } as never, child as never)),
      ),
    unmount: () => { root.unmount(); host.remove(); },
    node,
  };
}

/**
 * Let effects fire, fetches resolve, and any loop take another turn.
 *
 * DELIBERATELY NOT wrapped in `act`. `act` drains the update queue until it
 * goes quiet — and a self-sustaining render loop never goes quiet, so the
 * broken code would HANG the whole run inside `act` (measured: a 3-minute
 * timeout with no assertion ever reached) instead of failing the fetch-count
 * assertion below in milliseconds. Plain timer turns let the loop spin freely
 * if it exists and let the fixed code sit still, and the count tells the two
 * apart. The act-environment flag is lowered around the pump so React does
 * not warn about the un-act'ed updates the loop itself schedules.
 */
async function settle(turns = 6) {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = false;
  try {
    for (let i = 0; i < turns; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  } finally {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  }
}

const realFetch = globalThis.fetch;
after(() => { globalThis.fetch = realFetch; });

describe('the useBuilderApi contract', () => {
  test('the returned function is referentially stable across re-renders', async () => {
    const identities: unknown[] = [];
    let forceRender: () => void = () => {};

    function Probe() {
      const api = useBuilderApi();
      identities.push(api);
      const [, setN] = React.useState(0);
      forceRender = () => setN((n: number) => n + 1);
      return null;
    }

    const app = mount(null);
    await (React as any).act(async () => { app.render(h(Probe)); });
    await (React as any).act(async () => { forceRender(); });
    await (React as any).act(async () => { forceRender(); });

    assert.ok(identities.length >= 3, `expected at least 3 renders, saw ${identities.length}`);
    // The whole bug: a new identity per render voids every dependency array
    // holding this function. One identity, however many renders.
    assert.equal(new Set(identities).size, 1);
    app.unmount();
  });
});

describe('the version history dialog', () => {
  test('an open dialog fetches once and SETTLES — no loop, no flicker', async () => {
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return {
        json: async () => ({
          success: true,
          data: {
            versions: [
              { id: 'v1', reason: 'edit', actorName: 'Bilel', createdAt: '2026-08-20T10:00:00Z' },
            ],
          },
        }),
      };
    }) as never;

    let rerenderParent: () => void = () => {};
    function Host() {
      // The dialog lives inside a busy editor; a parent render must not
      // re-trigger its load. This is the "settles" half of the pin.
      const [, setN] = React.useState(0);
      rerenderParent = () => setN((n: number) => n + 1);
      return h(VersionHistoryDialog, {
        open: true,
        onOpenChange: () => {},
        landingId: 'page-1',
      } as never);
    }

    /* The mount is NOT wrapped in `act` for the same reason `settle` is not:
     * on looping code the very first render's effect chain never goes quiet,
     * and `act` would hang the suite instead of reaching the assertion. */
    const app = mount(null);
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = false;
    app.render(h(Host));
    await settle();

    // Loaded once…
    assert.equal(fetchCalls, 1, `expected ONE list fetch, saw ${fetchCalls} — the loop is back`);
    // …and showing the list, not a spinner: the loop's symptom was flashing
    // back to loading, so "still rendering content after time passed" is the
    // assertion, not just "fetched once".
    const text = win.document.body.textContent ?? '';
    assert.ok(text.includes('Bilel'), 'the loaded version row is visible');

    // Time passes, the parent renders twice more — still one fetch, still
    // the same content on screen.
    rerenderParent();
    await settle(2);
    rerenderParent();
    await settle();

    assert.equal(fetchCalls, 1, `a re-render re-fired the load effect (${fetchCalls} fetches)`);
    assert.ok((win.document.body.textContent ?? '').includes('Bilel'));
    app.unmount();
  });

  test('reopening fetches again — once per open, not once ever', async () => {
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return { json: async () => ({ success: true, data: { versions: [] } }) };
    }) as never;

    let setOpen: (open: boolean) => void = () => {};
    function Host() {
      const [open, set] = React.useState(true);
      setOpen = set;
      return h(VersionHistoryDialog, {
        open,
        onOpenChange: set,
        landingId: 'page-1',
      } as never);
    }

    const app = mount(null);
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = false;
    app.render(h(Host));
    await settle();
    assert.equal(fetchCalls, 1);

    setOpen(false);
    await settle(2);
    setOpen(true);
    await settle();

    // The close/reopen is a deliberate refresh point — and exactly one.
    assert.equal(fetchCalls, 2, `expected one fetch per open, saw ${fetchCalls}`);
    app.unmount();
  });
});
