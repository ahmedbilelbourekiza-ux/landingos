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
import { Image as ImageIcon, Plus, AlertCircle, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { type MediaItem } from "@/lib/landing/mock-media";
import {
  SectionShell,
  useSectionState,
} from "@/components/landings/edit/section";
import { SortableImageCard, HeroImageCard } from "./image-card";
import { useBuilderApi } from "@/lib/builder/api-base";

// The preview values the Images section lifts to the parent: the hero image
// URL and the gallery image URLs. The preview panel renders the hero in
// place of the placeholder.
export interface ImagesPreviewValues {
  heroUrl: string | null;
  galleryUrls: string[];
}

const MAX_IMAGES = 12;

export function ImagesSection({
  landingId,
  initialValues,
  onPreviewChange,
}: {
  landingId: string;
  initialValues: ImagesPreviewValues;
  onPreviewChange: (values: ImagesPreviewValues) => void;
}) {
  // Where this editor sends its requests. The legacy dashboard and the
  // console mount the same components against different bases.
  const api = useBuilderApi();
  // Build initial MediaItem arrays from the preview values (which only carry
  // URLs). When loading from Prisma, the hero is the first media row and
  // the gallery is the rest.
  const initialHero: MediaItem | null = initialValues.heroUrl
    ? { id: "hero", url: initialValues.heroUrl, filename: "hero" }
    : null;
  const initialGallery: MediaItem[] = initialValues.galleryUrls.map((url, i) => ({
    id: `gallery-${i}`,
    url,
    filename: `image-${i + 1}`,
  }));

  const section = useSectionState({
    save: async () => {
      const allMedia = [
        ...(hero ? [{ type: "IMAGE" as const, url: hero.url, altText: hero.filename, displayOrder: 0 }] : []),
        ...gallery.map((m, i) => ({
          type: "IMAGE" as const,
          url: m.url,
          altText: m.filename,
          displayOrder: i + 1,
        })),
      ];
      const res = await fetch(api(`/landings/${landingId}/media`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ media: allMedia }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message || "Save failed");
    },
  });

  const [hero, setHero] = React.useState<MediaItem | null>(initialHero);
  const [gallery, setGallery] = React.useState<MediaItem[]>(initialGallery);
  const [uploading, setUploading] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

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

  const totalImages = (hero ? 1 : 0) + gallery.length;

  // --- Upload image ---
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    if (totalImages >= MAX_IMAGES) {
      setValidationError(`Maximum ${MAX_IMAGES} images total.`);
      return;
    }

    setUploading(true);
    setValidationError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(api("/upload"), { method: "POST", body: formData });
      const json = await res.json();
      if (!json.success) {
        setValidationError(json.error?.message || "Upload failed");
        return;
      }
      handleAddImage({
        id: `img-${Date.now()}`,
        url: json.data.url,
        filename: file.name,
      });
    } catch {
      setValidationError("Network error during upload");
    } finally {
      setUploading(false);
    }
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
    setHero(initialHero);
    setGallery(initialGallery);
    setValidationError(null);
    section.reset();
  };

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
              onClick={() => fileInputRef.current?.click()}
              disabled={totalImages >= MAX_IMAGES || uploading}
            >
              {uploading ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              {uploading ? "Uploading..." : "Add Image"}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif"
              className="hidden"
              onChange={handleFileSelect}
            />
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
    </SectionShell>
  );
}
