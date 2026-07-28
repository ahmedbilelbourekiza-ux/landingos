"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Plus, Pencil, Trash2, Loader2, AlertCircle, Radio, Globe, Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface PixelConfig {
  id: string;
  label: string;
  pixelId: string;
  accessTokenPreview: string;
  isActive: boolean;
  createdAt: string;
}

export default function MetaPixelsPage() {
  const [configs, setConfigs] = React.useState<PixelConfig[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<PixelConfig | null>(null);
  const [creating, setCreating] = React.useState(false);

  const fetchConfigs = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/meta-pixels");
      const json = await res.json();
      if (json.success) {
        setConfigs(json.data);
      } else {
        setError(json.error?.message || "فشل تحميل إعدادات البكسل");
      }
    } catch {
      setError("تعذّر الاتصال بالخادم. تحقّق من اتصالك بالشبكة.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { fetchConfigs(); }, [fetchConfigs]);

  const handleDelete = async (config: PixelConfig) => {
    if (!confirm(`Delete "${config.label}"? Purchase events will stop going to this pixel immediately.`)) return;
    await fetch(`/api/settings/meta-pixels/${config.id}`, { method: "DELETE" });
    fetchConfigs();
  };

  const toggleActive = async (config: PixelConfig) => {
    await fetch(`/api/settings/meta-pixels/${config.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !config.isActive }),
    });
    fetchConfigs();
  };

  const activeCount = configs.filter((c) => c.isActive).length;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="flex flex-col gap-6"
      >
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Meta Pixels</h1>
          <p className="text-sm text-muted-foreground">
            Two independent systems: the browser pixel that runs on your storefront, and the
            server-side Conversions API that reports real orders. Changing one never affects
            the other.
          </p>
        </div>

        <BrowserPixelCard />

        <div className="flex items-center justify-between border-t pt-6">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold tracking-tight">Conversions API (server-side)</h2>
            <p className="text-sm text-muted-foreground">
              Every order sends a server-side Purchase event to every pixel marked Active below.
            </p>
          </div>
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            Add Pixel
          </Button>
        </div>

        {!loading && !error && (
          <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
            {activeCount === 0
              ? "No pixel is active — orders will complete normally, but no Purchase events will be sent to Meta."
              : `${activeCount} pixel${activeCount > 1 ? "s are" : " is"} active — every new order sends a Purchase event to ${activeCount > 1 ? "all of them" : "it"}.`}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="mx-auto max-w-md py-20">
            <Alert variant="destructive">
              <AlertCircle className="size-4" />
              <AlertTitle>تعذّر تحميل الإعدادات</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
            <Button onClick={fetchConfigs} variant="outline" className="mt-4 w-full">
              <Loader2 className="size-4" />
              إعادة المحاولة
            </Button>
          </div>
        ) : configs.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
            <h3 className="text-base font-semibold">No pixel connections yet.</h3>
            <p className="text-sm text-muted-foreground">Add a Pixel ID + Conversions API access token to start sending Purchase events.</p>
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" />
              Add Pixel
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {configs.map((config) => (
              <div key={config.id} className="flex items-center gap-3 rounded-xl border bg-card p-3">
                <span className={`grid size-10 shrink-0 place-items-center rounded-lg border ${config.isActive ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                  <Radio className="size-4" />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium">{config.label}</span>
                  <span className="text-xs text-muted-foreground">
                    Pixel ID <code className="font-mono">{config.pixelId}</code>
                    {" · "}Token <code className="font-mono">{config.accessTokenPreview}</code>
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor={`active-${config.id}`} className="text-xs text-muted-foreground">
                    {config.isActive ? "Active" : "Inactive"}
                  </Label>
                  <Switch id={`active-${config.id}`} checked={config.isActive} onCheckedChange={() => toggleActive(config)} />
                </div>
                <button
                  onClick={() => setEditing(config)}
                  className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label="Edit"
                >
                  <Pencil className="size-4" />
                </button>
                <button
                  onClick={() => handleDelete(config)}
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
        <PixelDialog
          config={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); fetchConfigs(); }}
        />
      )}
    </div>
  );
}

// Standalone browser-pixel setting. Reads/writes StoreSettings.metaBrowserPixelId
// via the existing store-settings endpoint. Deliberately separate from the
// Conversions API list below it — this pixel keeps firing PageView /
// ViewContent / InitiateCheckout even with zero CAPI configs.
function BrowserPixelCard() {
  const [pixelId, setPixelId] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    fetch("/api/settings/store")
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setPixelId(json.data?.metaBrowserPixelId ?? "");
      })
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await fetch("/api/settings/store", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metaBrowserPixelId: pixelId.trim() || null }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 rounded-xl border bg-card p-4">
      <div className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg border bg-muted text-muted-foreground">
          <Globe className="size-4" />
        </span>
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-semibold">Browser Pixel (storefront)</h2>
          <p className="text-xs text-muted-foreground">
            Fires PageView on every page, ViewContent on product pages, and InitiateCheckout
            when a customer starts the order form.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="browser-pixel-id">Pixel ID</Label>
        <div className="flex gap-2">
          <Input
            id="browser-pixel-id"
            value={pixelId}
            onChange={(e) => { setPixelId(e.target.value); setSaved(false); }}
            placeholder={loading ? "Loading..." : "1234567890123456"}
            disabled={loading}
          />
          <Button onClick={handleSave} disabled={saving || loading}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : saved ? <Check className="size-4" /> : null}
            {saved ? "Saved" : "Save"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Leave blank to disable the storefront pixel entirely. This does not affect the
          Conversions API below.
        </p>
      </div>
    </div>
  );
}

function PixelDialog({
  config,
  onClose,
  onSaved,
}: {
  config: PixelConfig | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [label, setLabel] = React.useState(config?.label ?? "");
  const [pixelId, setPixelId] = React.useState(config?.pixelId ?? "");
  const [accessToken, setAccessToken] = React.useState("");
  const [isActive, setIsActive] = React.useState(config?.isActive ?? false);
  const [saving, setSaving] = React.useState(false);

  const handleSave = async () => {
    setSaving(true);
    const payload: Record<string, unknown> = { label, pixelId, isActive };
    if (accessToken) payload.accessToken = accessToken;
    try {
      if (config) {
        await fetch(`/api/settings/meta-pixels/${config.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        await fetch("/api/settings/meta-pixels", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  const canSave = label && pixelId && (config ? true : accessToken);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{config ? "Edit Pixel" : "Add Pixel"}</DialogTitle>
          <DialogDescription>
            {config
              ? "Update this pixel's details. Leave the token blank to keep the current one."
              : "Paste your Meta Pixel ID and a Conversions API access token from Events Manager."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Label</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Main Ad Account" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Pixel ID</Label>
            <Input value={pixelId} onChange={(e) => setPixelId(e.target.value)} placeholder="1234567890123456" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Conversions API Access Token</Label>
            <Input
              type="password"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder={config ? `Current: ${config.accessTokenPreview} — leave blank to keep` : "EAAG..."}
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="flex flex-col gap-0.5">
              <Label>Active</Label>
              <span className="text-xs text-muted-foreground">Receives Purchase events immediately when on.</span>
            </div>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !canSave}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            {config ? "Save" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
