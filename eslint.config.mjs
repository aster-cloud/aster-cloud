import { globalIgnores } from "eslint/config";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import nextPlugin from "@next/eslint-plugin-next";

const eslintConfig = [
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    ".open-next/**",
    "next-env.d.ts",
  ]),
  {
    files: ["**/*.{ts,tsx}"],
    plugins: {
      "@typescript-eslint": tsPlugin,
      "react": reactPlugin,
      "react-hooks": reactHooksPlugin,
      "@next/next": nextPlugin,
    },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      react: { version: "detect" },
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      ...reactPlugin.configs["jsx-runtime"].rules,
      ...reactHooksPlugin.configs.recommended.rules,
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      // Next.js 默认行为：允许 _ 前缀的未使用变量
      "@typescript-eslint/no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      }],
      // R8-FE-1：禁止生产代码从 lib/__internal__/* 导入 —— 那是测试夹具专区。
      // 测试文件 (__tests__) 通过下面的 override 放行。
      "no-restricted-imports": ["error", {
        patterns: [
          {
            group: ["**/lib/__internal__/*", "@/lib/__internal__/*"],
            message:
              "lib/__internal__/* 仅供测试导入。生产代码请使用 lexicon-availability 公开 API。",
          },
        ],
      }],
    },
  },
  {
    // 测试文件可自由 import __internal__ 测试助手
    files: [
      "src/__tests__/**/*.{ts,tsx}",
      "**/*.test.{ts,tsx}",
      "**/*.spec.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": "off",
    },
  },
];

export default eslintConfig;
