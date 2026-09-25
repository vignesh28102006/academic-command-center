import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Academic Command Center",
  description: "College assignments, exams, deadlines and announcements in one place."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}