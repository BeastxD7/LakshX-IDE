import type { Metadata } from "next";
import type { ReactNode } from "react";
import DocsChrome from "./_components/DocsChrome";

export const metadata: Metadata = {
  title: {
    default: "Docs — LakshX",
    template: "%s — LakshX Docs",
  },
  description:
    "Documentation for LakshX, India's agentic coding IDE: the chat agent, safety modes, Royal mode, slash commands, the interactive browser, checkpoints, database tools, the code graph, and more.",
};

export default function DocsLayout({ children }: { children: ReactNode }) {
  return <DocsChrome>{children}</DocsChrome>;
}
