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
import { Rows3, Plus, AlertCircle, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { type MediaItem } from "@/lib/landing/mock-media";
import {
  SectionShell,
  useSectionState,
} from "@/components/landings/edit/section";
import { SortableImageCard } from "./image-card";
import type { DescriptionImagesPreviewValues } from "@/types/preview";
import { useBuilderApi } from "@/lib/builder/api-base";

// Long-form images rendered below the product description on the public page,
// the equivalent of images inside a Shopify product description.
//
// Deliberately separate from the Images & Media section: those are slider
// images where position 0 is the hero and the rest are thumbnails, whereas
// these are a flat sequence read top to bottom. Merging them would mean one
// list whose first element means something different from the others.
//
// Both persist through PUT /api/landings/[id]/media, distinguished by the
// `placement` field, so the two lists never overwrite each other.

const MAX_IMAGES = 20;

export function DescriptionImagesSection({
  landingId,
  initialValues,
  onPreviewChange,
}: {
  landingId: string;
  initialValues: DescriptionImagesPreviewValues;
  onPreviewChange: (values: DescriptionImagesPreviewValues) => void;
}) {
  // Where this editor sends its requests. The legacy dashboard and the
  // console mount the same components against different bases.
  const api = useBuilderApi();
  // Preview state carries URLs only, so ids are synthesised for dnd-kit. They
  // are positional and never persisted — the server assigns displayOrder from
  // array position on save.
  const initialImages = React.useMemo<MediaItem[]>(
    () =>
      initialValues.urls.map((url, i) => ({
        id: `desc-${i}`,
        url,
        filename: `image-${i + 1}`,
      })),
    [initialValues.urls],
  );

  const [images, setImages] = React.useState<MediaItem[]>(initialImages);
  const [uploading, setUploading] = React.useState(false);
  const [validationError, setValidationError] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const section = useSectionState({
    save: async () => {
      const res = await fetch(api(`/landings/${landingId}/media`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Array position IS the display order — the list the admin sees is
          // the order the customer gets.
          media: images.map((m, i) => ({
            type: "IMAGE" as const,
            url: m.url,
            altText: m.filename,
            displayOrder: i,
          })),
          // Without this the request would default to GALLERY and replace the
          // product slider with these images.
          placement: "DESCRIPTION" as const,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message || "Save failed");
    },
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  React.useEffect(() => {
    onPreviewChange({ urls: images.map((m) => m.url) });
  }, [images, onPreviewChange]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setImages((prev) => {
      const oldIndex = prev.findIndex((m) => m.id === active.id);
      const newIndex = prev.findIndex((m) => m.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
    section.markDirty();
  };

  const handleRemove = (id: string) => {
    setImages((prev) => prev.filter((m) => m.id !== id));
    section.markDirty();
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Cleared immediately so re-picking the same file still fires onChange.
    e.target.value = "";

    if (images.length >= MAX_IMAGES) {
      setValidationError(`Maximum ${MAX_IMAGES} description images.`);
      return;
    }

    setUploading(true);
    setValidationError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const json = await res.json();
      if (!json.success) {
        setValidationError(json.error?.message || "Upload failed");
        return;
      }
      setImages((prev) => [
        ...prev,
        { id: `desc-new-${Date.now()}`, url: json.data.url, filename: file.name },
      ]);
      section.markDirty();
    } catch {
      setValidationError("Network error during upload");
    } finally {
      setUploading(false);
    }
  };

  const handleCancel = () => {
    setImages(initialImages);
    setValidationError(null);
    section.reset();
  };

  return (
    <SectionShell
      id="description-images"
      title="Landing Page Images"
      description="Long-form images shown below the product description."
      icon={Rows3}
      state={section.state}
      onSave={async () => {
        setValidationError(null);
        await section.save();
      }}
      onCancel={handleCancel}
    >
      <div className="flex flex-col gap-4">
        {validationError && (
          <p className="flex items-center gap-1.5 text-xs text-destructive" role="alert">
            <AlertCircle className="size-3.5" />
            {validationError}
          </p>
        )}

        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">
            Description images{" "}
            <span className="text-xs text-muted-foreground">({images.length})</span>
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={images.length >= MAX_IMAGES || uploading}
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

        {images.length === 0 ? (
          <div className="flex aspect-video items-center justify-center rounded-xl border border-dashed text-center text-sm text-muted-foreground">
            No description images yet — these appear below the product
            description, in the order shown here.
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={images.map((m) => m.id)}
              strategy={rectSortingStrategy}
            >
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {images.map((item) => (
                  <SortableImageCard
                    key={item.id}
                    item={item}
                    onRemove={handleRemove}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}

        <div
          className={cn(
            "flex items-center justify-between text-xs",
            images.length >= MAX_IMAGES ? "text-destructive" : "text-muted-foreground",
          )}
        >
          <span>
            {images.length} / {MAX_IMAGES} images
          </span>
          <span>Drag to reorder · Order shown is the order customers see</span>
        </div>
      </div>
    </SectionShell>
  );
}
