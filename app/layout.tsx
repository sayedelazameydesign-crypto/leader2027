import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Leader 2027 — لوحة القيادة",
  description: "منصة Leader 2027 الإنتاجية: الحسابات والبيانات في لوحة واحدة.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
