"use client";

import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Controller, useWatch, type UseFormReturn } from "react-hook-form";

import {
  parseBatches,
  type ComplaintInitiationValues,
} from "@/app/factory/[slug]/deviations/schemas";
import {
  AREA,
  CONTROL,
  Field,
  SelectControl,
} from "@/components/factory/deviations/deviation-fields";
import {
  BatchesResolved,
  Segmented,
} from "@/components/factory/deviations/deviation-initiation-fields";
import { DateField } from "@/components/ui/date-picker";
import {
  COMPLAINANTS,
  COMPLAINT_CHANNELS,
  COUNTRIES,
  SAMPLE_STATES,
  SERIOUS_HELP,
  SPONSORS,
  regulatorOf,
} from "@/lib/factory/complaint";
import { deviationKeys, fetchDeviations } from "@/lib/factory/deviation-queries";
import { fetchProducts, productKeys } from "@/lib/factory/product-queries";
import { useRenderClock } from "@/lib/use-render-clock";
import { cn } from "@/lib/utils";

const DAY_MS = 86_400_000;

/** Midnight today, in epoch ms — steady all day, so the render clock settles. */
const dayStart = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/**
 * A customer complaint's raise form — the reference QMS's (qms-v12, "v11"),
 * in its order, two columns wide:
 *
 *   Title
 *   Date received                     Received via
 *   Complainant                       Complainant contact
 *   Batch number(s)                   Market (country) — or Product, no batch
 *   brand owner, from the batch       Who is the sponsor?  ARTG number
 *   Expiry date                       Number of units affected
 *   Complaint description
 *   Complaint sample                  (Received → sample received on)
 *   Injury or adverse reaction        (Yes → is it serious? what, and when)
 *   Immediate action (optional)
 *
 * The brand owner is the batch's (or the picked product's) customer — not
 * typed. Who the sponsor is and the ARTG are asked here for now; the
 * reference reads them from the product.
 */
