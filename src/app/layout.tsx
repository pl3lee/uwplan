import "@/styles/globals.css";

import { GeistSans } from "geist/font/sans";
import { type Metadata } from "next";

export const metadata: Metadata = {
  title: "UWPlan",
  description: "Degree planning tool for University of Waterloo students",
  keywords: [
    "UW",
    "University of Waterloo",
    "degree",
    "planning",
    "tool",
    "course",
    "schedule",
    "course planning",
    "schedule planning",
    "degree planning",
  ],
  icons: [{ rel: "icon", url: "/favicon.svg" }],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${GeistSans.variable}`}>
      <body className="flex min-h-screen flex-col">{children}</body>
    </html>
  );
}
