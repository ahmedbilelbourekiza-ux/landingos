"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Store, Phone, Globe, Share2, Loader2, Check, AlertCircle, WifiOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface StoreSettings {
  storeName?: string;
  storeDescription?: string | null;
  logo?: string | null;
  favicon?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  currency?: string;
  timezone?: string;
  language?: string;
  facebook?: string | null;
  instagram?: string | null;
  tiktok?: string | null;
  whatsapp?: string | null;
  telegram?: string | null;
  updatedAt?: string;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; settings: StoreSettings };

export default function SettingsPage() {
  const [state, setState] = React.useState<LoadState>({ status: "loading" });
  const [settings, setSettings] = React.useState<StoreSettings>({});
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);

  const loadSettings = React.useCallback(async () => {
    setState({ status: "loading" });
    try {
      const res = await fetch("/api/settings/store");
      const json = await res.json();
      if (json.success) {
        setSettings(json.data ?? {});
        setState({ status: "success", settings: json.data ?? {} });
      } else {
        setState({
          status: "error",
          message: json.error?.message || "فشل تحميل الإعدادات",
        });
      }
    } catch {
      setState({
        status: "error",
        message: "تعذّر الاتصال بالخادم. تحقّق من اتصالك بالشبكة.",
      });
    }
  }, []);

  React.useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/settings/store", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const json = await res.json();
      if (json.success) {
        setSaved(true);
        setSettings(json.data);
        setTimeout(() => setSaved(false), 2000);
      } else {
        setSaveError(json.error?.message || "فشل حفظ الإعدادات");
      }
    } catch {
      setSaveError("تعذّر الاتصال بالخادم");
    } finally {
      setSaving(false);
    }
  };

  const update = (key: keyof StoreSettings, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  if (state.status === "loading") {
    return (
      <div className="flex items-center justify-center py-20" dir="rtl">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-20" dir="rtl">
        <Alert variant="destructive">
          <WifiOff className="size-4" />
          <AlertTitle>تعذّر تحميل الإعدادات</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
        <Button onClick={loadSettings} variant="outline" className="mt-4 w-full">
          <Loader2 className="size-4" />
          إعادة المحاولة
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-10" dir="rtl">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">الإعدادات</h1>
          <p className="text-sm text-muted-foreground">إعدادات المتجر العامة</p>
        </div>

        {/* Store Section */}
        <SettingsCard title="المتجر" icon={Store}>
          <Field label="اسم المتجر" value={settings.storeName ?? ""} onChange={(v) => update("storeName", v)} />
          <Field label="وصف المتجر" value={settings.storeDescription ?? ""} onChange={(v) => update("storeDescription", v)} textarea />
          <Field label="الشعار (URL)" value={settings.logo ?? ""} onChange={(v) => update("logo", v)} />
          <Field label="الأيقونة (URL)" value={settings.favicon ?? ""} onChange={(v) => update("favicon", v)} />
        </SettingsCard>

        {/* Contact Section */}
        <SettingsCard title="التواصل" icon={Phone}>
          <Field label="الهاتف" value={settings.phone ?? ""} onChange={(v) => update("phone", v)} />
          <Field label="البريد الإلكتروني" value={settings.email ?? ""} onChange={(v) => update("email", v)} />
          <Field label="العنوان" value={settings.address ?? ""} onChange={(v) => update("address", v)} />
        </SettingsCard>

        {/* Localization Section */}
        <SettingsCard title="المنطقة واللغة" icon={Globe}>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="العملة" value={settings.currency ?? "DZD"} onChange={(v) => update("currency", v)} />
            <Field label="المنطقة الزمنية" value={settings.timezone ?? "Africa/Casablanca"} onChange={(v) => update("timezone", v)} />
            <Field label="اللغة" value={settings.language ?? "ar"} onChange={(v) => update("language", v)} />
          </div>
        </SettingsCard>

        {/* Social Section */}
        <SettingsCard title="وسائل التواصل" icon={Share2}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="فيسبوك" value={settings.facebook ?? ""} onChange={(v) => update("facebook", v)} />
            <Field label="انستغرام" value={settings.instagram ?? ""} onChange={(v) => update("instagram", v)} />
            <Field label="تيك توك" value={settings.tiktok ?? ""} onChange={(v) => update("tiktok", v)} />
            <Field label="واتساب" value={settings.whatsapp ?? ""} onChange={(v) => update("whatsapp", v)} />
            <Field label="تيليغرام" value={settings.telegram ?? ""} onChange={(v) => update("telegram", v)} />
          </div>
        </SettingsCard>

        {/* Save error */}
        {saveError && (
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertDescription>{saveError}</AlertDescription>
          </Alert>
        )}

        {/* Save button */}
        <div className="flex items-center justify-between border-t pt-4">
          <p className="text-sm text-muted-foreground">
            {saved ? "تم الحفظ" : settings.updatedAt ? `آخر تحديث: ${settings.updatedAt}` : "—"}
          </p>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : saved ? <Check className="size-4" /> : null}
            {saving ? "جاري الحفظ..." : saved ? "تم الحفظ" : "حفظ التغييرات"}
          </Button>
        </div>
      </motion.div>
    </div>
  );
}

function SettingsCard({ title, icon: Icon, children }: { title: string; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border bg-card shadow-sm">
      <header className="flex items-center gap-2 border-b px-5 py-3">
        <Icon className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">{title}</h2>
      </header>
      <div className="flex flex-col gap-4 px-5 py-4">{children}</div>
    </div>
  );
}

function Field({ label, value, onChange, textarea }: { label: string; value: string; onChange: (v: string) => void; textarea?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {textarea ? (
        <Textarea value={value} onChange={(e) => onChange(e.target.value)} rows={2} dir="auto" />
      ) : (
        <Input value={value} onChange={(e) => onChange(e.target.value)} dir="ltr" />
      )}
    </div>
  );
}
