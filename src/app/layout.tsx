import type { Metadata, Viewport } from "next";
import PWAInstallPrompt from "../components/PWAInstallPrompt";
import "./globals.css";

export const metadata: Metadata = {
  title: "WheelDesk",
  description: "Options structure, wheel strategy, validation, and Control Center analytics.",
  applicationName: "WheelDesk",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "WheelDesk",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icons/wheeldesk-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/wheeldesk-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/wheeldesk-192.png", sizes: "192x192", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#071523",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#071523" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body>
        {children}
        <PWAInstallPrompt />
      </body>
    </html>
  );
}
