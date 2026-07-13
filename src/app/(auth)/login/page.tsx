"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Lock, User, AlertCircle, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/shared/logo";
import { Alert, AlertDescription } from "@/components/ui/alert";

// Login page — Arabic UI, single-column form, server-side authentication via
// /api/auth/login (bcrypt + signed JWT cookie).
//
// The middleware redirects already-authenticated users away from /login, so
// reaching this page means the user is unauthenticated (or was sent here by
// a 401/403 in the protected area).
//
// We split the route into an outer <Login /> (Suspense boundary so the static
// shell renders even though useSearchParams forces the inner component into
// dynamic rendering) and an inner <LoginForm />.
export default function LoginPage() {
  return (
    <React.Suspense fallback={<LoginFallback />}>
      <LoginForm />
    </React.Suspense>
  );
}

function LoginFallback() {
  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center bg-muted/30 px-4"
      dir="rtl"
    >
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next");

  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setError("يرجى إدخال جميع الحقول");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const json = await res.json();

      if (res.status === 429) {
        // Rate-limited — the server returns an Arabic message; surface it
        // verbatim so the user knows how long to wait.
        setError(
          json?.error?.message ||
            "تم تجاوز عدد محاولات تسجيل الدخول، حاول مرة أخرى بعد عدة دقائق.",
        );
        setLoading(false);
        return;
      }

      if (!json.success) {
        setError(json.error?.message || "فشل تسجيل الدخول");
        setLoading(false);
        return;
      }

      // Force-change flow: send to Profile so the default password gets
      // changed before any other dashboard page becomes available.
      const mustChange = Boolean(json.data?.mustChangePassword);
      const target = mustChange ? "/dashboard/profile" : next || "/dashboard";
      router.push(target);
      router.refresh();
    } catch {
      setError("خطأ في الشبكة");
      setLoading(false);
    }
  };

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center bg-muted/30 px-4 py-10"
      dir="rtl"
    >
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3">
          <Logo />
          <h1 className="text-2xl font-bold tracking-tight">تسجيل الدخول</h1>
          <p className="text-sm text-muted-foreground">لوحة تحكم LandingOS</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-4 rounded-2xl border bg-card p-6 shadow-sm"
          noValidate
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="username">اسم المستخدم</Label>
            <div className="relative">
              <User className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin"
                className="pr-9"
                dir="ltr"
                autoComplete="username"
                disabled={loading}
                required
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">كلمة المرور</Label>
            <div className="relative">
              <Lock className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="pr-9"
                dir="ltr"
                autoComplete="current-password"
                disabled={loading}
                required
              />
            </div>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="size-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Button type="submit" disabled={loading} className="h-11 w-full">
            {loading && <Loader2 className="size-4 animate-spin" />}
            {loading ? "جاري الدخول..." : "تسجيل الدخول"}
          </Button>
        </form>

        <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
          <ShieldAlert className="size-3.5" />
          منطقة محمية — للاستخدام الداخلي فقط
        </p>
      </div>
    </div>
  );
}
