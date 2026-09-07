import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import { ActivityLogger } from "@/components/ActivityLogger";

export const metadata: Metadata = {
  title: "Truck Show Platform",
  description: "Collaborative floorplan maps for trade shows",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <ActivityLogger />
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