export function ComplaintInitiationFields({
  form,
  factoryId,
}: {
  form: UseFormReturn<ComplaintInitiationValues>;
  factoryId: string;
}) {
  const {
    register,
    control,
    setValue,
    formState: { errors },
  } = form;

  const { data: products = [] } = useQuery({
    queryKey: productKeys.all(factoryId),
    queryFn: () => fetchProducts(factoryId),
  });

  const batchesText = useWatch({ control, name: "batches" });
  const productLabel = useWatch({ control, name: "productLabel" });
  const country = useWatch({ control, name: "country" });
  const customerName = useWatch({ control, name: "customerName" });
  const sample = useWatch({ control, name: "sample" });
  const adverse = useWatch({ control, name: "adverse" });
  const serious = useWatch({ control, name: "serious" });

  const batches = useMemo(() => parseBatches(batchesText ?? ""), [batchesText]);
  const byBatch = useMemo(
    () => new Map(products.map((p) => [p.batch_no.toLowerCase(), p])),
    [products],
  );
  const fromBatch = batches.map((b) => byBatch.get(b.toLowerCase())).find(Boolean) ?? null;

  // Distinct product names, for the picker when the batch is unknown.
  const productOptions = useMemo(() => {
    const seen = new Map<string, string | null>();
    for (const p of products) if (!seen.has(p.name)) seen.set(p.name, p.customer_name);
    return [...seen.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, customer]) => ({ value: name, label: name, meta: customer ?? undefined }));
  }, [products]);

  // The brand owner follows the product — from the batch, or the picked one.
  const owner = fromBatch
    ? fromBatch.customer_name
    : (products.find((p) => p.name === productLabel)?.customer_name ?? null);
  useEffect(() => {
    if ((owner ?? "") !== (form.getValues("customerName") ?? "")) {
      setValue("customerName", owner ?? "");
    }
  }, [owner, form, setValue]);

  return (
    <div className="grid gap-x-6 gap-y-5 md:grid-cols-2">
      <Field
        label="Title"
        htmlFor="cmp-title"
        required
        error={errors.title?.message}
        className="md:col-span-2"
      >
        <input
          id="cmp-title"
          placeholder="e.g. Tablets crumbling in the bottle"
          aria-invalid={Boolean(errors.title)}
          className={CONTROL}
          {...register("title")}
        />
      </Field>

      <Field
        label="Date received"
        htmlFor="cmp-received"
        required
        error={errors.receivedOn?.message}
        hint="Due dates and notifications count from this date."
      >
        <Controller
          name="receivedOn"
          control={control}
          render={({ field }) => (
            <DateField id="cmp-received" value={field.value} onChange={field.onChange} />
          )}
        />
      </Field>
      <Field label="Received via" htmlFor="cmp-via" required error={errors.receivedVia?.message}>
        <SelectControl
          control={control}
          name="receivedVia"
          id="cmp-via"
          placeholder="Select…"
          invalid={Boolean(errors.receivedVia)}
          options={COMPLAINT_CHANNELS.map((c) => ({ value: c, label: c }))}
        />
      </Field>

      <Field label="Complainant" htmlFor="cmp-who" required error={errors.complainant?.message}>
        <SelectControl
          control={control}
          name="complainant"
          id="cmp-who"
          placeholder="Select…"
          invalid={Boolean(errors.complainant)}
          options={COMPLAINANTS.map((c) => ({ value: c, label: c }))}
        />
      </Field>
      <Field
        label="Complainant contact"
        htmlFor="cmp-contact"
        note="(optional)"
        hint="Personal information: record only what is needed to reply."
      >
        <input
          id="cmp-contact"
          placeholder="Email or phone"
          className={CONTROL}
          {...register("contact")}
        />
      </Field>

      <Field
        label="Batch number(s)"
        htmlFor="cmp-batches"
        note="(optional)"
        error={errors.batches?.message}
      >
        <input
          id="cmp-batches"
          placeholder="e.g. 46650"
          className={cn(CONTROL, "font-mono")}
          {...register("batches")}
        />
        <SameBatchHint factoryId={factoryId} batches={batches} />
        <BatchesResolved
          factoryId={factoryId}
          control={control}
          name="batches"
          holding={false}
          emptyHint="From the label, if the complainant has it."
        />
      </Field>

      {fromBatch ? (
        <CountryField form={form} country={country} />
      ) : (
        <Field
          label="Product"
          htmlFor="cmp-product"
          required
          error={errors.productLabel?.message}
          hint="Needed when the batch is unknown."
        >
          <SelectControl
            control={control}
            name="productLabel"
            id="cmp-product"
            placeholder="Select…"
            searchPlaceholder="Product…"
            emptyMessage="No products."
            invalid={Boolean(errors.productLabel)}
            options={productOptions}
          />
        </Field>
      )}
      {!fromBatch && (
        <>
          <CountryField form={form} country={country} />
          <div className="hidden md:block" />
        </>
      )}

      <div className="md:col-span-2">
        <p className="rounded-xl border border-line-soft bg-sunken px-3.5 py-2.5 text-[0.8125rem] text-ink-3">
          Brand owner:{" "}
          <span className="font-semibold text-ink">
            {customerName || "— (from the product, once the batch or product is known)"}
          </span>
        </p>
      </div>

      <Field
        label="Who is the sponsor?"
        required
        error={errors.sponsor?.message}
        hint="The company on the ARTG — it reports to the regulator and runs any recall. Usually the customer; us for our own brand."
      >
        <Segmented
          control={control}
          name="sponsor"
          label="Who is the sponsor?"
          className="flex-wrap"
          options={SPONSORS.map((s) => ({ value: s.value, label: s.label }))}
        />
      </Field>
      <Field label="ARTG number" htmlFor="cmp-artg" note="(optional)">
        <input
          id="cmp-artg"
          placeholder="e.g. AUST L 384211"
          className={cn(CONTROL, "font-mono")}
          {...register("artg")}
        />
      </Field>

      <Field label="Expiry date" htmlFor="cmp-expiry" note="(optional)">
        <input id="cmp-expiry" placeholder="MM/YYYY" className={CONTROL} {...register("expiry")} />
      </Field>
      <Field label="Number of units affected" htmlFor="cmp-units" note="(optional)">
        <input
          id="cmp-units"
          placeholder="e.g. 2 bottles"
          className={CONTROL}
          {...register("unitsAffected")}
        />
      </Field>

      <Field
        label="Complaint description"
        htmlFor="cmp-desc"
        required
        error={errors.actual?.message}
        className="md:col-span-2"
      >
        <textarea
          id="cmp-desc"
          rows={3}
          placeholder="In the complainant’s words: what they found, how many, when they noticed"
          aria-invalid={Boolean(errors.actual)}
          className={AREA}
          {...register("actual")}
        />
      </Field>

      <Field
        label="Complaint sample"
        required
        error={errors.sample?.message}
        hint={sample === "Requested" ? "Mark it received on the case when it arrives." : undefined}
      >
        <Segmented
          control={control}
          name="sample"
          label="Complaint sample"
          className="flex-wrap"
          options={SAMPLE_STATES.map((s) => ({ value: s, label: s }))}
        />
      </Field>
      {sample === "Received" ? (
        <Field
          label="Sample received on"
          htmlFor="cmp-sample-on"
          required
          error={errors.sampleReceivedOn?.message}
        >
          <Controller
            name="sampleReceivedOn"
            control={control}
            render={({ field }) => (
              <DateField id="cmp-sample-on" value={field.value} onChange={field.onChange} />
            )}
          />
        </Field>
      ) : (
        <div className="hidden md:block" />
      )}

      <Field
        label="Injury or adverse reaction reported"
        required
        error={errors.adverse?.message}
      >
        <Segmented
          control={control}
          name="adverse"
          label="Injury or adverse reaction reported"
          options={[
            { value: "no", label: "No" },
            { value: "yes", label: "Yes" },
          ]}
        />
      </Field>
      {adverse === "yes" ? (
        <Field
          label="Is it serious?"
          required
          error={errors.serious?.message}
          hint={SERIOUS_HELP}
        >
          <Segmented
            control={control}
            name="serious"
            label="Is it serious?"
            options={[
              { value: "no", label: "No" },
              { value: "yes", label: "Yes" },
            ]}
          />
          {serious === "yes" && (
            <p className="text-[0.6875rem] font-medium text-danger-deep">
              Red flag: the case starts as Critical.
            </p>
          )}
        </Field>
      ) : (
        <div className="hidden md:block" />
      )}
      {adverse === "yes" && (
        <Field
          label="What reaction, and when"
          htmlFor="cmp-adverse-what"
          required
          error={errors.adverseWhat?.message}
          className="md:col-span-2"
        >
          <textarea
            id="cmp-adverse-what"
            rows={2}
            placeholder="e.g. Nausea within an hour of taking 2 tablets on an empty stomach"
            className={AREA}
            {...register("adverseWhat")}
          />
        </Field>
      )}

      <Field
        label="Immediate action"
        htmlFor="cmp-immediate"
        note="(optional)"
        className="md:col-span-2"
      >
        <textarea
          id="cmp-immediate"
          rows={2}
          placeholder="e.g. Retained samples pulled; stock of the batch checked"
          className={AREA}
          {...register("immediateAction")}
        />
      </Field>
    </div>
  );
}

