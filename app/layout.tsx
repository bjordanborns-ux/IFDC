import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  metadataBase: new URL("https://iss-mission-control.kola-koala.chatgpt.site"),
  title: "ISS Mission Control",
  description:
    "Live International Space Station ground track, telemetry, and simulated orbital camera console.",
  openGraph: {
    title: "ISS Mission Control",
    description: "Live orbital tracking and telemetry",
    images: ["/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "ISS Mission Control",
    description: "Live orbital tracking and telemetry",
    images: ["/og.png"],
  },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
