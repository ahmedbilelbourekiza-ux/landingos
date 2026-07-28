"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  Plus, Pencil, Trash2, Loader2, AlertCircle, Webhook, Check, X, Copy,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { WEBHOOK_EVENTS, WEBHOOK_EVENT_LABELS } from "@/lib/webhooks/events";

interface Delivery {
  id: string;
  event: string;
  resourceId: string;
  success: boolean;
  statusCode: number | null;
  attempts: number;
  error: string | null;
  createdAt: string;
}

interface Endpoint {
  id: string;
  label: string;
  url: string;
  secretPreview: string;
  events: string[];
  isActive: boolean;
  createdAt: string;
  deliveries: Delivery[];
}

export default function WebhooksPage() {
  const [endpoints, setEndpoints] = React.useState<Endpoint[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<Endpoint | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [newSecret, setNewSecret] = React.useState<string | null>(null);

  const fetchEndpoints = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/webhooks");
      const json = await res.json();
      if (json.success) setEndpoints(json.data);
      else setError(json.error?.message || "فشل تحميل إعدادات الويب هوك");
    } catch {
      setError("تعذّر الاتصال بالخادم. تحقّق من اتصالك بالشبكة.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { fetchEndpoints(); }, [fetchEndpoints]);

  const handleDelete = async (endpoint: Endpoint) => {
    if (!confirm(`Delete "${endpoint.label}"? It will stop receiving events immediately.`)) return;
    await fetch(`/api/settings/webhooks/${endpoint.id}`, { method: "DELETE" });
    fetchEndpoints();
  };

  const toggleActive = async (endpoint: Endpoint) => {
    await fetch(`/api/settings/webhooks/${endpoint.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !endpoint.isActive }),
    });
    fetchEndpoints();
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="flex flex-col gap-6"
      >
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Webhooks</h1>
            <p className="text-sm text-muted-foreground">
              Send order and product events to your CRM. Payloads are Shopify-shaped and signed
              with HMAC-SHA256.
            </p>
          </div>
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            Add Endpoint
          </Button>
        </div>

        {newSecret && (
          <Alert>
            <Copy className="size-4" />
            <AlertTitle>Copy your signing secret now</AlertTitle>
            <AlertDescription>
              <p className="mb-2">
                This is the only time it will be shown. Paste it into your CRM to verify incoming
                webhooks.
              </p>
              <code className="block rounded bg-muted px-2 py-1.5 font-mono text-xs break-all">
                {newSecret}
              </code>
              <Button variant="outline" size="sm" className="mt-2" onClick={() => setNewSecret(null)}>
                I&apos;ve saved it
              </Button>
            </AlertDescription>
          </Alert>
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
            <Button onClick={fetchEndpoints} variant="outline" className="mt-4 w-full">
              إعادة المحاولة
            </Button>
          </div>
        ) : endpoints.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
            <h3 className="text-base font-semibold">No webhook endpoints yet.</h3>
            <p className="text-sm text-muted-foreground">
              Add your CRM&apos;s URL to start receiving order and product events.
            </p>
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" />
              Add Endpoint
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {endpoints.map((endpoint) => (
              <div key={endpoint.id} className="flex flex-col gap-3 rounded-xl border bg-card p-4">
                <div className="flex items-center gap-3">
                  <span className={`grid size-10 shrink-0 place-items-center rounded-lg border ${endpoint.isActive ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                    <Webhook className="size-4" />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-sm font-medium">{endpoint.label}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      <code className="font-mono">{endpoint.url}</code>
                      {" · secret "}
                      <code className="font-mono">{endpoint.secretPreview}</code>
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`active-${endpoint.id}`} className="text-xs text-muted-foreground">
                      {endpoint.isActive ? "Active" : "Inactive"}
                    </Label>
                    <Switch
                      id={`active-${endpoint.id}`}
                      checked={endpoint.isActive}
                      onCheckedChange={() => toggleActive(endpoint)}
                    />
                  </div>
                  <button
                    onClick={() => setEditing(endpoint)}
                    className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
                    aria-label="Edit"
                  >
                    <Pencil className="size-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(endpoint)}
                    className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-destructive"
                    aria-label="Delete"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {endpoint.events.length === 0 ? (
                    <span className="text-xs text-muted-foreground">
                      No events subscribed — nothing will be sent.
                    </span>
                  ) : (
                    endpoint.events.map((e) => (
                      <span key={e} className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs">
                        {e}
                      </span>
                    ))
                  )}
                </div>

                {endpoint.deliveries.length > 0 && (
                  <details className="border-t pt-2">
                    <summary className="cursor-pointer text-xs text-muted-foreground">
                      Recent deliveries ({endpoint.deliveries.length})
                    </summary>
                    <div className="mt-2 flex flex-col gap-1">
                      {endpoint.deliveries.map((d) => (
                        <div key={d.id} className="flex items-center gap-2 text-xs">
                          {d.success ? (
                            <Check className="size-3.5 shrink-0 text-green-600" />
                          ) : (
                            <X className="size-3.5 shrink-0 text-destructive" />
                          )}
                          <code className="font-mono">{d.event}</code>
                          <span className="text-muted-foreground">
                            {d.statusCode ?? "no response"}
                            {d.attempts > 1 ? ` · ${d.attempts} attempts` : ""}
                          </span>
                          <span className="ml-auto shrink-0 text-muted-foreground">
                            {new Date(d.createdAt).toLocaleString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            ))}
          </div>
        )}
      </motion.div>

      {(creating || editing) && (
        <EndpointDialog
          endpoint={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={(secret) => {
            setCreating(false);
            setEditing(null);
            if (secret) setNewSecret(secret);
            fetchEndpoints();
          }}
        />
      )}
    </div>
  );
}

function EndpointDialog({
  endpoint,
  onClose,
  onSaved,
}: {
  endpoint: Endpoint | null;
  onClose: () => void;
  onSaved: (generatedSecret?: string) => void;
}) {
  const [label, setLabel] = React.useState(endpoint?.label ?? "");
  const [url, setUrl] = React.useState(endpoint?.url ?? "");
  const [secret, setSecret] = React.useState("");
  const [events, setEvents] = React.useState<string[]>(endpoint?.events ?? []);
  const [isActive, setIsActive] = React.useState(endpoint?.isActive ?? false);
  const [saving, setSaving] = React.useState(false);

  const toggleEvent = (event: string) => {
    setEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event],
    );
  };

  const handleSave = async () => {
    setSaving(true);
    const payload: Record<string, unknown> = { label, url, events, isActive };
    if (secret) payload.secret = secret;
    try {
      if (endpoint) {
        await fetch(`/api/settings/webhooks/${endpoint.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        onSaved();
      } else {
        const res = await fetch("/api/settings/webhooks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        onSaved(json.success ? json.data.secret : undefined);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{endpoint ? "Edit Endpoint" : "Add Endpoint"}</DialogTitle>
          <DialogDescription>
            {endpoint
              ? "Update this endpoint. Leave the secret blank to keep the current one."
              : "Point this at your CRM's webhook receiver. A signing secret is generated for you."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Label</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Main CRM" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>URL</Label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://crm.example.com/webhooks/landingos" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Signing Secret</Label>
            <Input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={endpoint ? `Current: ${endpoint.secretPreview} — blank to keep` : "Leave blank to auto-generate"}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label>Events</Label>
            <div className="flex flex-col gap-2 rounded-lg border p-3">
              {WEBHOOK_EVENTS.map((event) => (
                <label key={event} className="flex items-center gap-2.5 text-sm">
                  <Checkbox
                    checked={events.includes(event)}
                    onCheckedChange={() => toggleEvent(event)}
                  />
                  <span className="flex-1">{WEBHOOK_EVENT_LABELS[event]}</span>
                  <code className="font-mono text-xs text-muted-foreground">{event}</code>
                </label>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="flex flex-col gap-0.5">
              <Label>Active</Label>
              <span className="text-xs text-muted-foreground">Starts receiving events when on.</span>
            </div>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !label || !url}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            {endpoint ? "Save" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
