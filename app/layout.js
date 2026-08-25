import { Inter, Playfair_Display } from "next/font/google";
import "./globals.css";
import { BuildWatch } from "./components/build-watch";

// Self-hosted through next/font rather than an @import in globals.css: an
// @import is only legal before any other rule, and Tailwind's `@tailwind base`
// expands ahead of it, so the imported sheet landed ~24kB into the bundle and
// every browser dropped it on the floor. The faces never loaded anywhere, and
// each platform silently substituted its own UI font — which is why the type
// looked one size on a laptop and another on a phone. next/font also emits a
// metric-adjusted fallback face (size-adjust/ascent-override), so the text
// occupies the same box before and after the real font arrives.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair",
  display: "swap",
});

export const metadata = {
  title: "NBA Box Score Value Added Tracker",
  description: "Value Added across every NBA season",
};

// Pin the scale so iOS Safari doesn't auto-zoom when a sub-16px input
// (the player-search fields) gains focus — the app's layout is fixed-width
// and never wants that jump.
export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${inter.variable} ${playfair.variable}`}>
      <body>
        {/* Renders nothing; reloads the page when a stale phone tab is still
            running a previous deployment. */}
        <BuildWatch />
        {children}
      </body>
    </html>
  );
}
