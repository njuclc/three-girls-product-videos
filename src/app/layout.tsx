import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Product video config",
  description: "Configure per-color demo videos for Shopify products",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
