/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
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
