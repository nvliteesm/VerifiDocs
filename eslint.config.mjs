// ESLint (flat config). `next lint` was removed in Next 16, so `npm run lint` runs ESLint directly.
//   - eslint-config-next: React, React Hooks and Next rules, plus TypeScript.
//   - jsx-a11y: the accessibility rules that can be checked from source. They catch what the antislop and WCAG
//     checks care about before the browser does (missing labels, click handlers on non-interactive elements, ...).
//     They complement the manual keyboard and screen-reader checks; they do not replace them.
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import jsxA11y from "eslint-plugin-jsx-a11y";

const eslintConfig = [
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts", ".playwright-mcp/**", "coverage/**"] },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    // The plugin is already registered by eslint-config-next, so only its recommended rules are added here.
    files: ["**/*.{js,jsx,ts,tsx}"],
    rules: { ...jsxA11y.flatConfigs.recommended.rules },
  },
];

export default eslintConfig;
