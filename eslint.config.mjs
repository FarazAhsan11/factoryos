import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // RHF's own `useForm` leaves inputs disconnected after `reset()` under the
  // React Compiler, and an entry was filed under the wrong batch because of it.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/use-form.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "react-hook-form",
              importNames: ["useForm"],
              message:
                'Import useForm from "@/lib/use-form": the library\'s own breaks inputs after reset() under the React Compiler.',
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
