import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

// Next's own lint set (React, React Hooks, Next's rules) plus the jsx-a11y
// recommended rules, run by `next build` and `npm run lint`. The hooks rules
// are what catch a hook after an early return and a component defined during
// render; jsx-a11y catches click handlers with no keyboard route.
const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

export default [
  { ignores: [".next/**", "node_modules/**", "public/**", "app/data/**"] },
  ...compat.extends("next/core-web-vitals", "plugin:jsx-a11y/recommended"),
  {
    rules: {
      // Hard errors: these are bugs.
      "react-hooks/rules-of-hooks": "error",
      "no-undef": "error",
      "no-unreachable": "error",
      "no-dupe-keys": "error",
      // Off: style, not bugs. Plain apostrophes in JSX text render fine, and
      // the unnamed components are local render helpers.
      "react/no-unescaped-entities": "off",
      "react/display-name": "off",
      // Kept as warnings: each existing case has been read and is deliberate
      // (a dependency left out on purpose, a search box that should take
      // focus when it opens). New ones show up in the build output.
      "react-hooks/exhaustive-deps": "warn",
      "jsx-a11y/no-autofocus": "warn",
      "jsx-a11y/click-events-have-key-events": "warn",
      "jsx-a11y/no-static-element-interactions": "warn",
      "no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^_" }],
    },
  },
];
