"use client";

import { useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { updateModelPlan } from "../../app/admin/actions";

export type ModelPlanRow = {
  model: string;
  requiredPlan: "free" | "pro";
};

/**
 * Auto-submits on change (no separate Save button) — a two-value plan
 * toggle reads better as "pick a value, it's saved" than a form you have to
 * remember to submit. Shows a brief inline status so a save that fails
 * (e.g. a stale admin session) is never silently swallowed.
 */
function PlanSelect({ row }: { row: ModelPlanRow }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  return (
    <form
      ref={formRef}
      action={async (formData) => {
        setStatus("saving");
        setErrorMsg(null);
        try {
          await updateModelPlan(formData);
          setStatus("saved");
          setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 1500);
        } catch (err) {
          setStatus("error");
          setErrorMsg(err instanceof Error ? err.message : "failed to save");
        }
      }}
      className="flex items-center gap-2"
    >
      <input type="hidden" name="model" value={row.model} />
      <select
        name="requiredPlan"
        defaultValue={row.requiredPlan}
        onChange={() => formRef.current?.requestSubmit()}
        className="h-8 rounded-md border border-input bg-background px-2 text-sm"
      >
        <option value="free">Free</option>
        <option value="pro">Pro</option>
      </select>
      {status === "saving" && <span className="text-xs text-muted-foreground">Saving…</span>}
      {status === "saved" && <span className="text-xs text-emerald-600">Saved</span>}
      {status === "error" && <span className="text-xs text-destructive">{errorMsg}</span>}
    </form>
  );
}

export function ModelPlansTable({ data }: { data: ModelPlanRow[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Model</TableHead>
            <TableHead>Current tier</TableHead>
            <TableHead>Required plan</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.length ? (
            data.map((row) => (
              <TableRow key={row.model}>
                <TableCell className="font-mono text-sm">{row.model}</TableCell>
                <TableCell>
                  <Badge variant={row.requiredPlan === "free" ? "secondary" : "default"}>
                    {row.requiredPlan === "free" ? "Free" : "Pro"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <PlanSelect row={row} />
                </TableCell>
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={3} className="h-24 text-center text-muted-foreground">
                No deployed models found.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
