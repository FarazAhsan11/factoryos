"use client";

import { useCallback, useMemo, useState } from "react";
import {
  useForm as useHookForm,
  type FieldValues,
  type UseFormProps,
  type UseFormRegister,
  type UseFormReset,
  type UseFormReturn,
} from "react-hook-form";

/**
 * react-hook-form's `useForm`, safe under the React Compiler. **Every form uses
 * this one**; ESLint refuses the library's own.
 *
 * `reset()` empties RHF's field map and relies on each input calling
 * `register()` again on the next render. The compiler caches
 * `register("batchNo")` for as long as `register` is the same function, which is
 * forever, so the input never does. It is left disconnected: it shows whatever
 * is typed into it while the form goes on holding, and filing, the old value.
 * That filed an entry under the wrong batch with the right one on screen.
 * StrictMode hides the case at mount, so judge this on a production build.
 *
 * So `register` here is a new function after each `reset`, which is exactly
 * what the compiler's cache is keyed on: every input registers again, and RHF
 * behaves as it was written to. `reset` itself stays stable, for effect deps.
 */
export function useForm<
  TFieldValues extends FieldValues = FieldValues,
  // `any` is the library's own default, and callers name it `unknown`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TContext = any,
  TTransformedValues = TFieldValues,
>(
  props?: UseFormProps<TFieldValues, TContext, TTransformedValues>,
): UseFormReturn<TFieldValues, TContext, TTransformedValues> {
  // Not compiled: RHF keeps one object for the form's life and replaces its
  // `formState` in place, so a memoised spread of it would go stale.
  "use no memo";

  const form = useHookForm<TFieldValues, TContext, TTransformedValues>(props);
  const { register: baseRegister, reset: baseReset } = form;
  const [generation, setGeneration] = useState(0);

  const register = useMemo<UseFormRegister<TFieldValues>>(() => {
    void generation; // A new function per reset is the whole point.
    return (name, options) => baseRegister(name, options);
  }, [baseRegister, generation]);

  const reset = useCallback<UseFormReset<TFieldValues>>(
    (values, options) => {
      baseReset(values, options);
      setGeneration((n) => n + 1);
    },
    [baseReset],
  );

  return { ...form, register, reset };
}
