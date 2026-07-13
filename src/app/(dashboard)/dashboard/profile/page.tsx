"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { User, Lock, Loader2, Check, LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ProfilePage() {
  const router = useRouter();
  const [username, setUsername] = React.useState("");
  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [savingProfile, setSavingProfile] = React.useState(false);
  const [savingPassword, setSavingPassword] = React.useState(false);
  const [profileSaved, setProfileSaved] = React.useState(false);
  const [passwordSaved, setPasswordSaved] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((json) => { if (json.success) setUsername(json.data.username); });
  }, []);

  const handleSaveProfile = async () => {
    setSavingProfile(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      const json = await res.json();
      if (json.success) {
        setProfileSaved(true);
        setTimeout(() => setProfileSaved(false), 2000);
      } else {
        setError(json.error?.message || "فشل التحديث");
      }
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword) {
      setError("يرجى إدخال جميع الحقول");
      return;
    }
    setSavingPassword(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const json = await res.json();
      if (json.success) {
        setPasswordSaved(true);
        setCurrentPassword("");
        setNewPassword("");
        setTimeout(() => setPasswordSaved(false), 2000);
      } else {
        setError(json.error?.message || "فشل تغيير كلمة المرور");
      }
    } finally {
      setSavingPassword(false);
    }
  };

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 sm:py-10" dir="rtl">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">الملف الشخصي</h1>
          <p className="text-sm text-muted-foreground">إدارة حساب المسؤول</p>
        </div>

        {/* Username */}
        <div className="rounded-2xl border bg-card shadow-sm">
          <header className="flex items-center gap-2 border-b px-5 py-3">
            <User className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">اسم المستخدم</h2>
          </header>
          <div className="flex flex-col gap-4 px-5 py-4">
            <div className="flex flex-col gap-1.5">
              <Label>اسم المستخدم</Label>
              <Input value={username} onChange={(e) => setUsername(e.target.value)} dir="ltr" />
            </div>
            <Button onClick={handleSaveProfile} disabled={savingProfile} className="self-start">
              {savingProfile ? <Loader2 className="size-4 animate-spin" /> : profileSaved ? <Check className="size-4" /> : null}
              {savingProfile ? "جاري الحفظ..." : profileSaved ? "تم الحفظ" : "حفظ"}
            </Button>
          </div>
        </div>

        {/* Password */}
        <div className="rounded-2xl border bg-card shadow-sm">
          <header className="flex items-center gap-2 border-b px-5 py-3">
            <Lock className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">تغيير كلمة المرور</h2>
          </header>
          <div className="flex flex-col gap-4 px-5 py-4">
            <div className="flex flex-col gap-1.5">
              <Label>كلمة المرور الحالية</Label>
              <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} dir="ltr" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>كلمة المرور الجديدة</Label>
              <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} dir="ltr" />
            </div>
            <Button onClick={handleChangePassword} disabled={savingPassword} className="self-start">
              {savingPassword ? <Loader2 className="size-4 animate-spin" /> : passwordSaved ? <Check className="size-4" /> : null}
              {savingPassword ? "جاري التغيير..." : passwordSaved ? "تم التغيير" : "تغيير كلمة المرور"}
            </Button>
          </div>
        </div>

        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

        {/* Logout */}
        <div className="border-t pt-4">
          <Button variant="outline" onClick={handleLogout} className="text-destructive hover:text-destructive">
            <LogOut className="size-4" />
            تسجيل الخروج
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
