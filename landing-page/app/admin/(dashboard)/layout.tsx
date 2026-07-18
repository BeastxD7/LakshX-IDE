import { createClient } from "../../../lib/supabase/server";
import { AppSidebar } from "../../../components/admin/app-sidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "../../../components/ui/sidebar";
import { TooltipProvider } from "../../../components/ui/tooltip";
import { Separator } from "../../../components/ui/separator";

export default async function AdminDashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="dark">
      <TooltipProvider>
        <SidebarProvider>
          <AppSidebar email={user?.email} />
          <SidebarInset className="bg-background">
            <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
              <SidebarTrigger />
              <Separator orientation="vertical" className="mr-2 h-4" />
              <span className="text-sm font-medium text-foreground">LakshX Admin</span>
            </header>
            <main className="flex-1 p-6">{children}</main>
          </SidebarInset>
        </SidebarProvider>
      </TooltipProvider>
    </div>
  );
}
