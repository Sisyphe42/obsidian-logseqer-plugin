// eslint.config.mjs
import tsparser from "@typescript-eslint/parser";
import typescriptPlugin from "@typescript-eslint/eslint-plugin";
import obsidianPlugin from "eslint-plugin-obsidianmd";

export default [
  {
    ignores: ["node_modules/**", "dist/**", "esbuild.config.mjs"],
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: { 
        project: "./tsconfig.json",
      },
      ecmaVersion: "latest",
      sourceType: "module",
    },
    plugins: {
      "@typescript-eslint": typescriptPlugin,
      obsidianmd: obsidianPlugin,
    },
    rules: {
      ...typescriptPlugin.configs.recommended.rules,
      
      // Obsidian plugin rules
      "obsidianmd/no-static-styles-assignment": "warn",
      "obsidianmd/hardcoded-config-path": "warn",
      "obsidianmd/commands/no-plugin-id-in-command-id": "warn",
      "obsidianmd/no-sample-code": "off",
      
      // TypeScript rules
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-empty-function": "warn",
      "@typescript-eslint/no-non-null-assertion": "warn",
    },
  },
];
