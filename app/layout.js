import "./globals.css";
import { BuildWatch } from "./components/build-watch";

// The whole app sets in Times New Roman, which every phone and laptop already
// has (Liberation Serif, its metric twin, stands in on Linux), so there is no
// web font to download and nothing reflows when one arrives. The face is set
// once, on <body>, in globals.css.

export const metadata = {
  title: "NBA Box Score Value Added Tracker",
  description: "Value Added across every NBA season",
};

// No maximumScale/userScalable lock: pinch-zoom stays available on phones,
// where the dense stat tables most need it. iOS Safari's auto-zoom on focusing
// a sub-16px input is handled in globals.css instead, by giving text inputs
// 16px on touch screens.
export const viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {/* Renders nothing; reloads the page when a stale phone tab is still
            running a previous deployment. */}
        <BuildWatch />
        {children}
      </body>
    </html>
  );
}
