"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Loader2, ShieldAlert } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AccountCard,
  SecurityCard,
  SessionCard,
  LogoutCard,
  type AdminProfile,
} from "@/components/profile/profile-cards";

// Profile page — Arabic UI, four sections (Account, Security, Session,
// Logout). The page owns the form state and handlers; the section components
// in profile-cards.tsx own the presentation. When mustChangePassword is true,
// a destructive banner explains the lock and the Account section's username
// edit is disabled. The Security section stays enabled — it's the escape
// hatch from the force-change lock.
export default function ProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = React.useState<AdminProfile | null>(null);
  const [loading, setLoading] = React.useState(true);

  const [username, setUsername] = React.useState("");
  const [savingProfile, setSavingProfile] = React.useState(false);
  const [profileSaved, setProfileSaved] = React.useState(false);
  const [profileError, setProfileError] = React.useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [savingPassword, setSavingPassword] = React.useState(false);
  const [passwordSaved, setPasswordSaved] = React.useState(false);
  const [passwordError, setPasswordError] = React.useState<string | null>(null);

  const [loggingOut, setLoggingOut] = React.useState(false);

  const loadProfile = React.useCallback(async () => {
    const res = await fetch("/api/auth/me");
    const json = await res.json();
    if (json.success) {
      setProfile(json.data);
      setUsername(json.data.username);
    }
    setLoading(false);
  }, []);

  React.useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const handleSaveProfile = async () => {
    setSavingProfile(true);
    setProfileError(null);
    try {
      const res = await fetch("/api/auth/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      const json = await res.json();
      if (json.success) {
        setProfileSaved(true);
        setProfile((p) => (p ? { ...p, username: json.data.username } : p));
        setTimeout(() => setProfileSaved(false), 2500);
      } else {
        setProfileError(json.error?.message || "فشل التحديث");
      }
    } catch {
      setProfileError("خطأ في الشبكة");
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async () => {
    setPasswordError(null);
    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError("يرجى إدخال جميع الحقول");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("كلمة المرور الجديدة وتأكيدها غير متطابقين");
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError("كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل");
      return;
    }
    if (newPassword === currentPassword) {
      setPasswordError("كلمة المرور الجديدة يجب أن تكون مختلفة عن الحالية");
      return;
    }
    setSavingPassword(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      });
      const json = await res.json();
      if (json.success) {
        setPasswordSaved(true);
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        await loadProfile();
        router.refresh();
        setTimeout(() => setPasswordSaved(false), 2500);
      } else {
        setPasswordError(json.error?.message || "فشل تغيير كلمة المرور");
      }
    } catch {
      setPasswordError("خطأ في الشبكة");
    } finally {
      setSavingPassword(false);
    }
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
      router.refresh();
    } finally {
      setLoggingOut(false);
    }
  };

  if (loading || !profile) {
    return (
      <div className="flex items-center justify-center py-20" dir="rtl">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const mustChange = profile.mustChangePassword;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 sm:py-10" dir="rtl">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="flex flex-col gap-6"
      >
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            الملف الشخصي
          </h1>
          <p className="text-sm text-muted-foreground">إدارة حساب المسؤول</p>
        </div>

        {mustChange && (
          <Alert variant="destructive">
            <ShieldAlert className="size-4" />
            <AlertTitle>تنبيه أمني</AlertTitle>
            <AlertDescription>
              يجب تغيير كلمة المرور الافتراضية قبل متابعة استخدام النظام.
            </AlertDescription>
          </Alert>
        )}

        <AccountCard
          username={username}
          onUsernameChange={setUsername}
          currentUsername={profile.username}
          mustChange={mustChange}
          saving={savingProfile}
          saved={profileSaved}
          error={profileError}
          onSave={handleSaveProfile}
        />

        <SecurityCard
          currentPassword={currentPassword}
          newPassword={newPassword}
          confirmPassword={confirmPassword}
          saving={savingPassword}
          saved={passwordSaved}
          error={passwordError}
          onCurrentChange={setCurrentPassword}
          onNewChange={setNewPassword}
          onConfirmChange={setConfirmPassword}
          onSubmit={handleChangePassword}
        />

        <SessionCard profile={profile} />

        <LogoutCard onLogout={handleLogout} loading={loggingOut} />
      </motion.div>
    </div>
  );
}
