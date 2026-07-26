// Shared application types. Kept intentionally small at the foundation stage;
// domain types (products, landing pages, submissions) will be added alongside
// their Prisma models in later tasks.

export type ID = string;

// Canonical envelope for every JSON API response. Routes return either a
// success payload or a structured error — never a bare value — so the client
// can rely on a single discriminated shape.
export type ApiResponse<T = unknown> =
  | { success: true; data: T }
  | {
      success: false;
      error: { code: string; message: string; details?: unknown };
    };
