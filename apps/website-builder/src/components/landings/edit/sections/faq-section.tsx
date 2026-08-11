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
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { HelpCircle, Plus, AlertCircle, GripVertical, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  SectionShell,
  useSectionState,
  refuseIfFailed,
} from "@/components/landings/edit/section";
import { useBuilderApi } from "@/lib/builder/api-base";

/* The FAQ section — LB.12, replacing the "Coming Soon" stub. Mirrors the
 * Reviews section: local list state, dnd-kit ordering (array order IS the
 * display order), replace-all PUT on save. */

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
}

export interface FaqPreviewValues {
  faqs: FaqItem[];
}

const MAX_FAQS = 30;

function FaqRow({
  faq,
  onChange,
  onRemove,
}: {
  faq: FaqItem;
  onChange: (id: string, patch: Partial<FaqItem>) => void;
  onRemove: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: faq.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex flex-col gap-2 rounded-xl border bg-card p-3",
        isDragging && "z-10 shadow-lg",
      )}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Reorder question"
          className="cursor-grab touch-none rounded p-1 text-muted-foreground hover:bg-muted"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </button>
        <Input
          aria-label="Question"
          placeholder="e.g. How long does delivery take?"
          value={faq.question}
          onChange={(e) => onChange(faq.id, { question: e.target.value })}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Remove question"
          className="shrink-0 text-muted-foreground hover:text-destructive"
          onClick={() => onRemove(faq.id)}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
      <Textarea
        aria-label="Answer"
        placeholder="The answer your customers see"
        rows={3}
        value={faq.answer}
        onChange={(e) => onChange(faq.id, { answer: e.target.value })}
      />
    </div>
  );
}

export function FaqSection({
  landingId,
  initialValues,
  onPreviewChange,
}: {
  landingId: string;
  initialValues: FaqPreviewValues;
  onPreviewChange: (values: FaqPreviewValues) => void;
}) {
  const api = useBuilderApi();
  const [faqs, setFaqs] = React.useState<FaqItem[]>(initialValues.faqs);
  const [validationError, setValidationError] = React.useState<string | null>(null);

  const section = useSectionState({
    save: async () => {
      const payload = faqs.map((f) => ({ question: f.question, answer: f.answer }));
      const res = await fetch(api(`/landings/${landingId}/faqs`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: payload }),
      });
      const json = await res.json();
      refuseIfFailed(json);
    },
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  React.useEffect(() => {
    onPreviewChange({ faqs });
  }, [faqs, onPreviewChange]);

  const addFaq = () => {
    if (faqs.length >= MAX_FAQS) return;
    setFaqs((prev) => [...prev, { id: `faq-${Date.now()}`, question: "", answer: "" }]);
    section.markDirty();
  };

  const updateFaq = (id: string, patch: Partial<FaqItem>) => {
    setFaqs((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
    section.markDirty();
  };

  const removeFaq = (id: string) => {
    setFaqs((prev) => prev.filter((f) => f.id !== id));
    section.markDirty();
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setFaqs((prev) => {
      const oldIndex = prev.findIndex((f) => f.id === active.id);
      const newIndex = prev.findIndex((f) => f.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
    section.markDirty();
  };

  const handleSave = async () => {
    for (const f of faqs) {
      if (!f.question.trim()) {
        setValidationError("Every FAQ needs a question.");
        return;
      }
      if (!f.answer.trim()) {
        setValidationError("Every FAQ needs an answer.");
        return;
      }
    }
    setValidationError(null);
    await section.save();
  };

  const handleCancel = () => {
    setFaqs(initialValues.faqs);
    setValidationError(null);
    section.reset();
  };

  return (
    <SectionShell
      id="faq"
      title="FAQ"
      description="Frequently asked questions."
      icon={HelpCircle}
      state={section.state}
      onSave={handleSave}
      onCancel={handleCancel}
    >
      <div className="flex flex-col gap-3">
        {validationError && (
          <p className="flex items-center gap-1.5 text-xs text-destructive" role="alert">
            <AlertCircle className="size-3.5" />
            {validationError}
          </p>
        )}

        {faqs.length === 0 && (
          <div className="flex items-center justify-center rounded-xl border border-dashed py-8 text-sm text-muted-foreground">
            No questions yet. Add one below.
          </div>
        )}

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={faqs.map((f) => f.id)} strategy={verticalListSortingStrategy}>
            {faqs.map((faq) => (
              <FaqRow key={faq.id} faq={faq} onChange={updateFaq} onRemove={removeFaq} />
            ))}
          </SortableContext>
        </DndContext>

        <Button
          type="button"
          variant="outline"
          onClick={addFaq}
          disabled={faqs.length >= MAX_FAQS}
          className="w-full"
        >
          <Plus className="size-4" />
          Add Question
          <span className="ml-auto text-xs text-muted-foreground">
            {faqs.length}/{MAX_FAQS}
          </span>
        </Button>
      </div>
    </SectionShell>
  );
}
