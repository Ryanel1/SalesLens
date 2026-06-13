import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SalesLens",
  description: "Private sales reporting for Lester Sales.",
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
