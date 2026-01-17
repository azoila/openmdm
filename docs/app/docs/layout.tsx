import { DocsLayout } from "fumadocs-ui/layouts/docs";
import type { ReactNode } from "react";
import { source } from "@/lib/source";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      tree={source.pageTree}
      nav={{
        title: "OpenMDM",
        url: "/",
      }}
      links={[
        {
          text: "GitHub",
          url: "https://github.com/azoila/openmdm",
          external: true,
        },
      ]}
    >
      {children}
    </DocsLayout>
  );
}
