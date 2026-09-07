import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const config = [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      ".next-tline/**",
      ".next-*/**",
      ".runtime/**",
      "storage/**",
      // Vendored pdf.js assets: shipped as published, not ours to lint.
      "public/pdfjs/**",
      "prisma/postgresql/**",
      "next-env.d.ts",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // The codebase leans on inferred types and narrow local casts; keep the linter
      // focused on real defects rather than style the typechecker already covers.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-console": "off",
      // Pages-Router rule: in the App Router the root layout's <head> IS the shared
      // document, so a stylesheet link there already applies to every page.
      "@next/next/no-page-custom-font": "off",
    },
  },
];

export default config;
