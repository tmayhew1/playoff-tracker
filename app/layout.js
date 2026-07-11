import "./globals.css";

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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
