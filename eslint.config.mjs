import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = [
  ...nextVitals,
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "server/dist/**",
      "shared/dist/**",
      "coverage/**",
      "next-env.d.ts",
    ],
  },
  {
    rules: {
      // React Compiler rules are valuable for future optimization, but enabling
      // them as hard errors during the Next 16 lint migration flags hundreds of
      // existing patterns unrelated to correctness. Keep the institutional lint
      // gate focused on Next, accessibility, and core hooks rules for now.
      "react-hooks/error-boundaries": "off",
      "react-hooks/immutability": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/purity": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "@next/next/no-html-link-for-pages": "off",
    },
  },
];

export default eslintConfig;
