import "./globals.css";

export const metadata = {
  title: "NBA Box Score Value Added Tracker",
  description: "Value Added across every NBA season",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
