"use client";

import * as React from "react";
import {
  User,
  Lock,
  Loader2,
  Check,
  LogOut,
  Clock,
  Calendar,
  KeyRound,
  CheckCircle2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionCard, InfoRow, formatArabicDate } from "./profile-ui";

// Each section of the Profile page is its own presentational component. The
// page itself owns the state + handlers and threads them through. This keeps
// the page route focused on orchestration and under the page-size budget.

export interface AdminProfile {
  id: string;
  username: string;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  lastPasswordChangeAt: string | null;
  createdAt: string;
}

// 1. Account Information — username edit. Locked while mustChangePassword.
export function AccountCard({
  username,
  onUsernameChange,
  currentUsername,
  mustChange,
  saving,
  saved,
  error,
  onSave,
}: {
  username: string;
  onUsernameChange: (v: string) => void;
  currentUsername: string;
  mustChange: boolean;
  saving: boolean;
  saved: boolean;
  error: string | null;
  onSave: () => void;
}) {
  return (
    <SectionCard
      title="معلومات الحساب"
      icon={User}
      description="اسم المستخدم الخاص بحساب المسؤول"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="username">اسم المستخدم</Label>
        <Input
          id="username"
          value={username}
          onChange={(e) => onUsernameChange(e.target.value)}
          dir="ltr"
          disabled={mustChange || saving}
          autoComplete="username"
        />
        <p className="text-xs text-muted-foreground">
          {mustChange
            ? "تعديل اسم المستخدم معطّل حتى يتم تغيير كلمة المرور الافتراضية."
            : "يمكن استخدام أحرف لاتينية وأرقام ونقطة وشرطة وشرطة سفلية فقط."}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <Button
          onClick={onSave}
          disabled={mustChange || saving || username === currentUsername}
        >
          {saving ? (
            <Loader2 className="size-4 animate-spin" />
          ) : saved ? (
            <Check className="size-4" />
          ) : null}
          {saving ? "جاري الحفظ..." : saved ? "تم الحفظ" : "حفظ"}
        </Button>
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>
    </SectionCard>
  );
}

// 2. Security — change password. Always enabled (the escape hatch from the
// force-change lock).
export function SecurityCard({
  currentPassword,
  newPassword,
  confirmPassword,
  saving,
  saved,
  error,
  onCurrentChange,
  onNewChange,
  onConfirmChange,
  onSubmit,
}: {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
  saving: boolean;
  saved: boolean;
  error: string | null;
  onCurrentChange: (v: string) => void;
  onNewChange: (v: string) => void;
  onConfirmChange: (v: string) => void;
  onSubmit: () => void;
}) {
  return (
    <SectionCard
      title="الأمان"
      icon={Lock}
      description="تغيير كلمة المرور بشكل دوري يحمي حسابك"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="currentPassword">كلمة المرور الحالية</Label>
        <Input
          id="currentPassword"
          type="password"
          value={currentPassword}
          onChange={(e) => onCurrentChange(e.target.value)}
          dir="ltr"
          disabled={saving}
          autoComplete="current-password"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="newPassword">كلمة المرور الجديدة</Label>
        <Input
          id="newPassword"
          type="password"
          value={newPassword}
          onChange={(e) => onNewChange(e.target.value)}
          dir="ltr"
          disabled={saving}
          autoComplete="new-password"
        />
        <p className="text-xs text-muted-foreground">
          8 أحرف على الأقل، يفضّل مزج أحرف كبيرة وصغيرة وأرقام ورموز.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="confirmPassword">تأكيد كلمة المرور الجديدة</Label>
        <Input
          id="confirmPassword"
          type="password"
          value={confirmPassword}
          onChange={(e) => onConfirmChange(e.target.value)}
          dir="ltr"
          disabled={saving}
          autoComplete="new-password"
        />
      </div>
      <div className="flex items-center gap-3">
        <Button onClick={onSubmit} disabled={saving}>
          {saving ? (
            <Loader2 className="size-4 animate-spin" />
          ) : saved ? (
            <Check className="size-4" />
          ) : null}
          {saving ? "جاري التغيير..." : saved ? "تم التغيير" : "تغيير كلمة المرور"}
        </Button>
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        {saved && (
          <p className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-500">
            <CheckCircle2 className="size-4" />
            تم تحديث كلمة المرور بنجاح
          </p>
        )}
      </div>
    </SectionCard>
  );
}

// 3. Session — read-only audit info.
export function SessionCard({ profile }: { profile: AdminProfile }) {
  const mustChange = profile.mustChangePassword;
  return (
    <SectionCard
      title="الجلسة والنشاط"
      icon={Clock}
      description="معلومات آخر نشاط على الحساب"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <InfoRow
          icon={User}
          label="اسم المستخدم"
          value={profile.username}
          dir="ltr"
        />
        <InfoRow
          icon={KeyRound}
          label="حالة كلمة المرور"
          value={mustChange ? "افتراضية — يجب التغيير" : "مُحدّثة"}
          tone={mustChange ? "warning" : "ok"}
        />
        <InfoRow
          icon={Calendar}
          label="تاريخ إنشاء الحساب"
          value={formatArabicDate(profile.createdAt)}
        />
        <InfoRow
          icon={Clock}
          label="آخر تسجيل دخول"
          value={formatArabicDate(profile.lastLoginAt)}
        />
        <InfoRow
          icon={Lock}
          label="آخر تغيير لكلمة المرور"
          value={formatArabicDate(profile.lastPasswordChangeAt)}
        />
      </div>
    </SectionCard>
  );
}

// 4. Logout — clears the session cookie.
export function LogoutCard({
  onLogout,
  loading,
}: {
  onLogout: () => void;
  loading: boolean;
}) {
  return (
    <SectionCard
      title="تسجيل الخروج"
      icon={LogOut}
      description="إنهاء الجلسة الحالية والعودة إلى صفحة تسجيل الدخول"
    >
      <Button
        variant="outline"
        onClick={onLogout}
        disabled={loading}
        className="text-destructive hover:text-destructive"
      >
        {loading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <LogOut className="size-4" />
        )}
        {loading ? "جاري الخروج..." : "تسجيل الخروج"}
      </Button>
    </SectionCard>
  );
}