function CountryField({
  form,
  country,
}: {
  form: UseFormReturn<ComplaintInitiationValues>;
  country: string;
}) {
  const reg = regulatorOf(country);
  return (
    <Field
      label="Market (country)"
      htmlFor="cmp-country"
      required
      hint={
        country && country !== "Australia"
          ? `Reports go to ${reg === "regulator" ? "that country’s regulator" : `the ${reg}`}, not the TGA.`
          : "Where the product was sold."
      }
    >
      <SelectControl
        control={form.control}
        name="country"
        id="cmp-country"
        placeholder="Select…"
        options={COUNTRIES.map((c) => ({ value: c, label: c }))}
      />
    </Field>
  );
}

/** Other complaints for the same batch in the last 90 days. */
function SameBatchHint({ factoryId, batches }: { factoryId: string; batches: string[] }) {
  const { data: cases = [] } = useQuery({
    queryKey: deviationKeys.all(factoryId),
    queryFn: () => fetchDeviations(factoryId),
  });
  // Today, to the day, through the render clock — never read in render.
  const today = useRenderClock(dayStart);
  const same = useMemo(() => {
    if (batches.length === 0) return [];
    const wanted = new Set(batches.map((b) => b.toLowerCase()));
    const since = today - 90 * DAY_MS;
    return cases.filter(
      (c) =>
        c.type === "complaint" &&
        c.status_reason !== "Not a quality complaint" &&
        new Date(c.received_on ?? c.created_at).getTime() >= since &&
        c.batch_nos.some((b) => wanted.has(b.toLowerCase())),
    );
  }, [cases, batches, today]);
  if (same.length === 0) return null;
  return (
    <p className="text-[0.6875rem] leading-snug text-warn-ink">
      {same.length} other complaint{same.length > 1 ? "s" : ""} for this batch in the
      last 90 days: {same.map((c) => c.deviation_no).join(", ")}
    </p>
  );
}
