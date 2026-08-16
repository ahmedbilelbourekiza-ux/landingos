"use client";

import { StarRating } from "../star-rating";
import type { LandingReviewData } from "@/types/landing";

// Avatar with initials fallback. Review data may not include a photo URL —
// common for COD testimonials — so we derive a clean monogram from the name
// instead of showing a broken image or a generic silhouette.
function Avatar({ name, src }: { name: string; src: string | null }) {
  const initials = name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className="size-10 rounded-full object-cover"
        loading="lazy"
      />
    );
  }
  return (
    <span
      aria-hidden
      className="grid size-10 place-items-center rounded-full bg-muted text-sm font-semibold text-foreground"
    >
      {initials}
    </span>
  );
}

// Social-proof grid. Each card carries the customer's avatar, star rating,
// and testimonial. Layout is a single column on mobile, two columns from
// the sm breakpoint up. The cards render PLAINLY — no scroll-in reveal —
// since LB.49: the framer whileInView entrance held every card at opacity 0
// when its runtime misfired (measured), and testimonials a customer cannot
// see are worse than testimonials that do not stagger in.
export function ReviewsSection({ reviews }: { reviews: LandingReviewData[] }) {
  if (reviews.length === 0) return null;

  return (
    <section id="reviews" className="border-t bg-muted/20">
      <div className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-6 sm:py-20">
        <div className="mb-10 flex flex-col gap-2 text-center">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Customer Reviews
          </span>
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Loved by thousands
          </h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {reviews.map((review) => (
            <figure
              key={review.id}
              className="flex flex-col gap-3 rounded-2xl border bg-card p-5 shadow-sm"
            >
              <div className="flex items-center gap-3">
                <Avatar name={review.customerName} src={review.customerAvatar} />
                <div className="flex flex-col">
                  <figcaption className="text-sm font-medium">
                    {review.customerName}
                  </figcaption>
                  <StarRating value={review.rating} />
                </div>
              </div>
              <blockquote className="text-sm leading-relaxed text-muted-foreground">
                “{review.reviewText}”
              </blockquote>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
