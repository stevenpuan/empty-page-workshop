import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", ".output", ".vinxi"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
      // 禁用 toISOString().slice()/.substring() 這種「用 UTC 當日期字串」的寫法。
      // 這是反覆出現的時區 bug：UTC+8 的台北在清晨或月初/月底會退回前一天。
      // 日期一律用 @/lib/dates 的 taipeiToday() / toDateStr()。
      // 極少數確為 datetime-local 或純 UTC 邊界的正確用途，請在該行加
      //   // eslint-disable-next-line no-restricted-syntax -- 原因
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.property.name=/^(slice|substring|substr)$/][callee.object.type='CallExpression'][callee.object.callee.property.name='toISOString']",
          message:
            "日期字串請用 @/lib/dates 的 taipeiToday()/toDateStr()（本地台北時區）。toISOString().slice() 是 UTC，UTC+8 清晨或月初/月底會退回前一天。datetime-local 或純 UTC 用途請加 eslint-disable-next-line 並註明原因。",
        },
      ],
    },
  },
  eslintPluginPrettier,
);
