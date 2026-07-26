import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { NewLandingForm } from "@/components/landings/new-landing-form";

export const metadata: Metadata = {
  title: "New Landing",
};

// Create-landing flow. Deliberately short — the goal is a page record in
// under 30 seconds. Everything else (media, variants, content, settings)
// is added later on the edit page. The form POSTs to /api/landings and
// redirects to the edit route with the real id.
export default function NewLandingPage() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-4">
          <Link
            href="/dashboard/landings"
            className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Back to Landing Pages
          </Link>
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              New Landing Page
            </h1>
            <p className="text-sm text-muted-foreground">
              Create a landing page in seconds. You can add details after.
            </p>
          </div>
        </div>

        <NewLandingForm />
      </div>
    </div>
  );
}
