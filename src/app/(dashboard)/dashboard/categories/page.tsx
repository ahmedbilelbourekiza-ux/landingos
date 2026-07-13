"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Plus, GripVertical, Eye, EyeOff, Pencil, Trash2, Loader2, X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { slugify } from "@/lib/landing/create";

interface Category {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  coverImage: string | null;
  sortOrder: number;
  isVisible: boolean;
  productCount: number;
}

export default function CategoriesPage() {
  const router = useRouter();
  const [categories, setCategories] = React.useState<Category[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [editing, setEditing] = React.useState<Category | null>(null);
  const [creating, setCreating] = React.useState(false);

  const fetchCategories = React.useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/categories");
    const json = await res.json();
    if (json.success) setCategories(json.data);
    setLoading(false);
  }, []);

  React.useEffect(() => { fetchCategories(); }, [fetchCategories]);

  const handleDelete = async (cat: Category) => {
    if (!confirm(`Delete "${cat.name}"? Products in this category will become uncategorized.`)) return;
    await fetch(`/api/categories/${cat.id}`, { method: "DELETE" });
    fetchCategories();
  };

  const toggleVisible = async (cat: Category) => {
    await fetch(`/api/categories/${cat.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isVisible: !cat.isVisible }),
    });
    fetchCategories();
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="flex flex-col gap-6"
      >
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Categories</h1>
            <p className="text-sm text-muted-foreground">Organize products into categories.</p>
          </div>
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            New Category
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : categories.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
            <h3 className="text-base font-semibold">No categories yet.</h3>
            <p className="text-sm text-muted-foreground">Create your first category to organize products.</p>
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" />
              Create Category
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {categories.map((cat) => (
              <div key={cat.id} className="flex items-center gap-3 rounded-xl border bg-card p-3">
                <GripVertical className="size-4 shrink-0 text-muted-foreground/40" />
                {cat.coverImage ? (
                  <span className="relative size-10 shrink-0 overflow-hidden rounded-lg border bg-muted">
                    <img src={cat.coverImage} alt={cat.name} className="h-full w-full object-cover" />
                  </span>
                ) : (
                  <span className="grid size-10 shrink-0 place-items-center rounded-lg border bg-muted text-lg">
                    {cat.icon || "📦"}
                  </span>
                )}
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium">{cat.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {cat.productCount} product{cat.productCount !== 1 ? "s" : ""}
                    {" · "}
                    <code className="font-mono">/{cat.slug}</code>
                  </span>
                </div>
                <button
                  onClick={() => toggleVisible(cat)}
                  className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label={cat.isVisible ? "Hide" : "Show"}
                >
                  {cat.isVisible ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                </button>
                <button
                  onClick={() => setEditing(cat)}
                  className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label="Edit"
                >
                  <Pencil className="size-4" />
                </button>
                <button
                  onClick={() => handleDelete(cat)}
                  className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-destructive"
                  aria-label="Delete"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </motion.div>

      {(creating || editing) && (
        <CategoryDialog
          category={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); fetchCategories(); }}
        />
      )}
    </div>
  );
}

function CategoryDialog({
  category,
  onClose,
  onSaved,
}: {
  category: Category | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = React.useState(category?.name ?? "");
  const [slug, setSlug] = React.useState(category?.slug ?? "");
  const [description, setDescription] = React.useState(category?.description ?? "");
  const [icon, setIcon] = React.useState(category?.icon ?? "");
  const [coverImage, setCoverImage] = React.useState(category?.coverImage ?? "");
  const [isVisible, setIsVisible] = React.useState(category?.isVisible ?? true);
  const [saving, setSaving] = React.useState(false);
  const slugTouched = React.useRef(!!category);

  React.useEffect(() => {
    if (!slugTouched.current) setSlug(slugify(name));
  }, [name]);

  const handleSave = async () => {
    setSaving(true);
    const payload = {
      name, slug, description: description || null, icon: icon || null,
      coverImage: coverImage || null, isVisible,
    };
    try {
      if (category) {
        await fetch(`/api/categories/${category.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        await fetch("/api/categories", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, sortOrder: 0 }),
        });
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{category ? "Edit Category" : "New Category"}</DialogTitle>
          <DialogDescription>{category ? "Update category details." : "Create a new product category."}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => { setName(e.target.value); if (!slugTouched.current) setSlug(slugify(e.target.value)); }} placeholder="e.g. Watches" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Slug</Label>
            <Input value={slug} onChange={(e) => { slugTouched.current = true; setSlug(e.target.value); }} placeholder="watches" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Optional" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Icon (emoji)</Label>
              <Input value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="⌚" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Cover Image URL</Label>
              <Input value={coverImage} onChange={(e) => setCoverImage(e.target.value)} placeholder="/uploads/..." />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <Label>Visible</Label>
            <Switch checked={isVisible} onCheckedChange={setIsVisible} />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !name || !slug}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            {category ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
