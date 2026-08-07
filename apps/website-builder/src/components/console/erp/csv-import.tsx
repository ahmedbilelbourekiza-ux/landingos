"use client";

import { useRef, useState } from "react";

import { useApiAction, ActionError, ActionButton } from "@/components/console/api-action";
import type { ActionErrors } from "@/lib/console/action-errors";

/* =============================================================================
 * Loading a file — LP.19, closing R5's import and R17's.
 *
 * PREVIEW FIRST, AND THE BUTTON ORDER SAYS SO. The commit control is disabled
 * until a preview has run against THIS file: an import writes into a live
 * registry, and "how many will this create" is a question with an answer that
 * costs nothing to ask. The preview and the commit are the same request with a
 * different `mode` (D-LP.19.2), so the numbers cannot describe different work.
 *
 * THE FILE IS READ IN THE BROWSER AND SENT AS TEXT — it is not PARSED here.
 * D-LP.19.1: one parser, on the server, contract-tested. `FileReader` produces a
 * string and that string is the payload; everything about what a column means is
 * decided in `lib/erp/import.ts`.
 * ========================================================================== */

export interface ImportStrings {
  readonly saving: string;
  readonly panel: string;
  readonly hint: string;
  readonly file: string;
  readonly source: string;
  readonly preview: string;
  readonly commit: string;
  readonly created: string;
  readonly merged: string;
  readonly duplicates: string;
  readonly skipped: string;
  readonly rows: string;
  readonly previewFirst: string;
  readonly done: string;
}

interface Outcome {
  rows?: number;
  created?: number;
  merged?: number;
  duplicates?: number;
  skipped?: number;
  skippedRows?: { row: number; reason: string }[];
  dedupBy?: string;
}

export function CsvImportPanel({
  endpoint,
  errors,
  s,
  testId,
}: {
  /** `/api/erp/clients/import` or `/api/erp/orders/import`. */
  readonly endpoint: string;
  readonly errors: ActionErrors;
  readonly s: ImportStrings;
  readonly testId: string;
}) {
  const { run, pending, error } = useApiAction(errors);
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState("");
  const [csv, setCsv] = useState<string | null>(null);
  const [preview, setPreview] = useState<Outcome | null>(null);
  const [committed, setCommitted] = useState<Outcome | null>(null);

  const readFile = async (file: File | null | undefined) => {
    // A new file invalidates the previous preview. Without this an operator can
    // preview one file, pick another, and commit the second on the first's
    // numbers.
    setPreview(null);
    setCommitted(null);
    setCsv(file ? await file.text() : null);
  };

  const send = async (mode: "preview" | "commit") => {
    if (!csv) return;
    const { ok, data } = await run("POST", endpoint, {
      mode,
      csv,
      ...(source.trim() ? { source: source.trim() } : {}),
    });
    if (!ok) return;
    if (mode === "preview") setPreview(data as Outcome);
    else {
      setCommitted(data as Outcome);
      setPreview(null);
      setCsv(null);
      if (input.current) input.current.value = "";
    }
  };

  const counts = (o: Outcome) =>
    [
      `${s.rows}: ${o.rows ?? 0}`,
      `${s.created}: ${o.created ?? 0}`,
      o.merged !== undefined ? `${s.merged}: ${o.merged}` : null,
      o.duplicates !== undefined ? `${s.duplicates}: ${o.duplicates}` : null,
      `${s.skipped}: ${o.skipped ?? 0}`,
    ]
      .filter(Boolean)
      .join(" · ");

  return (
    <section className="mt-3 rounded-lg border border-border p-4" data-testid={testId}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">{s.panel}</h2>
        <ActionButton
          data-testid={`${testId}-toggle`}
          pending={false}
          pendingLabel={s.saving}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          {s.panel}
        </ActionButton>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{s.hint}</p>

      {/* D-06.4: rendered always, hidden when closed. */}
      <div hidden={!open} className="mt-3 space-y-3">
        <div>
          <label htmlFor={`${testId}-file`} className="block text-xs text-muted-foreground">
            {s.file}
          </label>
          <input
            id={`${testId}-file`}
            data-testid={`${testId}-file`}
            ref={input}
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => void readFile(e.target.files?.[0])}
            className="mt-1 block text-sm"
          />
        </div>

        <div>
          <label htmlFor={`${testId}-source`} className="block text-xs text-muted-foreground">
            {s.source}
          </label>
          <input
            id={`${testId}-source`}
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="mt-1 w-full max-w-xs rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <ActionButton
            data-testid={`${testId}-preview`}
            pending={pending}
            pendingLabel={s.saving}
            disabled={!csv}
            onClick={() => void send("preview")}
          >
            {s.preview}
          </ActionButton>
          {/* Disabled until THIS file has been previewed. An import writes into
              a live registry and the question costs nothing to ask. */}
          <ActionButton
            data-testid={`${testId}-commit`}
            pending={pending}
            pendingLabel={s.saving}
            disabled={!csv || !preview}
            variant="primary"
            onClick={() => void send("commit")}
          >
            {s.commit}
          </ActionButton>
          {!preview && csv && (
            <span className="text-xs text-muted-foreground">{s.previewFirst}</span>
          )}
        </div>

        {preview && (
          <p data-testid={`${testId}-preview-result`} className="text-sm">
            {counts(preview)}
          </p>
        )}
        {committed && (
          <p data-testid={`${testId}-result`} className="text-sm">
            {s.done} — {counts(committed)}
          </p>
        )}

        {/* Per row, so a 400-row file with three bad numbers names those three
            rather than reporting "3 skipped" and leaving somebody to find them. */}
        {(preview?.skippedRows?.length || committed?.skippedRows?.length) && (
          <ul
            data-testid={`${testId}-skipped`}
            className="max-h-40 overflow-y-auto text-xs text-muted-foreground"
          >
            {(preview?.skippedRows ?? committed?.skippedRows ?? []).slice(0, 50).map((r) => (
              <li key={r.row}>
                {s.rows} {r.row}: {r.reason}
              </li>
            ))}
          </ul>
        )}

        <ActionError message={error} />
      </div>
    </section>
  );
}
