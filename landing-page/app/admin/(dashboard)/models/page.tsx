import { supabaseAdmin } from "../../../../lib/supabase/admin";
import { CHAT_COMPLETIONS_MODELS, RESPONSES_API_MODELS } from "../../../../lib/hosted-models";
import { ModelPlansTable, type ModelPlanRow } from "../../../../components/admin/model-plans-table";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../components/ui/card";

export const dynamic = "force-dynamic";

export default async function AdminModelsPage() {
  const admin = supabaseAdmin();
  const { data: rows } = await admin.from("hosted_model_plans").select("model, required_plan");

  const requiredPlanByModel = new Map((rows ?? []).map((r) => [r.model, r.required_plan as "free" | "pro"]));
  // Every model actually deployed on Azure (see hosted-models.ts) gets a row
  // even if hosted_model_plans has none for it yet — matches the runtime
  // fail-closed default (getRequiredPlan() also defaults to 'pro') so the
  // admin never sees a model silently missing from this list.
  const allModels = new Set([...CHAT_COMPLETIONS_MODELS, ...RESPONSES_API_MODELS]);
  const data: ModelPlanRow[] = [...allModels]
    .sort()
    .map((model) => ({ model, requiredPlan: requiredPlanByModel.get(model) ?? "pro" }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-foreground">Models</h1>
        <p className="text-sm text-muted-foreground">
          Which plan each hosted model requires. Free users are rejected with a 403 (and shown an upgrade prompt in the
          IDE) if they select a model set to Pro here. A model with no row yet defaults to Pro — nothing is
          accidentally Free-accessible.
        </p>
      </div>

      <Card className="bg-card">
        <CardHeader>
          <CardTitle>Hosted models</CardTitle>
        </CardHeader>
        <CardContent>
          <ModelPlansTable data={data} />
        </CardContent>
      </Card>
    </div>
  );
}
