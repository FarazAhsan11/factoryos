"use client";

import { useState } from "react";
import { Building2, CalendarDays, Hash, Plus, UserPlus } from "lucide-react";

import { cn } from "@/lib/utils";

export interface Factory {
  id: string;
  name: string;
  slug: string | null;
  created_at: string;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Locale-independent so server and client render identically (no hydration
// mismatch). Uses UTC to avoid timezone-driven day shifts.
function formatDate(iso: string) {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function FactoriesConsole({ factories }: { factories: Factory[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(
    factories[0]?.id ?? null
  );
  const selected = factories.find((f) => f.id === selectedId) ?? null;

  return (
    <div>
      {/* header */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[#0F1B34]">
            Factories
          </h1>
          <p className="mt-1 text-sm text-[#64748B]">
            Every tenant on the platform. Select one to see its details.
          </p>
        </div>
        <button
          type="button"
          className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl bg-[linear-gradient(180deg,#3B82F6_0%,#2563EB_100%)] px-4 text-sm font-semibold text-white shadow-[0_8px_20px_-6px_rgba(37,99,235,0.55)] transition hover:brightness-[1.06]"
        >
          <Plus className="size-4" />
          Create factory
        </button>
      </div>

      {/* master–detail */}
      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-[300px_1fr]">
        {/* left: factory list */}
        <aside className="overflow-hidden rounded-2xl border border-[#E6EAF1] bg-white">
          <div className="border-b border-[#EEF1F6] px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[#94A3B8]">
            {factories.length} {factories.length === 1 ? "factory" : "factories"}
          </div>

          {factories.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-[#94A3B8]">
              No factories yet
            </p>
          ) : (
            <ul className="max-h-[60vh] overflow-y-auto py-1">
              {factories.map((factory) => {
                const active = factory.id === selectedId;
                return (
                  <li key={factory.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(factory.id)}
                      className={cn(
                        "flex w-full items-center gap-3 border-l-2 border-transparent px-4 py-3 text-left transition",
                        active
                          ? "border-[#2563EB] bg-[#F5F8FF]"
                          : "hover:bg-[#F8FAFC]"
                      )}
                    >
                      <div
                        className={cn(
                          "flex size-9 shrink-0 items-center justify-center rounded-lg",
                          active
                            ? "bg-[#2563EB] text-white"
                            : "bg-[#EFF4FF] text-[#2563EB]"
                        )}
                      >
                        <Building2 className="size-4.5" />
                      </div>
                      <div className="min-w-0">
                        <p
                          className={cn(
                            "truncate text-sm font-medium",
                            active ? "text-[#1D4ED8]" : "text-[#0F1B34]"
                          )}
                        >
                          {factory.name}
                        </p>
                        <p className="truncate text-xs text-[#94A3B8]">
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
        <section className="min-h-[420px] rounded-2xl border border-[#E6EAF1] bg-white">
          {selected ? (
            <FactoryDetail factory={selected} />
          ) : (
            <EmptyDetail />
          )}
        </section>
      </div>
    </div>
  );
}

function FactoryDetail({ factory }: { factory: Factory }) {
  return (
    <div className="p-6">
      {/* detail header */}
      <div className="flex items-start gap-4">
        <div className="flex size-12 items-center justify-center rounded-xl bg-[#EFF4FF] text-[#2563EB]">
          <Building2 className="size-6" />
        </div>
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-tight text-[#0F1B34]">
            {factory.name}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[#94A3B8]">
            {factory.slug && (
              <span className="rounded-full bg-[#F1F5F9] px-2 py-0.5 font-medium text-[#475569]">
                {factory.slug}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="size-3.5" />
              Created {formatDate(factory.created_at)}
            </span>
          </div>
        </div>
      </div>

      {/* info tiles */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <InfoTile icon={Hash} label="Factory ID">
          <span className="font-mono text-xs break-all text-[#334155]">
            {factory.id}
          </span>
        </InfoTile>

        <InfoTile icon={CalendarDays} label="Created">
          <span className="text-sm text-[#334155]">
            {formatDate(factory.created_at)}
          </span>
        </InfoTile>

        <InfoTile icon={UserPlus} label="First admin">
          <div className="flex items-center gap-2">
            <StatusPill tone="amber">Not provisioned</StatusPill>
            <button
              type="button"
              className="text-xs font-medium text-[#2563EB] hover:underline"
            >
              Invite admin
            </button>
          </div>
        </InfoTile>

        <InfoTile icon={Building2} label="Onboarding">
          <StatusPill tone="gray">Not started</StatusPill>
        </InfoTile>
      </div>

      <p className="mt-6 text-xs text-[#94A3B8]">
        Provisioning a first admin, onboarding status, and per-factory users
        arrive in the next build steps.
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
    <div className="rounded-xl border border-[#EEF1F6] bg-[#FBFCFE] p-4">
      <div className="flex items-center gap-1.5 text-xs font-medium text-[#94A3B8]">
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
    amber: "bg-[#FEF3C7] text-[#92400E]",
    gray: "bg-[#F1F5F9] text-[#475569]",
    green: "bg-[#DCFCE7] text-[#166534]",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        tones[tone]
      )}
    >
      {children}
    </span>
  );
}

function EmptyDetail() {
  return (
    <div className="flex h-full min-h-[420px] flex-col items-center justify-center px-6 text-center">
      <div className="flex size-12 items-center justify-center rounded-xl bg-[#EFF4FF] text-[#2563EB]">
        <Building2 className="size-6" />
      </div>
      <h2 className="mt-4 text-base font-semibold text-[#0F1B34]">
        No factories yet
      </h2>
      <p className="mt-1 max-w-sm text-sm text-[#64748B]">
        When you create a factory, it appears in the list on the left with its
        admin and onboarding status.
      </p>
    </div>
  );
}
