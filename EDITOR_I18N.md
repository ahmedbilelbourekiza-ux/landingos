# EDITOR_I18N — LB.13, the landing editor learns Arabic and French

**Started:** 11 August 2026 · **Closes:** `BUILDER_AUDIT.md` M-04 ("The editor
speaks English in a French/Arabic console") · **Method:** the standing order,
per slice — measure → fix → test → verify live in `ar` (RTL) **and** `fr` (LTR)
→ commit → update this document.

This file is the slice log. `NEXT_STEPS.md` and `HANDOFF_PRODUCTION.md` §5 point
at it and are updated once, at the end.

---

## §0 THE MEASUREMENT, TAKEN FIRST — and it corrects the audit

M-04 says *"The 54 editor components and the create screen are untranslated."*
Measured on 11 Aug against the running app, that sentence is wrong in two ways
and the difference is most of the work:

**1. The create screen is already done.** `/console/builder/pages/new` and
`NewLandingForm` read `builder.newPage.*` in all three locales. Closed by the
LB.10/UI work; nothing to do.

**2. Ten of the components are dead code.** An import-graph walk from every
entry under `app/` (`scratchpad/reachability.mjs`, method recorded below) says
**48 of the 58 files under `components/landings/` are reachable and 10 are
not**. The unreachable ten are the LEGACY dashboard's page LIST — the console's
pages screen was rebuilt as a server component (`app/console/builder/(shell)/
pages/page.tsx`) that renders `DataTable` and never imports any of them:

```
landings/filter-tabs.tsx          landings/landing-card.tsx
landings/sort-select.tsx          landings/landing-table.tsx
landings/search-bar.tsx           landings/landings-header.tsx
landings/landing-empty-state.tsx  landings/landing-actions-menu.tsx
landings/landing-status-badge.tsx edit/sections/media-picker-dialog.tsx
```

They are imported only by each other (`landing-card` → `landing-actions-menu`,
`landing-status-badge`; nothing imports `landing-card`). **They are not
translated** — translating a screen no one can open is worse than leaving it,
because it makes the dead code look maintained. They are removal candidates and
are listed in §3 for the user's decision, in the shape `CAPABILITY_AUDIT.md` §2
uses.

**So LB.13's real scope is the 48 live editor components.** A conservative scan
(`scratchpad/scan2.mjs`: JSX text, user-facing props, zod/toast messages,
display ternaries; comments and Tailwind strings excluded) found **166
hardcoded strings across 32 of them** — a LOWER bound, because multi-line JSX
prose escapes a line-oriented scan (`edit-sections.tsx`'s integrations
paragraph did, and so did the header's `Unsaved Changes` badge).

### The mechanism this extends — nothing new was invented

- Catalogues: `packages/i18n/src/messages/{en,fr,ar}.json`, exactly
  `JSON.stringify(x, null, 2) + "\n"` (verified by round-trip, so a scripted
  key insertion produces a minimal diff).
- `app/layout.tsx` wraps everything in `NextIntlClientProvider` **rendered from
  a Server Component**, and next-intl's `NextIntlClientProviderServer` fills
  `messages` from `getMessages()` when the prop is absent. So the catalogue is
  already on the client and `useTranslations()` works in any editor component.
  `app/console/error.tsx` was the only existing client consumer; it is the
  precedent, not a new pattern.
- Server screens keep `getTranslations` / `requireProduct`'s `t` and pass
  `labels` props. The editor is `"use client"` top to bottom, so it uses the
  hook — the same catalogue, the other door.
- New keys live under **`builder.editor.*`**, beside `builder.newPage.*`.
- Terminology is taken from what the console already says, not invented:
  `builder.templates.hint` already names the editor's **General** section as
  «Général» / «عام» in both locales, `builder.newPage.slugLabel` already calls
  a slug an **Address** / «Adresse» / «عنوان الويب», `settings.homeDelivery` /
  `settings.stopDesk` already fix the shipping vocabulary, and page status
  reuses `status.landingPage.*` so the editor and the pages list cannot
  disagree about the same row.

---

## §1 SLICES

| # | Slice | Files | State |
|---|---|---|---|
| **LB.13a** | Editor shell + section frame + the save path's error text | 15 | **DONE** — see §2 |
| **LB.13b** | General, Pricing, SEO | 3 | pending |
| **LB.13c** | Images & Media, Landing page images, image card, avatar picker | 4 | pending |
| **LB.13d** | Variants, Shipping, Order form (+ `FIELD_DEFS`) | 6 | pending |
| **LB.13e** | Benefits, Reviews, FAQ, Display | 6 | pending |
| **LB.13f** | The live preview components | 8 | pending — carries a decision, §3 |

---

## §2 SLICE LOG

### LB.13a — the shell, the frame, and the sentence a failed save says

**Fixed.** `edit-workspace-header` (back, preview, copy link, open,
publish/update, the DRAFT/PUBLISHING/PUBLISHED badge), `publish-dialog`,
`leave-warning-dialog`, `preview-panel`, `preview-drawer`,
`preview-device-toggle`, `section/{save,cancel}-button`, `section-status`,
`unsaved-indicator`, `section-coming-soon`, and `edit-sections`'s registry —
whose 13 title/description pairs became **keys**, so the registry and each
section's own `SectionShell` now reference one string instead of holding two
copies free to disagree. The integrations signpost keeps its sentence and its
link as two keys rather than composed rich text: nothing else in this console
puts markup through the catalogue, and a translator handed a tag is how a
locale ends up with a broken one.

**The structural gap it found, and closed.** Every one of the twelve sections
did `throw new Error(json.error?.message || "Save failed")` and the footer
rendered that. `json.error.message` is the platform envelope's DEVELOPER-facing
sentence — English by contract, and `lib/console/action-errors.ts` states the
rule in its own header: *the screen keys off the CODE*. So a failed save in an
Arabic console said "Only a manager can change that." in English, and a dropped
connection said "Save failed". Now `refuseIfFailed(json)` throws an `ApiRefusal`
carrying only the code, and `useSectionState` resolves it through
`actionErrors(t)` — the same map every other console write already uses.
`actionErrors` is deliberately not `server-only` for exactly this case. Three
outcomes, said three different ways because the fix differs: a named refusal, a
`fetch` rejection (a `TypeError` by spec — the request never left), and a bug
here, which gets the honest generic sentence rather than a lie about the
network.

**Also fixed, because they are strings the editor's own dialogs say:** the
`sr-only` "Close" in `components/ui/{dialog,sheet}.tsx` → `common.close`.

**Tests.** i18n 20/20 · builder-sections 58/58 · console-shell 20/20.
`npx tsc --noEmit` — 6 errors in this tree before the slice and the same 6
after (all pre-existing react-hook-form/zod typing, none on a changed line).

**Verified live**, against build `abHh3i18K5PHWtQoALHrw`, on a published demo
page, in both directions:

- `ar` / `dir=rtl`: header `منشور · معاينة · نسخ الرابط · فتح · تحديث`, back
  button `aria-label="العودة إلى صفحات الهبوط"`; preview panel `معاينة`,
  device group `جهاز المعاينة: حاسوب/هاتف`, `فتح الصفحة المنشورة`;
  integrations card Arabic end to end.
- `fr` / `dir=ltr`: `Publié · Aperçu · Copier le lien · Ouvrir · Mettre à jour`,
  `Retour aux pages de vente`, `Appareil d'aperçu: Ordinateur/Mobile`.
- **Interactive elements opened and measured**, per the rule that presence is
  not correctness: publish dialog 486×162 («Mettre à jour cette page ?» + body
  + `Annuler`/`Mettre à jour`); preview drawer 768×720 («Aperçu en direct», its
  `sr-only` description, close button now «Fermer»); leave dialog
  («Modifications non enregistrées» + `Rester`/`Quitter quand même`).
- **The dirty and error states, driven for real.** Typing in the title gave
  `Non enregistré` / «غير محفوظ» in the section header and a 878×65 footer of
  `Annuler | Enregistrer` / `إلغاء | حفظ`. Stubbing `fetch` to reject on the
  save produced badge `Erreur` / «خطأ» and the message «Serveur injoignable.
  Rien n'a été enregistré.» / «تعذّر الوصول إلى الخادم. لم يُحفظ أي شيء.» —
  the sentence that used to read "Save failed". In RTL the footer's buttons
  measured flush to the footer's LEFT edge (x=401/508 inside x=377..1245), so
  `justify-end` resolved logically.
- Nothing was written: every save attempt was the stubbed failure, and the
  page's title reads `minimalist` unchanged after reload.

**A defect found by verifying rather than by reading — `rtl:` emits no CSS.**
The back arrow was given `rtl:rotate-180`; the running page showed
`transform: none`, and a walk of every rule in the served stylesheet found **no
rule for it at all**. `globals.css` declares only `@custom-variant dark`, and
Tailwind v4 ships no `rtl` variant, so the utility is silently dropped. The
class was removed rather than shipped as a no-op. **Two files already carry the
same dead classes** — `console/data-table.tsx` (`rtl:-scale-x-100` on the
expand chevron) and `ui/calendar.tsx` (two `rtl:**:…:rotate-180`) — see §3.
This is Phase UI's rule arriving from a new direction: *a Tailwind class must be
verified in the running page.*

**One real RTL fix that does emit CSS:** the unsaved badge's icon was `mr-1`, a
physical margin in an app that flips, so in Arabic it pushed the icon away from
its own label. Now `me-1` (`.me-1{margin-inline-end:var(--spacing)}` confirmed
present in the built stylesheet).

---

## §3 FLAGGED — the user's decisions, not guesses

1. **The ten dead legacy components (§0).** Not translated. Removal candidate:
   they are the pre-console page list, superseded by the server-rendered
   screen, and reachable from nothing. *Decision: delete, or keep and say why.*
2. **`rtl:` is a dead variant across the app.** Three existing usages emit
   nothing (`data-table.tsx`, `calendar.tsx` ×2). The fix is one line in
   `globals.css` — `@custom-variant rtl (&:where([dir="rtl"], [dir="rtl"] *));`
   — but it would immediately change the ERP data table and the date picker in
   Arabic, screens this work does not verify. *Decision: own slice, or leave.*
3. **`ui/sheet.tsx` closes on a physical edge.** Its close button is
   `absolute top-4 right-4`, so in Arabic it sits on the far side from where a
   reader reaches. `end-4` is the fix, and it would also move the **mobile
   navigation drawer's** close button — a screen the UI/UX pass verified on a
   real device. *Decision: separate slice with its own device check.*
