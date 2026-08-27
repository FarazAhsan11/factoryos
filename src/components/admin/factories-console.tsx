"use client";

import { useState } from "react";
import { Building2, CalendarDays, Hash, UserPlus } from "lucide-react";

import { cn } from "@/lib/utils";
import { CreateFactoryDialog } from "@/components/admin/create-factory-dialog";
import { DeleteFactoryDialog } from "@/components/admin/delete-factory-dialog";

export interface FactoryAdmin {
  email: string;
  status: "active" | "invited";
}

export interface Factory {
  id: string;
  name: string;
  slug: string | null;
  created_at: string;
  unit_label_plural?: string | null;
  onboarded_at?: string | null;
  admin?: FactoryAdmin | null;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// Locale-independent so server and client render identically (no hydration
// mismatch). Uses UTC to avoid timezone-driven day shifts.
function formatDate(iso: string) {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function FactoriesConsole({ factories }: { factories: Factory[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(
    factories[0]?.id ?? null,
  );
  // Fall back to the first factory so a deleted selection resolves cleanly.
  const selected =
    factories.find((f) => f.id === selectedId) ?? factories[0] ?? null;

  return (
    <div>
      {/* header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            Factories
          </h1>
          <p className="mt-1 text-sm text-ink-4">
            Every tenant on the platform. Select one to see its details.
          </p>
        </div>
        <CreateFactoryDialog />
      </div>

      {/* master–detail */}
      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-[300px_1fr]">
        {/* left: factory list */}
        <aside className="overflow-hidden rounded-2xl border border-line bg-surface">
          <div className="border-b border-line-soft px-4 py-3 text-xs font-semibold uppercase tracking-wide text-ink-5">
            {factories.length}{" "}
            {factories.length === 1 ? "factory" : "factories"}
          </div>

          {factories.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-ink-5">
              No factories yet
            </p>
          ) : (
            <ul className="max-h-[60vh] overflow-y-auto py-1">
              {factories.map((factory) => {
                const active = factory.id === selected?.id;
                return (
                  <li key={factory.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(factory.id)}
                      className={cn(
                        "flex w-full items-center gap-3 border-l-2 border-transparent px-4 py-3 text-left transition",
                        active
                          ? "border-brand bg-brand-tint"
                          : "hover:bg-sunken",
                      )}
                    >
                      <div
                        className={cn(
                          "flex size-9 shrink-0 items-center justify-center rounded-lg",
                          active
                            ? "bg-brand text-white"
                            : "bg-brand-soft text-brand",
                        )}
                      >
                        <Building2 className="size-4.5" />
                      </div>
                      <div className="min-w-0">
                        <p
                          className={cn(
                            "truncate text-sm font-medium",
                            active ? "text-brand-deep" : "text-ink",
                          )}
                        >
                          {factory.name}
                        </p>
                        <p className="truncate text-xs text-ink-5">
                          {factory.slug ?? "no slug"}
                        </p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        {/* right: detail */}
        <section className="min-h-[420px] rounded-2xl border border-line bg-surface">
          {selected ? (
            <FactoryDetail
              factory={selected}
              onDeleted={() => setSelectedId(null)}
            />
          ) : (
            <EmptyDetail />
          )}
        </section>
      </div>
    </div>
  );
}

function FactoryDetail({
  factory,
  onDeleted,
}: {
  factory: Factory;
  onDeleted?: () => void;
}) {
  return (
    <div className="p-6">
      {/* detail header — stacks below sm so the title never runs under the
          delete button */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
            <Building2 className="size-6" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-semibold tracking-tight break-words text-ink">
              {factory.name}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-ink-5">
              {factory.slug && (
                <span className="max-w-full truncate rounded-full bg-sunken-2 px-2 py-0.5 font-medium text-ink-3">
                  {factory.slug}
                </span>
              )}
              <span className="inline-flex items-center gap-1 whitespace-nowrap">
                <CalendarDays className="size-3.5 shrink-0" />
                Created {formatDate(factory.created_at)}
              </span>
              {factory.slug && (
                <a
                  href={`/factory/${factory.slug}`}
                  className="font-medium whitespace-nowrap text-brand hover:underline"
                >
                  Open dashboard →
                </a>
              )}
            </div>
          </div>
        </div>

        <DeleteFactoryDialog
          factoryId={factory.id}
          factoryName={factory.name}
          onDeleted={onDeleted}
          className="w-full justify-center sm:w-auto"
        />
      </div>

      {/* info tiles */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <InfoTile icon={Hash} label="Factory ID">
          <span className="font-mono text-xs break-all text-ink-2">
            {factory.id}
          </span>
        </InfoTile>

        <InfoTile icon={CalendarDays} label="Created">
          <span className="text-sm text-ink-2">
            {formatDate(factory.created_at)}
          </span>
        </InfoTile>

        <InfoTile icon={UserPlus} label="First admin">
          {factory.admin ? (
            <div className="flex flex-col items-start gap-1.5">
              <span className="max-w-full truncate text-sm text-ink-2">
                {factory.admin.email}
              </span>
              {factory.admin.status === "active" ? (
                <StatusPill tone="green">Active</StatusPill>
              ) : (
                <StatusPill tone="amber">Invited · pending</StatusPill>
              )}
            </div>
          ) : (
            <StatusPill tone="amber">Not provisioned</StatusPill>
          )}
        </InfoTile>

        <InfoTile icon={Building2} label="Onboarding">
          {factory.onboarded_at ? (
            <div className="flex flex-col items-start gap-1.5">
              <StatusPill tone="green">
                Completed {formatDate(factory.onboarded_at)}
              </StatusPill>
              {factory.unit_label_plural && (
                <span className="text-xs text-ink-4">
                  Production units: {factory.unit_label_plural}
                </span>
              )}
            </div>
          ) : (
            <StatusPill tone="gray">Not started</StatusPill>
          )}
        </InfoTile>
      </div>

      <p className="mt-6 text-xs text-ink-5">
        Per-factory user management arrives in the next build steps.
      </p>
    </div>
  );
}

function InfoTile({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Building2;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-line-soft bg-sunken p-4">
      <div className="flex items-center gap-1.5 text-xs font-medium text-ink-5">
        <Icon className="size-3.5" />
        {label}
      </div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function StatusPill({
  tone,
  children,
}: {
  tone: "amber" | "gray" | "green";
  children: React.ReactNode;
}) {
  const tones = {
    amber: "bg-warn-soft text-warn-ink",
    gray: "bg-sunken-2 text-ink-3",
    green: "bg-teal-soft text-teal-deep",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

function EmptyDetail() {
  return (
    <div className="flex h-full min-h-[420px] flex-col items-center justify-center px-6 text-center">
      <div className="flex size-12 items-center justify-center rounded-xl bg-brand-soft text-brand">
        <Building2 className="size-6" />
      </div>
      <h2 className="mt-4 text-base font-semibold text-ink">
        No factories yet
      </h2>
      <p className="mt-1 max-w-sm text-sm text-ink-4">
        When you create a factory, it appears in the list on the left with its
        admin and onboarding status.
      </p>
    </div>
  );
}
