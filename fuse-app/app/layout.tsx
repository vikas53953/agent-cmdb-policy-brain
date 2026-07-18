import type { Metadata, Viewport } from "next";
import "./globals.css";

// Root layout: the html/body document shell and the app-wide metadata only. The
// persistent app chrome (top bar, dock, tabs, profile sheet) lives one level down in
// the (app) route group's layout — deliberately NOT here — so surfaces that must NOT
// carry the signed-in chrome (the branded /login screen) render clean, with no dead
// tabs or a dead Sign-out control on a signed-out page (R17: no dead controls).

export const metadata: Metadata = {
  title: "Fuse",
  description: "One player for every music source — songs that melt into each other.",
};

export const viewport: Viewport = {
  themeColor: "#0b0e12",
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
