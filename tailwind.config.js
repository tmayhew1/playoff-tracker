/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      // Two shades nudged a step darker so their text clears WCAG AA (4.5:1)
      // on the page's own stone-100 background, where the stock values miss
      // by a hair (stone-500 4.39, red-600 4.42). Both now read about 5:1 there
      // and are barely distinguishable from the originals.
      colors: {
        stone: { 500: "#6f6863" },
        red: { 600: "#d1141b" },
      },
      screens: {
        // "Turn the phone sideways" is an ORIENTATION question, not a width
        // one: a landscape iPhone SE is 667px and a landscape Galaxy S8 740px,
        // both below every width breakpoint, so keying this to `md` meant tilt
        // did nothing on a lot of handsets. The width arm keeps tablets and
        // desktops covered, including a tall narrow browser window.
        tilt: { raw: "(orientation: landscape), (min-width: 768px)" },
      },
    },
  },
  plugins: [],
};
