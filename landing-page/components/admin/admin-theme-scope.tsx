"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Radix portals (Dialog, Sheet, Tooltip, etc.) mount straight to
 * document.body, escaping any nested wrapper div's "dark" class — so
 * scoping dark mode to /admin has to happen on <html> itself, not a
 * wrapper inside the tree. Mounted once in the root layout (shared with
 * the light marketing site), toggles based on route so nothing outside
 * /admin is affected.
 */
export function AdminThemeScope() {
  const pathname = usePathname();

  useEffect(() => {
    const isAdmin = pathname?.startsWith("/admin") ?? false;
    document.documentElement.classList.toggle("dark", isAdmin);
    return () => {
      document.documentElement.classList.remove("dark");
    };
  }, [pathname]);

  return null;
}
