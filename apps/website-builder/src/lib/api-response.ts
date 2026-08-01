import { NextResponse } from "next/server";
import { ZodError } from "zod";
import type { ApiResponse } from "@/types";

// Helpers that keep route handlers thin and consistent. Every route returns
// the same ApiResponse envelope, so error handling and typing stay uniform
// across the codebase.

export function ok<T>(data: T, status = 200) {
  return NextResponse.json<ApiResponse<T>>(
    { success: true, data },
    { status },
  );
}

export function fail(
  code: string,
  message: string,
  status = 400,
  details?: unknown,
) {
  return NextResponse.json<ApiResponse<never>>(
    { success: false, error: { code, message, details } },
    { status },
  );
}

export function fromZodError(error: ZodError) {
  return fail("VALIDATION_ERROR", "Request validation failed", 422, error.issues);
}

export function serverError(message = "Internal server error") {
  return fail("INTERNAL_ERROR", message, 500);
}
