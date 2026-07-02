import "./globals.css";

export const metadata = {
  title: "NBA Value Added Tracker",
  description: "Spencer vs. Trey · Value Added across every NBA season",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
