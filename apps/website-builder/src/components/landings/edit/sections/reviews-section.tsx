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

import { Button } from "@/components/ui/button";
import { type ReviewItem } from "@/lib/landing/mock-reviews";
import {
  SectionShell,
  useSectionState,
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
  const [reviews, setReviews] = React.useState<ReviewItem[]>(initialValues.reviews);

  const section = useSectionState({
    save: async () => {
      const payload = reviews.map((r, i) => ({
        customerName: r.customerName,
        customerAvatar: r.avatarUrl,
        rating: r.rating,
        reviewText: r.reviewText,
        displayOrder: i,
      }));
      const res = await fetch(api(`/landings/${landingId}/reviews`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviews: payload }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message || "Save failed");
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
        setValidationError("Every review needs a customer name.");
        return;
      }
      if (!r.reviewText.trim()) {
        setValidationError("Every review needs review text.");
        return;
      }
      if (!r.rating || r.rating < 1) {
        setValidationError("Every review needs a rating.");
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
      title="Reviews"
      description="Customer testimonials and ratings."
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
            No reviews yet. Add one below.
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
          Add Review
          <span className="ml-auto text-xs text-muted-foreground">
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
