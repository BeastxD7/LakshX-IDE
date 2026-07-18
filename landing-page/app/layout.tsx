import type { Metadata } from "next";
import { Inter, Poppins, Playfair_Display, Geist } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { AdminThemeScope } from "@/components/admin/admin-theme-scope";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-poppins",
  display: "swap",
});

// Elegant italic serif, used only for the Hero headline — gives it a
// refined, slightly flowing feel without going full script/handwriting
// (which reads unprofessional for an IDE product headline).
const playfair = Playfair_Display({
  subsets: ["latin"],
  weight: ["700", "900"],
  style: ["italic"],
  variable: "--font-playfair",
  display: "swap",
});

const TITLE = "LakshX — India's #1 Agentic Coding IDE";
const DESCRIPTION =
  "LakshX is India's #1 agentic coding IDE — a VS Code fork with a real coding agent inside: it plans, edits, and runs commands across your repo, with the safety mode you choose. Runs locally, bring your own model.";

export const metadata: Metadata = {
  metadataBase: new URL("https://lakshx.in"),
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    "LakshX",
    "agentic IDE",
    "AI coding assistant",
    "VS Code fork",
    "coding agent",
    "AI IDE India",
  ],
  authors: [{ name: "LakshX" }],
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "https://lakshx.in",
    siteName: "LakshX",
    type: "website",
    locale: "en_IN",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn(inter.variable, poppins.variable, playfair.variable, "font-sans", geist.variable)}>
      <body>
        <AdminThemeScope />
        {children}
      </body>
    </html>
  );
}
