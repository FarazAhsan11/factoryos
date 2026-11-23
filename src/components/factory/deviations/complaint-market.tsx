"use client";

import { useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useWatch } from "react-hook-form";

import { useForm } from "@/lib/use-form";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  marketActionSchema,
  type MarketActionValues,
} from "@/app/factory/[slug]/deviations/schemas";
import {
  AREA,
  CONTROL,
  Field,
  SECONDARY_BUTTON,
  SelectControl,
} from "@/components/factory/deviations/deviation-fields";
import { Segmented } from "@/components/factory/deviations/deviation-initiation-fields";
import {
  MARKET_ACTIONS,
  RECALL_CLASSES,
  RECALL_LEVELS,
} from "@/lib/factory/complaint";
import {
  deviationKeys,
  marketActionValues,
  saveMarketAction,
  type Deviation,
} from "@/lib/factory/deviation-queries";

/**
 * A complaint's market action (qms-v12) — first on its Actions tab, in the
 * TGA Uniform Recall Procedure's terms: no market action, quarantine stock,
 * recall (class and level), product defect correction, other action; with
 * the decision and its rationale. The sponsor runs any recall with the TGA.
 * A recall or a defect correction puts a regulator report in question on the
 * assessment.
 */
export function ComplaintMarketAction({
  deviation: d,
  factoryId,
  canEdit,
}: {
  deviation: Deviation;
  factoryId: string;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const form = useForm<MarketActionValues>({
    resolver: zodResolver(marketActionSchema),
    defaultValues: marketActionValues(d),
  });
  const { control, register, formState } = form;
  const errors = formState.errors;
  const market = useWatch({ control, name: "market" });

  async function save(v: MarketActionValues) {
    try {
      await saveMarketAction(d.id, v);
      await queryClient.invalidateQueries({ queryKey: deviationKeys.all(factoryId) });
      toast.success(
        v.market === "Recall" || v.market === "Product defect correction"
          ? "Market action saved — a regulator report is now in question on the Assessment tab."
          : "Market action saved.",
      );
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <section className="space-y-3">
      <h3 className="flex flex-wrap items-baseline gap-x-2 text-base font-semibold text-ink">
        Market action
        {d.stock_affected && (
          <span className="text-sm font-normal text-ink-4">
            Released stock affected: {d.stock_affected.toLowerCase()}
          </span>
        )}
      </h3>
      <form noValidate onSubmit={form.handleSubmit(save)} className="space-y-5">
        <fieldset disabled={!canEdit} className="grid min-w-0 gap-x-6 gap-y-5 md:grid-cols-2">
          <Field
            label="Market action"
            htmlFor="mk-action"
            required
            error={errors.market?.message}
            hint="Terms from the TGA Uniform Recall Procedure (URPTG). The sponsor runs any recall with the TGA."
          >
            <SelectControl
              control={control}
              name="market"
              id="mk-action"
              placeholder="Select…"
              invalid={Boolean(errors.market)}
              options={MARKET_ACTIONS.map((m) => ({ value: m, label: m }))}
            />
          </Field>
          <div className="hidden md:block" />
          {market === "Recall" && (
            <>
              <Field
                label="Recall class"
                required
                error={errors.recallClass?.message}
                hint="I: serious harm or death likely · II: temporary or reversible harm · III: unlikely to harm"
              >
                <Segmented
                  control={control}
                  name="recallClass"
                  label="Recall class"
                  options={RECALL_CLASSES.map((c) => ({ value: c, label: c }))}
                />
              </Field>
              <Field label="Recall level" required error={errors.recallLevel?.message}>
                <Segmented
                  control={control}
                  name="recallLevel"
                  label="Recall level"
                  className="flex-wrap"
                  options={RECALL_LEVELS.map((c) => ({ value: c, label: c }))}
                />
              </Field>
              <Field label="TGA recall reference" htmlFor="mk-ref" note="(optional)">
                <input id="mk-ref" className={CONTROL} {...register("recallRef")} />
              </Field>
              <div className="hidden md:block" />
            </>
          )}
          <Field
            label="Decision and rationale"
            htmlFor="mk-why"
            required
            error={errors.why?.message}
            className="md:col-span-2"
          >
            <textarea
              id="mk-why"
              rows={2}
              placeholder="e.g. Isolated transit damage; retained samples pass; no other complaints for the batch"
              className={AREA}
              {...register("why")}
            />
          </Field>
        </fieldset>
        {canEdit && (
          <button type="submit" disabled={formState.isSubmitting} className={SECONDARY_BUTTON}>
            {formState.isSubmitting && <Loader2 className="size-4 animate-spin" />}
            Save market action
          </button>
        )}
      </form>
    </section>
  );
}
