"use client";

import * as React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MONEY_PATTERN, readTypedMoney } from "@/lib/landing/money-field";
import { currencySymbol } from "@/lib/landing/format";
import type { VariantOption } from "@/lib/landing/mock-landings";

// One sortable option row inside a variant group. The drag handle uses
// dnd-kit listeners; the label and extra-price inputs stop pointer events
// so they don't trigger a drag when the user clicks into them.
export function VariantOptionRow({
  option,
  index,
  currency,
  priceLocked = false,
  onChange,
  onRemove,
}: {
  option: VariantOption;
  index: number;
  currency: string;
  /** VP.1 — another group already carries own prices, so this one cannot. */
  priceLocked?: boolean;
  onChange: (id: string, patch: Partial<VariantOption>) => void;
  onRemove: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: option.id });
  const t = useTranslations();

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  /* The row holds the TEXT being typed and hands the group the number.
   * An input driven straight off `option.extraPrice` cannot hold "500," for
   * the keystroke between "500" and "500,75": the number parses back to 500
   * and the separator vanishes under the cursor, so a decimal supplement was
   * unenterable. The prop still wins whenever it disagrees with what the text
   * says — a cancel, a reload, or a fresh option resets the box. */
  const [priceText, setPriceText] = React.useState(() =>
    option.extraPrice ? String(option.extraPrice) : "",
  );
  React.useEffect(() => {
    if ((readTypedMoney(priceText) ?? 0) !== option.extraPrice) {
      setPriceText(option.extraPrice ? String(option.extraPrice) : "");
    }
    // Only when the STORED value moves: naming `priceText` here would undo
    // every keystroke that has not yet parsed to a different number.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [option.extraPrice]);

  /* VP.1 — the option's OWN price, held as text for the same keystroke reason.
   * Empty is meaningful here, unlike the supplement: it means "the product
   * price", so it is kept as null rather than read as 0 — a blank box must
   * never turn into a free variant. */
  const ownText = (p: number | null | undefined) => (p === null || p === undefined ? "" : String(p));
  const [ownPriceText, setOwnPriceText] = React.useState(() => ownText(option.price));
  React.useEffect(() => {
    if ((readTypedMoney(ownPriceText) ?? null) !== (option.price ?? null)) {
      setOwnPriceText(ownText(option.price));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [option.price]);
  const hasOwn = option.price !== null && option.price !== undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        // Wraps: with the own-price box (VP.1) a phone-width row cannot hold
        // five controls, and squeezing them hid the option label entirely.
        "flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2",
        isDragging && "z-10 opacity-80 shadow-md",
      )}
    >
      {/* Drag handle */}
      <button
        type="button"
        className="grid size-7 shrink-0 cursor-grab place-items-center text-muted-foreground active:cursor-grabbing"
        aria-label={t("builder.editor.dragOption", { number: index + 1 })}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>

      {/* Label */}
      <Input
        type="text"
        value={option.label}
        placeholder={t("builder.editor.optionLabelPlaceholder")}
        aria-label={t("builder.editor.optionLabelAria", { number: index + 1 })}
        onPointerDown={(e) => e.stopPropagation()}
        onChange={(e) => onChange(option.id, { label: e.target.value })}
        className="h-8 min-w-0 flex-1 basis-24"
      />

      {/* Own price (VP.1). Same text-with-decimal-keypad treatment as the
          supplement beside it; the placeholder says what empty means. Locked
          when another group already carries prices — own prices live on one
          group, and the group says which. */}
      <Input
        type="text"
        inputMode="decimal"
        dir="ltr"
        pattern={MONEY_PATTERN}
        value={ownPriceText}
        disabled={priceLocked && !hasOwn}
        placeholder={t("builder.editor.optionOwnPricePlaceholder")}
        aria-label={t("builder.editor.optionOwnPriceAria", { number: index + 1 })}
        data-testid="variant-option-price"
        onPointerDown={(e) => e.stopPropagation()}
        onChange={(e) => {
          const raw = e.target.value;
          const read = readTypedMoney(raw);
          if (read === null) return;
          setOwnPriceText(raw);
          // An own price replaces the supplement on this row (the PUT zeroes
          // it too), so the "+" box clears rather than silently counting twice.
          onChange(option.id, read === undefined
            ? { price: null }
            : { price: Math.max(0, read), extraPrice: 0 });
        }}
        className="h-8 w-24 tabular-nums sm:w-28"
      />

      {/* Extra price. Text with a decimal keypad, never `type="number"` —
          `extraPrice` is a `Decimal` column (M-05 / D-06) and the spinner this
          replaces stepped by 1, so nudging a 500.75 supplement rounded the
          centimes away. `dir="ltr"`: a price reads left-to-right in Arabic
          too, and no `rtl:` utility may go inside this island (LB.28).
          Text that cannot be read is left at the last good value rather than
          silently becoming 0 — `Number("500,75") || 0` was a free supplement
          on a product that charges for one. */}
      {/* VP.1b — the add-on reads as MONEY, never as a quantity: a bare
          "+ 0" beside a price was taken for stock. On wide screens the
          group's column header names it ("Add-on (DA)"); on a phone, where
          rows wrap and the header is hidden, the currency sits beside it.
          Disabled on a row with its own price — the reason is said in the
          note under the row and the tooltip, not left to a grey box. */}
      <div className="flex w-24 items-center gap-1">
        <span className="text-xs text-muted-foreground" aria-hidden>+</span>
        <Input
          type="text"
          inputMode="decimal"
          dir="ltr"
          pattern={MONEY_PATTERN}
          value={priceText}
          disabled={hasOwn}
          placeholder={hasOwn ? "—" : "0"}
          title={hasOwn ? t("builder.editor.addOnUnusedNote") : undefined}
          data-testid="variant-option-addon"
          aria-label={t("builder.editor.optionPriceAria", { number: index + 1 })}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => {
            const raw = e.target.value;
            const read = readTypedMoney(raw);
            // Unreadable text is refused at the keystroke — it never reaches
            // the box and never reaches the group, so a stray letter cannot
            // turn a paid option into a free one the way `Number(…) || 0` did.
            if (read === null) return;
            setPriceText(raw);
            onChange(option.id, { extraPrice: Math.max(0, read ?? 0) });
          }}
          className="h-8 w-20 tabular-nums"
        />
        <span className="text-xs text-muted-foreground sm:hidden" aria-hidden>
          {currencySymbol(currency)}
        </span>
      </div>

      {/* Remove */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
        aria-label={t("builder.editor.removeOption", { number: index + 1 })}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => onRemove(option.id)}
      >
        <X className="size-4" />
      </Button>

      {/* VP.1b — why the add-on is grey, in words, on the row it concerns. */}
      {hasOwn && (
        <p className="basis-full ps-9 text-[11px] text-muted-foreground" data-testid="variant-addon-unused">
          {t("builder.editor.addOnUnusedNote")}
        </p>
      )}
    </div>
  );
}
