// Web app manifest: the name and icon a phone uses when the site is added to
// its Home Screen. `display: "browser"` keeps it opening as an ordinary tab —
// the app relies on the address bar (shared links) and on BuildWatch's
// tab-refocus check, so it is not asking to run standalone.
export default function manifest() {
  return {
    name: "NBA Box Score Value Added Tracker",
    short_name: "Value Added",
    description: "Value Added across every NBA season",
    start_url: "/",
    display: "browser",
    background_color: "#f5f5f4",
    theme_color: "#f5f5f4",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
