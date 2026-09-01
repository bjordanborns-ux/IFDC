import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  metadataBase: new URL("https://ifdc-console.kola-koala.chatgpt.site"),
  title: "IFDC Integrated Flight Dynamics Console",
  description:
    "Common-epoch ISS, Starlink, and TDRSS orbital tracking, telemetry, and simulated mission-operations views.",
  openGraph: {
    title: "IFDC Integrated Flight Dynamics Console",
    description: "ISS, Starlink, and TDRSS orbital tracking and telemetry",
    images: ["/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "IFDC Integrated Flight Dynamics Console",
    description: "ISS, Starlink, and TDRSS orbital tracking and telemetry",
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
