import { RootProvider } from "fumadocs-ui/provider";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { ReactNode } from "react";
import { baseUrl } from "@/lib/utils";
import { createMetadata } from "@/lib/metadata";
import "./global.css";

export const metadata = createMetadata({
  title: {
    template: "%s | OpenMDM",
    default: "OpenMDM",
  },
  description:
    "A modern, embeddable MDM (Mobile Device Management) SDK for Android.",
  metadataBase: baseUrl,
});

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="icon" href="/favicon.ico" sizes="any" />
      </head>
      <body
        className={`${GeistSans.variable} ${GeistMono.variable} bg-background font-sans`}
      >
        <RootProvider
          theme={{
            defaultTheme: "dark",
          }}
        >
          {children}
        </RootProvider>
      </body>
    </html>
  );
}
