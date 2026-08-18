"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { recordFaqOpen } from "@/components/landing/visit-beacon";
import type { LandingFAQData } from "@/types/landing";

// Custom accordion built on a single open-item pattern. Native <button> +
// region + aria-expanded keeps it fully accessible and keyboard-operable;
// the open answer fades in via CSS (LB.49 — the framer height tween gated
// the collapse on its runtime, and a wedged exit held a "closed" answer
// visible; a conditional mount cannot). Only one item opens at a time —
// cleaner for FAQ UX than multiple simultaneous openings.
function FAQItem({
  faq,
  isOpen,
  onToggle,
}: {
  faq: LandingFAQData;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const panelId = `faq-panel-${faq.id}`;
  const buttonId = `faq-button-${faq.id}`;

  return (
    <div className="border-b">
      <h3>
        <button
          id={buttonId}
          type="button"
          aria-expanded={isOpen}
          aria-controls={panelId}
          onClick={onToggle}
          className="flex w-full items-center justify-between gap-4 py-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-md"
        >
          <span className="text-[15px] font-medium">{faq.question}</span>
          <ChevronDown
            className={cn(
              "size-5 shrink-0 text-muted-foreground transition-transform duration-300",
              isOpen && "rotate-180",
            )}
            aria-hidden
          />
        </button>
      </h3>
      {isOpen && (
        <div
          id={panelId}
          role="region"
          aria-labelledby={buttonId}
          className="landing-fade overflow-hidden"
        >
          <p className="pb-5 text-sm leading-relaxed text-muted-foreground">
            {faq.answer}
          </p>
        </div>
      )}
    </div>
  );
}

export function FAQSection({ faqs }: { faqs: LandingFAQData[] }) {
  const [openId, setOpenId] = React.useState<string | null>(
    faqs[0]?.id ?? null,
  );

  if (faqs.length === 0) return null;

  return (
    <section id="faq" data-bh-section="faq" className="border-t">
      <div className="mx-auto w-full max-w-3xl px-4 py-14 sm:px-6 sm:py-20">
        <div className="mb-10 flex flex-col gap-2 text-center">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            FAQ
          </span>
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Questions, answered
          </h2>
        </div>
        <div className="border-t">
          {faqs.map((faq) => (
            <FAQItem
              key={faq.id}
              faq={faq}
              isOpen={openId === faq.id}
              onToggle={() => {
                // BH.1 — an OPENED question is a customer doubt, by id.
                // Closing one records nothing; no-op unless opted in. Outside
                // the updater: an updater must stay pure (strict mode
                // double-invokes it).
                if (openId !== faq.id) recordFaqOpen(faq.id);
                setOpenId((prev) => (prev === faq.id ? null : faq.id));
              }}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
