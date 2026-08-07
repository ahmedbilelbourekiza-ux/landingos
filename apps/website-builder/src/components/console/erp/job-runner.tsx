"use client";

import { useState } from "react";

import { useApiAction, ActionError, ActionButton } from "@/components/console/api-action";
import type { ActionErrors } from "@/lib/console/action-errors";

/* =============================================================================
 * "Run it now" — AUDIT.6.
 *
 * `POST /api/erp/jobs/[job]` has existed since M-15 and **no screen has ever
 * called it.** Its own comment states the operator need it was built for:
 *
 *   > A manager needs to be able to say "run it now" after changing a
 *   > threshold, rather than waiting out an interval to see what it does.
 *
 * and, on the response:
 *
 *   > whoever pressed "run it now" is owed the result.
 *
 * There was no "run it now" to press. The route was reachable only by typing a
 * URL, which is not a workflow — it is a thing an engineer can do.
 *
 * WHY IT BELONGS ON THIS SCREEN AND NOWHERE ELSE. Every job here acts on the
 * rules configured directly above it: the escalation interval, the overdue
 * threshold, the poll cadence, the stale-order window. Changing a number and
 * watching what it does is one act, and splitting it across two screens is how
 * a manager ends up not checking.
 *
 * THE JOB LIST IS THE ROUTE'S OWN — `JOBS` from `lib/erp/jobs.ts`, passed in by
 * the server component. D-LP.3: a second list of job names here would go stale
 * the moment one is added, and it would fail as a button that 404s.
 *
 * D-06.3, and it costs something here: a job can move a lot of rows, so the
 * result is rendered from what the SERVER returned rather than from anything
 * assumed, and the router refreshes so the counts above are re-read.
 * ========================================================================== */

export interface JobStrings {
  readonly runNow: string;
  readonly running: string;
  readonly title: string;
  readonly hint: string;
  /** One label per job name, keyed by the name the route accepts. */
  readonly labels: Readonly<Record<string, string>>;
}

export function JobRunner({
  jobs,
  errors,
  s,
}: {
  /** `JOBS`, from the module the route validates against. */
  readonly jobs: readonly string[];
  readonly errors: ActionErrors;
  readonly s: JobStrings;
}) {
  const { run, pending, error } = useApiAction(errors);
  const [ran, setRan] = useState<{ job: string; summary: string } | null>(null);

  const fire = async (job: string) => {
    const { ok, data } = await run("POST", `/api/erp/jobs/${job}`, {});
    if (ok) {
      /* What a job did, from what it returned. Each one answers a different
         shape — `escalated`, `suspended`, `polled`, `alerted` — so this renders
         the numbers it actually sent rather than a fixed set of fields that
         would silently read zero for three jobs out of four. */
      const result = (data ?? {}) as Record<string, unknown>;
      const parts = Object.entries(result)
        .filter(([k, v]) => k !== "job" && (typeof v === "number" || typeof v === "string"))
        .map(([k, v]) => `${k}: ${v}`);
      setRan({ job, summary: parts.length ? parts.join(" · ") : "—" });
    }
  };

  return (
    <section className="mt-8 rounded-lg border border-border bg-surface-raised p-4" data-testid="job-runner">
      <h2 className="text-sm font-semibold tracking-tight">{s.title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{s.hint}</p>

      <div className="mt-3 flex flex-wrap gap-2">
        {jobs.map((job) => (
          <ActionButton
            key={job}
            data-testid="job-run"
            data-job={job}
            pending={pending}
            pendingLabel={s.running}
            onClick={() => void fire(job)}
          >
            {s.labels[job] ?? job}
          </ActionButton>
        ))}
      </div>

      {ran && (
        <p className="mt-3 text-xs text-muted-foreground" data-testid="job-result" data-job={ran.job}>
          {s.labels[ran.job] ?? ran.job} · {ran.summary}
        </p>
      )}

      <ActionError message={error} />
    </section>
  );
}
