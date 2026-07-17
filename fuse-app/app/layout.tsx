import type { Metadata, Viewport } from "next";
import "./globals.css";

// U1 ships the minimal root layout. The full app shell — bottom tabs, the
// persistent mini-player, and the profile sheet — is built in U4.
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
