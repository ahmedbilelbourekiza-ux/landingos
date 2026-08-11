"use client";

import * as React from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Star, Plus, AlertCircle } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { type ReviewItem } from "@/lib/landing/mock-reviews";
import {
  SectionShell,
  useSectionState,
  refuseIfFailed,
} from "@/components/landings/edit/section";
import { ReviewCardEditor } from "./review-card-editor";
import { AvatarPickerDialog } from "./avatar-picker-dialog";
import { useBuilderApi } from "@/lib/builder/api-base";

export interface ReviewsPreviewValues {
  reviews: ReviewItem[];
}

const MAX_REVIEWS = 20;

export function ReviewsSection({
  landingId,
  initialValues,
  onPreviewChange,
}: {
  landingId: string;
  initialValues: ReviewsPreviewValues;
  onPreviewChange: (values: ReviewsPreviewValues) => void;
}) {
  // Where this editor sends its requests. The legacy dashboard and the
  // console mount the same components against different bases.
  const api = useBuilderApi();
  const t = useTranslations();
  const [reviews, setReviews] = React.useState<ReviewItem[]>(initialValues.reviews);

  const section = useSectionState({
    save: async () => {
      // Array order IS the display order; the route assigns it from position.
      // `items` is the route's vocabulary (LB.2 — `reviews` was silently a
      // 422 on every save).
      const payload = reviews.map((r) => ({
        customerName: r.customerName,
        customerAvatar: r.avatarUrl,
        rating: r.rating,
        reviewText: r.reviewText,
      }));
      const res = await fetch(api(`/landings/${landingId}/reviews`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: payload }),
      });
      const json = await res.json();
      refuseIfFailed(json);
    },
  });
  const [validationError, setValidationError] = React.useState<string | null>(
    null,
  );
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [pickingForId, setPickingForId] = React.useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // --- Lift preview values to parent ---
  React.useEffect(() => {
    onPreviewChange({ reviews });
  }, [reviews, onPreviewChange]);

  // --- Operations ---
  const addReview = () => {
    if (reviews.length >= MAX_REVIEWS) return;
    const newReview: ReviewItem = {
      id: `rev-${Date.now()}`,
      customerName: "",
      rating: 5,
      reviewText: "",
      avatarUrl: null,
    };
    setReviews((prev) => [...prev, newReview]);
    section.markDirty();
  };

  const updateReview = (id: string, patch: Partial<ReviewItem>) => {
    setReviews((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    );
    section.markDirty();
  };

  const removeReview = (id: string) => {
    setReviews((prev) => prev.filter((r) => r.id !== id));
    section.markDirty();
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setReviews((prev) => {
      const oldIndex = prev.findIndex((r) => r.id === active.id);
      const newIndex = prev.findIndex((r) => r.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
    section.markDirty();
  };

  const openAvatarPicker = (id: string) => {
    setPickingForId(id);
    setPickerOpen(true);
  };

  const pickAvatar = (url: string) => {
    if (pickingForId) {
      updateReview(pickingForId, { avatarUrl: url });
    }
    setPickingForId(null);
  };

  // --- Save / Cancel ---
  const handleSave = async () => {
    for (const r of reviews) {
      if (!r.customerName.trim()) {
        setValidationError(t("builder.editor.reviewNameRequired"));
        return;
      }
      if (!r.reviewText.trim()) {
        setValidationError(t("builder.editor.reviewTextRequired"));
        return;
      }
      if (!r.rating || r.rating < 1) {
        setValidationError(t("builder.editor.reviewRatingRequired"));
        return;
      }
    }
    setValidationError(null);
    await section.save();
  };

  const handleCancel = () => {
    setReviews(initialValues.reviews);
    setValidationError(null);
    section.reset();
  };

  return (
    <SectionShell
      id="reviews"
      title={t("builder.editor.reviews")}
      description={t("builder.editor.reviewsDesc")}
      icon={Star}
      state={section.state}
      onSave={handleSave}
      onCancel={handleCancel}
    >
      <div className="flex flex-col gap-3">
        {validationError && (
          <p
            className="flex items-center gap-1.5 text-xs text-destructive"
            role="alert"
          >
            <AlertCircle className="size-3.5" />
            {validationError}
          </p>
        )}

        {reviews.length === 0 && (
          <div className="flex items-center justify-center rounded-xl border border-dashed py-8 text-sm text-muted-foreground">
            {t("builder.editor.noReviews")}
          </div>
        )}

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={reviews.map((r) => r.id)}
            strategy={verticalListSortingStrategy}
          >
            {reviews.map((review, i) => (
              <ReviewCardEditor
                key={review.id}
                review={review}
                index={i}
                onChange={updateReview}
                onRemove={removeReview}
                onPickAvatar={openAvatarPicker}
              />
            ))}
          </SortableContext>
        </DndContext>

        <Button
          type="button"
          variant="outline"
          onClick={addReview}
          disabled={reviews.length >= MAX_REVIEWS}
          className="w-full"
        >
          <Plus className="size-4" />
          {t("builder.editor.addReview")}
          <span className="ms-auto text-xs text-muted-foreground">
            {reviews.length}/{MAX_REVIEWS}
          </span>
        </Button>
      </div>

      <AvatarPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onPick={pickAvatar}
        selectedUrl={
          reviews.find((r) => r.id === pickingForId)?.avatarUrl ?? null
        }
      />
    </SectionShell>
  );
}
