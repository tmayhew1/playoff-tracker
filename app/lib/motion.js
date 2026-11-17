// How a scripted scroll should move: glide, unless the reader has asked their
// system for reduced motion — then jump. CSS can't decide this for
// scrollTo/scrollIntoView calls that name "smooth" themselves (globals.css
// only covers animations, transitions and CSS scroll-behavior), so every such
// call takes its `behavior` from here.
export const scrollBehavior = () => (
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
);
