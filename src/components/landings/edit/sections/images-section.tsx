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
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { Image as ImageIcon, Plus, AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { mockImagesData, type MediaItem } from "@/lib/landing/mock-media";
import {
  SectionShell,
  useSectionState,
} from "@/components/landings/edit/section";
import { MediaPickerDialog } from "./media-picker-dialog";
import { SortableImageCard, HeroImageCard } from "./image-card";

// The preview values the Images section lifts to the parent: the hero image
// URL and the gallery image URLs. The preview panel renders the hero in
// place of the placeholder.
export interface ImagesPreviewValues {
  heroUrl: string | null;
  galleryUrls: string[];
}

const MAX_IMAGES = 12;

export function ImagesSection({
  onPreviewChange,
}: {
  onPreviewChange: (values: ImagesPreviewValues) => void;
}) {
  const section = useSectionState();

  // Image state is plain useState, not RHF — it's a reorderable list, not a
  // field-based form. Every mutation calls section.markDirty().
  const [hero, setHero] = React.useState<MediaItem | null>(mockImagesData.hero);
  const [gallery, setGallery] = React.useState<MediaItem[]>(mockImagesData.gallery);
  const [pickerOpen, setPickerOpen] = React.useState(false);

  // Validation error (max 12 images total, at least 1 hero). Shown inline
  // like other sections' errors.
  const [validationError, setValidationError] = React.useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // --- Lift preview values to parent ---
  React.useEffect(() => {
    onPreviewChange({
      heroUrl: hero?.url ?? null,
      galleryUrls: gallery.map((g) => g.url),
    });
  }, [hero, gallery, onPreviewChange]);

  // --- Actions ---
  const handleAddImage = (item: MediaItem) => {
    if (gallery.length >= MAX_IMAGES - 1) {
      // -1 because hero counts toward the 12-image max
      setValidationError(`Maximum ${MAX_IMAGES} images total.`);
      return;
    }
    setValidationError(null);

    // If there's no hero yet, promote the first added image to hero.
    if (!hero) {
      setHero(item);
    } else {
      setGallery((prev) => [...prev, item]);
    }
    section.markDirty();
  };

  const handleSetHero = (id: string) => {
    const newHero = gallery.find((g) => g.id === id);
    if (!newHero || !hero) return;
    // Swap: old hero goes back to gallery, selected image becomes hero.
    setHero(newHero);
    setGallery((prev) =>
      prev.filter((g) => g.id !== id).concat(hero),
    );
    section.markDirty();
  };

  const handleRemoveGallery = (id: string) => {
    setGallery((prev) => prev.filter((g) => g.id !== id));
    section.markDirty();
  };

  const handleRemoveHero = () => {
    // Removing hero promotes the first gallery image.
    if (gallery.length === 0) {
      setHero(null);
    } else {
      const [first, ...rest] = gallery;
      setHero(first);
      setGallery(rest);
    }
    section.markDirty();
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setGallery((prev) => {
      const oldIndex = prev.findIndex((g) => g.id === active.id);
      const newIndex = prev.findIndex((g) => g.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
    section.markDirty();
  };

  // --- Save / Cancel ---
  const handleSave = async () => {
    if (!hero) {
      setValidationError("At least one hero image is required.");
      return;
    }
    setValidationError(null);
    await section.save();
  };

  const handleCancel = () => {
    setHero(mockImagesData.hero);
    setGallery(mockImagesData.gallery);
    setValidationError(null);
    section.reset();
  };

  const totalImages = (hero ? 1 : 0) + gallery.length;

  return (
    <SectionShell
      id="images"
      title="Images & Media"
      description="Product gallery, videos, and thumbnails."
      icon={ImageIcon}
      state={section.state}
      onSave={handleSave}
      onCancel={handleCancel}
    >
      <div className="flex flex-col gap-6">
        {/* Validation error */}
        {validationError && (
          <p
            className="flex items-center gap-1.5 text-xs text-destructive"
            role="alert"
          >
            <AlertCircle className="size-3.5" />
            {validationError}
          </p>
        )}

        {/* Hero image */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Hero image</span>
            <span className="text-xs text-muted-foreground">
              Shown large on the landing page
            </span>
          </div>
          {hero ? (
            <HeroImageCard item={hero} onRemove={handleRemoveHero} />
          ) : (
            <div className="flex aspect-[16/10] items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
              No hero image — add one below
            </div>
          )}
        </div>

        {/* Gallery */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">
              Gallery{" "}
              <span className="text-xs text-muted-foreground">
                ({gallery.length})
              </span>
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPickerOpen(true)}
              disabled={totalImages >= MAX_IMAGES}
            >
              <Plus className="size-4" />
              Add Image
            </Button>
          </div>

          {gallery.length === 0 ? (
            <div className="flex aspect-video items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
              No gallery images yet
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={gallery.map((g) => g.id)}
                strategy={rectSortingStrategy}
              >
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {gallery.map((item) => (
                    <SortableImageCard
                      key={item.id}
                      item={item}
                      onRemove={handleRemoveGallery}
                      onSetHero={handleSetHero}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>

        {/* Count indicator */}
        <div
          className={cn(
            "flex items-center justify-between text-xs",
            totalImages >= MAX_IMAGES
              ? "text-destructive"
              : "text-muted-foreground",
          )}
        >
          <span>{totalImages} / {MAX_IMAGES} images</span>
          <span>Drag to reorder · Click Hero to promote</span>
        </div>
      </div>

      <MediaPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onPick={handleAddImage}
      />
    </SectionShell>
  );
}
