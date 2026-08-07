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

/* --- oklch, for the tokens that are not hex ------------------------------
 *
 * PM.6. The status palette is hex and was measurable from the day this file was
 * written; the GROUND — background, surfaces, borders and the two greys an
 * operator reads secondary text in — is `oklch(...)` and was measurable by
 * nobody. So the one contrast question an eight-hour reader actually has ("can
 * I read the caption under this figure") was the one question the contrast test
 * could not ask, and the answer drifted for four passes until somebody
 * measured the running page by hand.
 *
 * Roughly forty lines of colour maths buys the whole ground under the same
 * mechanical rule the status chips already have. AUDIT.8's principle:
 * mechanical, not vigilant.
 * ---------------------------------------------------------------------- */

function oklchToRgb(value: string): [number, number, number] | null {
  const m = value
    .trim()
    .match(/^oklch\(\s*([\d.]+)%?\s+([\d.]+)\s+([\d.]+)\s*\)$/i);
  if (!m) return null;
  const Lraw = Number(m[1]);
  const L = value.includes('%') ? Lraw / 100 : Lraw;
  const C = Number(m[2]);
  const hDeg = Number(m[3]);
  const h = (hDeg * Math.PI) / 180;

  // Oklab → LMS' → LMS → linear sRGB (Björn Ottosson's matrices).
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ ** 3;
  const mm = m_ ** 3;
  const s = s_ ** 3;

  const lr = +4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s;
  const lg = -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s;
  const lb = -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s;

  const gamma = (c: number) => {
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
    // Clamp rather than reject: a token slightly outside the sRGB gamut is
    // still what a browser will paint, and refusing to measure it would mean
    // the assertion silently skips the value it was written for.
    return Math.round(Math.min(1, Math.max(0, v)) * 255);
  };

  return [gamma(lr), gamma(lg), gamma(lb)];
}

/** A token in either notation. `null` for anything neither parser understands. */
function toRgb(value: string | undefined): [number, number, number] | null {
  if (!value) return null;
  return hexToRgb(value) ?? oklchToRgb(value);
}

function ratio(a: string | undefined, b: string | undefined): number | null {
  const ra = toRgb(a);
  const rb = toRgb(b);
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

describe('the ground is legible, and stays that way (PM.6)', () => {
  for (const theme of ['light', 'dark'] as const) {
    const tokens = theme === 'light' ? light : dark;
    const surfaces = ['--background', '--surface-raised', '--surface-subtle'] as const;

    test(`${theme}: the oklch parser resolved the ground`, () => {
      // A parser that silently returns null makes every assertion below vacuous
      // — the same failure the access suite guards with "the glob found
      // something".
      for (const name of [...surfaces, '--foreground', '--muted-foreground']) {
        assert.ok(toRgb(tokens.get(name)), `${theme} ${name} = ${tokens.get(name)} did not parse`);
      }
    });

    for (const surface of surfaces) {
      test(`${theme}: secondary text on ${surface} clears 4.5:1`, () => {
        const r = ratio(tokens.get('--muted-foreground'), tokens.get(surface));
        assert.ok(r !== null);
        assert.ok(
          r! >= 4.5,
          `${theme}: --muted-foreground on ${surface} is ${r!.toFixed(2)}:1. ` +
            'Most of a dense console is read in this colour.',
        );
      });
    }

    test(`${theme}: body text clears AAA on the page ground`, () => {
      const r = ratio(tokens.get('--foreground'), tokens.get('--background'));
      assert.ok(r! >= 7, `${theme}: --foreground is ${r!.toFixed(2)}:1`);
    });

    test(`${theme}: an unavailable control cannot be mistaken for secondary text`, () => {
      /* THE DEFECT THIS EXISTS FOR. Disabled controls were `opacity: 0.5`,
       * which puts a label at whatever grey sits halfway to the background —
       * and that is precisely where `--muted-foreground` lives. So a caption
       * and a control nobody may press were the same colour, and the operator
       * had to work out which one was information.
       *
       * Both halves are asserted. The disabled grey must be MEASURABLY weaker
       * than secondary text, so the two can never converge again; and it must
       * still clear 3:1, because "unavailable" is not the same instruction as
       * "invisible" — somebody has to be able to read WHICH control is off. */
      const mutedOnSurface = ratio(tokens.get('--muted-foreground'), tokens.get('--surface-raised'))!;
      const disabledOnBox = ratio(
        tokens.get('--control-disabled-fg'),
        tokens.get('--control-disabled-bg'),
      );
      assert.ok(disabledOnBox !== null, `${theme}: --control-disabled-fg/bg did not parse`);
      assert.ok(
        disabledOnBox! <= mutedOnSurface * 0.72,
        `${theme}: disabled text is ${disabledOnBox!.toFixed(2)}:1 against secondary text's ` +
          `${mutedOnSurface.toFixed(2)}:1 — too close to tell apart`,
      );
      assert.ok(
        disabledOnBox! >= 3,
        `${theme}: disabled text is ${disabledOnBox!.toFixed(2)}:1 — inert is not the same as illegible`,
      );
    });

    test(`${theme}: a raised surface is distinguishable from the page`, () => {
      const raised = toRgb(tokens.get('--surface-raised'))!;
      const ground = toRgb(tokens.get('--background'))!;
      assert.notDeepEqual(
        raised,
        ground,
        `${theme}: a card that is the same colour as the page is an outline, not a surface`,
      );
    });

    test(`${theme}: a hovered row is distinguishable from a raised one`, () => {
      // Not a contrast threshold — a hover tint is deliberately quiet. What
      // must hold is that it differs at all, because the ERP's tables have no
      // zebra and hover is the only thing tracking a row across nine columns.
      assert.notEqual(tokens.get('--surface-hover'), tokens.get('--surface-raised'));
      assert.notEqual(tokens.get('--surface-hover'), tokens.get('--surface-selected'));
    });
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
        // A trailing digit is admissible — `tentative1` is a status the ERP
        // ships, and the leaf mirrors it. The property being asserted is that a
        // label is a KEY and not a human string, and that still bites: "Attempt
        // 1" has a space and no dots, and any Arabic literal fails on the first
        // character.
        assert.match(
          d.labelKey,
          /^status\.[a-zA-Z]+\.[a-zA-Z][a-zA-Z0-9]*$/,
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
