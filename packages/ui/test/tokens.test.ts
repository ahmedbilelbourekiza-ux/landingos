import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  STATUS_REGISTRIES,
  resolveStatus,
  toneVars,
  type StatusTone,
} from '../src/status.ts';

/* =============================================================================
 * Keeps the console design system honest.
 *
 * Two classes of assertion, both mechanical:
 *
 *   Contrast — every status foreground is measured against its own tint, in
 *   BOTH themes, and must clear WCAG AA. Computed here rather than eyeballed,
 *   because "looks fine on my monitor" is how a palette ends up unreadable for
 *   somebody else.
 *
 *   Coverage — every status either product can produce resolves to a tone, and
 *   both themes define every token the other does. A tone defined only in
 *   light is a chip that vanishes in dark.
 * ========================================================================== */

const CSS = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'tokens.css'), 'utf8');

const TONES: StatusTone[] = ['success', 'warning', 'danger', 'info', 'progress', 'neutral'];

/** Pull a block's custom properties into a map. */
function tokensIn(selector: string): Map<string, string> {
  const re = new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([\\s\\S]*?)\\n\\}`);
  const body = CSS.match(re)?.[1] ?? '';
  const out = new Map<string, string>();
  for (const m of body.matchAll(/^\s*(--[a-z0-9-]+):\s*([^;]+);/gm)) {
    out.set(m[1], m[2].trim());
  }
  return out;
}

const light = tokensIn(':root');
const dark = tokensIn('.dark');

/* --- WCAG relative luminance / contrast, for hex values ------------------- */

function hexToRgb(hex: string): [number, number, number] | null {
  const m = hex.trim().match(/^#([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance([r, g, b]: [number, number, number]): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: string, b: string): number | null {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  if (!ra || !rb) return null;
  const [l1, l2] = [luminance(ra), luminance(rb)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

describe('the token file parsed', () => {
  test('both themes define tokens', () => {
    assert.ok(light.size > 30, `light theme has ${light.size} tokens`);
    assert.ok(dark.size > 25, `dark theme has ${dark.size} tokens`);
  });
});

describe('status colours are legible (WCAG AA)', () => {
  for (const theme of ['light', 'dark'] as const) {
    const tokens = theme === 'light' ? light : dark;

    for (const tone of TONES) {
      test(`${theme}: ${tone} text on its own tint clears 4.5:1`, () => {
        const fg = tokens.get(`--${tone}-fg`);
        const bg = tokens.get(`--${tone}-bg`);
        assert.ok(fg, `--${tone}-fg is defined in ${theme}`);
        assert.ok(bg, `--${tone}-bg is defined in ${theme}`);

        const ratio = contrast(fg!, bg!);
        assert.ok(ratio !== null, `--${tone}-fg/bg must be hex in ${theme} to be measurable`);
        assert.ok(
          ratio! >= 4.5,
          `${theme} ${tone}: ${fg} on ${bg} is ${ratio!.toFixed(2)}:1, below the 4.5:1 minimum`,
        );
      });
    }
  }
});

describe('brand and danger stay distinguishable (R-14)', () => {
  test('they are not the same colour', () => {
    // Crimson IS a red. If these ever converge, a Cancel button and a
    // "cancelled" chip become the same thing at a glance.
    assert.notEqual(light.get('--primary'), light.get('--danger-fg'));
    assert.notEqual(dark.get('--primary'), dark.get('--danger-fg'));
  });

  test('danger is the brighter of the two in the light theme', () => {
    // The separation that actually does the work: brand crimson is deep and
    // carries white text on a filled button; danger is brighter and appears as
    // text on a pale tint. Different lightness, different form.
    const brand = hexToRgb(light.get('--primary')!)!;
    const danger = hexToRgb(light.get('--danger-fg')!)!;
    assert.ok(
      luminance(danger) > luminance(brand),
      'danger must read brighter than brand crimson, or the two compete',
    );
  });

  test('gold is not a console token', () => {
    // #D4AF37 is the storefront accent under D3 and was the ERP's "pending".
    // One value cannot mean "brand" in one product and "waiting" in another.
    const all = [...light.values(), ...dark.values()].join(' ').toLowerCase();
    assert.ok(!all.includes('#d4af37'), 'gold belongs to packages/templates, not the console');
  });
});

describe('the two themes stay in step', () => {
  test('every status token in light exists in dark', () => {
    const missing: string[] = [];
    for (const tone of TONES) {
      for (const part of ['fg', 'bg', 'border']) {
        const key = `--${tone}-${part}`;
        if (light.has(key) && !dark.has(key)) missing.push(key);
      }
    }
    assert.deepEqual(missing, [], 'a token defined only in light is a chip that vanishes in dark');
  });

  test('every tone is complete in both themes', () => {
    const incomplete: string[] = [];
    for (const [name, tokens] of [['light', light], ['dark', dark]] as const) {
      for (const tone of TONES) {
        for (const part of ['fg', 'bg', 'border']) {
          if (!tokens.has(`--${tone}-${part}`)) incomplete.push(`${name}:--${tone}-${part}`);
        }
      }
    }
    assert.deepEqual(incomplete, []);
  });
});

describe('the status vocabulary covers both products', () => {
  test('every registered status resolves to a real tone', () => {
    for (const [registry, entries] of Object.entries(STATUS_REGISTRIES)) {
      for (const [status, descriptor] of Object.entries(entries)) {
        assert.ok(
          TONES.includes(descriptor.tone),
          `${registry}.${status} has tone "${descriptor.tone}", which is not one of the six`,
        );
      }
    }
  });

  test('every label is an i18n key, never a literal', () => {
    // The rule that keeps Phase 6 from having to be reopened: the ERP already
    // has ~2,300 hardcoded Arabic strings waiting (R-13), and this is where
    // that stops being added to.
    for (const [registry, entries] of Object.entries(STATUS_REGISTRIES)) {
      for (const [status, d] of Object.entries(entries)) {
        assert.match(
          d.labelKey,
          /^status\.[a-zA-Z]+\.[a-zA-Z]+$/,
          `${registry}.${status} label "${d.labelKey}" is not a dotted i18n key`,
        );
      }
    }
  });

  test('the same concept gets the same tone across products', () => {
    // The point of a shared vocabulary. An order the customer sees as
    // CONFIRMED and the same order in the ERP must not be two different
    // colours in two tabs of one product.
    assert.equal(
      STATUS_REGISTRIES.salesOrder.CONFIRMED.tone,
      STATUS_REGISTRIES.confirmation.confirmed.tone,
    );
    assert.equal(
      STATUS_REGISTRIES.salesOrder.CANCELLED.tone,
      STATUS_REGISTRIES.confirmation.cancelled.tone,
    );
    assert.equal(
      STATUS_REGISTRIES.salesOrder.DELIVERED.tone,
      STATUS_REGISTRIES.delivery.delivered.tone,
    );
  });

  test('everything in motion shares one tone', () => {
    // Four shades of "on its way" is four things to learn; one is a glance.
    const moving = ['dispatched', 'in_transit', 'out_for_delivery'];
    const tones = new Set(moving.map((s) => STATUS_REGISTRIES.delivery[s].tone));
    assert.deepEqual([...tones], ['progress']);
  });
});

describe('unknown statuses degrade safely', () => {
  test('an unrecognised status is neutral and flagged, not guessed', () => {
    const r = resolveStatus('delivery', 'teleported');
    assert.equal(r.tone, 'neutral');
    assert.equal(r.known, false);
    // Guessing a tone would be worse than admitting we do not have one: a
    // wrongly-green failure is invisible in exactly the way that matters.
  });

  test('null and undefined do not throw', () => {
    assert.equal(resolveStatus('confirmation', null).known, false);
    assert.equal(resolveStatus('confirmation', undefined).known, false);
  });

  test('a known status is reported as known', () => {
    const r = resolveStatus('confirmation', 'confirmed');
    assert.equal(r.tone, 'success');
    assert.equal(r.known, true);
  });
});

describe('tones resolve to CSS variables, not literal colours', () => {
  test('toneVars returns custom properties', () => {
    // Components must never bake a hex value in, or the theme toggle stops
    // working for exactly the elements that carry the most meaning.
    const v = toneVars('danger');
    assert.equal(v.color, 'var(--danger-fg)');
    assert.equal(v.backgroundColor, 'var(--danger-bg)');
    assert.equal(v.borderColor, 'var(--danger-border)');
  });
});
