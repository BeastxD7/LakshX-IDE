import { supabaseAdmin } from "../../../../lib/supabase/admin";
import { UsersTable, type AdminUserRow } from "../../../../components/admin/users-table";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../components/ui/card";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const admin = supabaseAdmin();
  const { data: users } = await admin.from("admin_user_usage").select("*").order("total_cost_usd", { ascending: false });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-foreground">Users</h1>
        <p className="text-sm text-muted-foreground">{users?.length ?? 0} total — search, sort, and adjust individual credit caps.</p>
      </div>

      <Card className="bg-card">
        <CardHeader>
          <CardTitle>All users</CardTitle>
        </CardHeader>
        <CardContent>
          <UsersTable data={(users ?? []) as AdminUserRow[]} />
        </CardContent>
      </Card>
    </div>
  );
}
