"use client";

import { useCallback, useDeferredValue, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { CapaRegister } from "@/components/factory/capa/capa-register";
import { DeviationDetailDialog } from "@/components/factory/deviations/deviation-detail-dialog";
import {
  DeviationsTable,
  OPTIONAL_COLUMNS,
  defaultColumns,
  type CaseColumn,
} from "@/components/factory/deviations/deviations-table";
import { NewDeviationDialog } from "@/components/factory/deviations/new-deviation-dialog";
import {
  ColumnsMenu,
  RegisterFoot,
  RegisterSearch,
  RegisterSkeleton,
  RegisterViews,
} from "@/components/factory/register-table";
import { canReview } from "@/lib/factory/action-queries";
import { capaKeys, fetchCapas } from "@/lib/factory/capa-queries";
import type { FactoryRole } from "@/lib/factory/context";
import {
  DEVIATION_TYPES,
  caseStage,
  deviationKeys,
  fetchDeviations,
  type Deviation,
  type DeviationType,
} from "@/lib/factory/deviation-queries";

import { CASE_SCREENS, resolveQualityTab } from "@/lib/factory/quality-tabs";
import { cn } from "@/lib/utils";

type View = "open" | "mine" | "awaiting" | "overdue" | "closed" | "all";
type TypeFilter = DeviationType | "all";

/** What the keyword box searches — the columns somebody actually types into. */
function haystack(d: Deviation): string {
  return [
    d.deviation_no,
    d.title,
    d.batch_nos.join(" "),
    d.batch_no,
    d.product_names.join(" "),
    d.product_name,
    d.product_code,
    d.customer_name,
    d.supplier_name,
    d.raw_material_code,
    d.raw_material_name,
    d.nc_category,
    d.owner_name,
    d.raised_by,
    d.capa_no,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

const same = (a: string | null, b: string) =>
  (a ?? "").trim().toLowerCase() === b;

/**
 * Quality — the case registers and the CAPA register, one page.
 *
 * Which screen is open comes from the rail, through `?tab=`
 * (`resolveQualityTab`): Deviations, Non-conformances and Customer complaints
 * are the one cached case list cut by type, and the CAPA register is its own
 * list. Switching between them only rewrites the URL, so nothing is fetched
 * twice and the case dialog — opened from a case row or from a CAPA's cases —
 * is one dialog for all four.
 *
 * Laid out the way the client's reference QMS is: heading, a row of views
 * with their counts (Open, My cases, Awaiting CAPA, Overdue, Closed, All),
 * the search and a Columns menu, a short table, and a row count. "My cases"
 * are the ones whose owner or raiser is the signed-in person's name.
 */
export function DeviationsWorkspace({
  factoryId,
  slug,
  userId,
  viewerName,
  role,
}: {
  factoryId: string;
  slug: string;
  userId: string;
  /** The signed-in person's full name, for "My cases". */
  viewerName: string | null;
  role: FactoryRole;
}) {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const tab = resolveQualityTab(searchParams.get("tab"));
  // `?case=<id>` opens a case — where the raise page lands after raising.
  const caseParam = searchParams.get("case");
  const screen = tab === "capa" ? null : CASE_SCREENS[tab];
  // Each screen keeps its own view: "Awaiting CAPA" picked on Deviations
  // must not open Customer complaints on an empty list.
  const [viewByTab, setViewByTab] = useState<Partial<Record<string, View>>>(
    {},
  );
  const view = viewByTab[tab] ?? "open";
  const setView = (next: View) =>
    setViewByTab((prev) => ({ ...prev, [tab]: next }));
  const [type, setType] = useState<TypeFilter>("all");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const router = useRouter();
  // The optional columns each screen shows. Kept per screen, and only for as
  // long as the page is open.
  const [chosen, setChosen] = useState<Partial<Record<string, CaseColumn[]>>>(
    {},
  );

  // The table re-filters on a background render, so typing stays responsive
  // with six hundred cases in the cache.
  const term = useDeferredValue(search).trim().toLowerCase();
  const me = (viewerName ?? "").trim().toLowerCase();

  const {
    data: deviations = [],
    isPending,
    isError,
    error,
  } = useQuery({
    queryKey: deviationKeys.all(factoryId),
    queryFn: () => fetchDeviations(factoryId),
  });
  // Each case's CAPA step, for the CAPA column (P3).
  const { data: capas = [] } = useQuery({
    queryKey: capaKeys.all(factoryId),
    queryFn: () => fetchCapas(factoryId),
  });

  const refresh = useCallback(
    () =>
      queryClient.invalidateQueries({ queryKey: deviationKeys.all(factoryId) }),
    [queryClient, factoryId],
  );

  // The screen's own cases first; the view counts then follow the type and
  // keyword filters, so "Open 3" always describes the list its tab shows.
  const onScreen = useMemo(
    () => deviations.filter((d) => screen?.types.includes(d.type)),
    [deviations, screen],
  );
  const narrowed = useMemo(
    () =>
      onScreen.filter(
        (d) =>
          (tab !== "deviations" || type === "all" || d.type === type) &&
          (!term || haystack(d).includes(term)),
      ),
    [onScreen, tab, type, term],
  );

  const views = useMemo(() => {
    const test: Record<View, (d: Deviation) => boolean> = {
      open: (d) => d.status === "open",
      mine: (d) =>
        d.status === "open" &&
        me !== "" &&
        (same(d.owner_name, me) || same(d.raised_by, me)),
      awaiting: (d) => caseStage(d) === "awaiting_capa",
      overdue: (d) => d.is_overdue,
      closed: (d) => d.status === "closed",
      all: () => true,
    };
    const list: { key: View; label: string; hint: string }[] = [
      { key: "open", label: "Open", hint: "Raised, not yet closed out" },
      { key: "mine", label: "My cases", hint: "Open, and you own or raised it" },
      {
        key: "awaiting",
        label: "Awaiting CAPA",
        hint: "Its CAPA is still being worked",
      },
      { key: "overdue", label: "Overdue", hint: "Open past its due date" },
      { key: "closed", label: "Closed", hint: "Signed off" },
      { key: "all", label: "All", hint: "Every case ever raised" },
    ];
    return {
      test,
      tabs: list.map((v) => ({ ...v, count: narrowed.filter(test[v.key]).length })),
    };
  }, [narrowed, me]);

  const visible = useMemo(
    () => narrowed.filter(views.test[view]),
    [narrowed, views, view],
  );

  // Read out of the fetched list rather than held in state, so an open case
  // re-renders the moment one of its tabs is saved.
  const open = deviations.find((d) => d.id === (openId ?? caseParam)) ?? null;

  // A deviation and a non-conformance open as their own page; a complaint
  // still in the case dialog.
  const openCase = (id: string) => {
    const d = deviations.find((x) => x.id === id);
    if (d && (d.type === "planned" || d.type === "unplanned")) {
      router.push(`/factory/${slug}/deviations/${id}`);
    } else if (d && d.type === "ncr") {
      router.push(`/factory/${slug}/deviations/${id}?tab=ncr`);
    } else {
      setOpenId(id);
    }
  };

  const dialog = (
    <DeviationDetailDialog
      deviation={open}
      factoryId={factoryId}
      role={role}
      onClose={() => {
        setOpenId(null);
        // Drop `?case=` so closing it stays closed (and Back doesn't reopen).
        if (caseParam) {
          const next = new URLSearchParams(searchParams.toString());
          next.delete("case");
          const query = next.toString();
          window.history.replaceState(
            null,
            "",
            `${window.location.pathname}${query ? `?${query}` : ""}`,
          );
        }
      }}
    />
  );

  if (!screen) {
    return (
      <div className="flex flex-col lg:min-h-0 lg:flex-1">
        <CapaRegister
          factoryId={factoryId}
          slug={slug}
          onOpenCase={openCase}
        />
        {dialog}
      </div>
    );
  }

  const caseTypes = DEVIATION_TYPES.filter((t) =>
    screen.types.includes(t.value),
  );
  const columns = chosen[tab] ?? defaultColumns(screen.types);
  // Received via and adverse reaction mean nothing off the complaints screen.
  const offeredColumns = OPTIONAL_COLUMNS.filter(
    (c) =>
      tab === "complaints" ||
      (c.key !== "received_via" && c.key !== "adverse_reaction"),
  );

  return (
    <div className="flex flex-col lg:min-h-0 lg:flex-1">
      <div className="mb-4 flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            {screen.heading}
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-ink-4">{screen.sub}</p>
        </div>

        {/* A deviation and a non-conformance are raised on their own page; a
            complaint still in the dialog. */}
        {canReview(role) && (tab === "deviations" || tab === "ncr") && (
          <Link
            href={`/factory/${slug}/deviations/new${tab === "ncr" ? "?type=ncr" : ""}`}
            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl bg-[linear-gradient(180deg,var(--color-brand-bright)_0%,var(--color-brand)_100%)] px-3.5 text-sm font-semibold text-white shadow-brand transition hover:brightness-[1.06]"
          >
            <Plus className="size-4" />
            {screen.newLabel}
          </Link>
        )}
        {canReview(role) && tab !== "deviations" && tab !== "ncr" && (
          <NewDeviationDialog
            // Keyed by screen, so a half-typed NCR never opens as a complaint.
            key={tab}
            factoryId={factoryId}
            userId={userId}
            viewerName={viewerName ?? ""}
            types={screen.types}
            buttonLabel={screen.newLabel}
            title={screen.newTitle}
            onCreated={refresh}
          />
        )}
      </div>

      <div className="mb-4 shrink-0">
        <RegisterViews
          views={views.tabs}
          value={view}
          onChange={setView}
          label="Case views"
        />
      </div>

      <div className="mb-3 flex shrink-0 flex-wrap items-center justify-end gap-2">
        {/* Planned or unplanned — only Deviations has more than one kind. */}
        {caseTypes.length > 1 && (
          <div
            aria-label="Case type"
            className="mr-auto flex gap-1 rounded-xl border border-line bg-surface p-1 shadow-soft"
          >
            {[{ value: "all" as const, short: "All" }, ...caseTypes].map(
              (t) => {
                const active = type === t.value;
                return (
                  <button
                    key={t.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setType(t.value)}
                    className={cn(
                      "shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition",
                      active
                        ? "bg-sunken-2 text-ink ring-1 ring-line"
                        : "text-ink-4 hover:text-ink",
                    )}
                  >
                    {t.short}
                  </button>
                );
              },
            )}
          </div>
        )}

        <div className="w-full sm:w-80 sm:flex-none">
          <RegisterSearch
            value={search}
            onChange={setSearch}
            placeholder="Search case no., title, batch, product…"
            label="Search cases"
          />
        </div>
        <ColumnsMenu
          columns={offeredColumns}
          shown={columns}
          onToggle={(key) =>
            setChosen((prev) => ({
              ...prev,
              [tab]: columns.includes(key)
                ? columns.filter((c) => c !== key)
                : [...columns, key],
            }))
          }
        />
      </div>

      <div className="min-h-0 flex-1 lg:overflow-hidden">
        {isPending ? (
          <RegisterSkeleton />
        ) : isError ? (
          <p className="rounded-2xl border border-danger-line bg-danger-soft px-4 py-6 text-center text-sm font-medium text-danger-deep">
            Could not load the register: {(error as Error).message}
          </p>
        ) : (
          <DeviationsTable
            deviations={visible}
            onOpen={openCase}
            columns={columns}
            capas={capas}
            emptyTitle={
              onScreen.length === 0
                ? `No ${screen.heading.toLowerCase()} yet.`
                : "Nothing here."
            }
            emptyBody={
              onScreen.length === 0
                ? `Raise a ${screen.noun} when one comes up.`
                : term
                  ? "Try a different keyword, or clear the search."
                  : view === "mine" && !me
                    ? "Your profile has no name, so no case can be matched to you."
                    : "Try another view."
            }
          />
        )}
      </div>
      {!isPending && !isError && <RegisterFoot count={visible.length} />}

      {dialog}
    </div>
  );
}
