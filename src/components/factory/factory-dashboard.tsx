import { Activity, Boxes, CalendarDays, Gauge, Users } from "lucide-react";

export interface FactoryRecord {
  id: string;
  name: string;
  slug: string | null;
  description: string | null;
  logo_url: string | null;
  created_at: string;
  unit_label: string | null;
  unit_label_plural: string | null;
  onboarded_at: string | null;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function formatDate(iso: string) {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// Placeholder metrics until the operational modules land. The unit label comes
// from onboarding, so each tenant sees its own vocabulary.
function kpis(unitsPlural: string) {
  return [
    { icon: Gauge, label: "OEE (today)", value: "78.4%", tone: "text-[#2563EB]" },
    { icon: Boxes, label: "Units produced", value: "12,480", tone: "text-[#0F1B34]" },
    {
      icon: Activity,
      label: `Active ${unitsPlural.toLowerCase()}`,
      value: "6 / 8",
      tone: "text-[#0F1B34]",
    },
    { icon: Users, label: "On shift", value: "42", tone: "text-[#0F1B34]" },
  ];
}

const SHIFTS = [
  { name: "Shift A · Morning", window: "06:00 – 14:00", status: "Active", tone: "green" },
  { name: "Shift B · Evening", window: "14:00 – 22:00", status: "Upcoming", tone: "gray" },
  { name: "Shift C · Night", window: "22:00 – 06:00", status: "Upcoming", tone: "gray" },
] as const;

export function FactoryDashboard({ factory }: { factory: FactoryRecord }) {
  return (
    <div className="mx-auto max-w-5xl">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-[#0F1B34]">
              Welcome to {factory.name}
            </h1>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-[#64748B]">
              <CalendarDays className="size-3.5" />
              Onboarded {formatDate(factory.created_at)}
            </p>
          </div>
        </div>

        {factory.description && (
          <p className="mt-4 max-w-2xl rounded-xl border border-[#E6EAF1] bg-white p-4 text-sm text-[#475569]">
            {factory.description}
          </p>
        )}

        {/* KPI row */}
        <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {kpis(factory.unit_label_plural ?? "lines").map((k) => (
            <div
              key={k.label}
              className="rounded-2xl border border-[#E6EAF1] bg-white p-5"
            >
              <div className="flex items-center gap-1.5 text-xs font-medium text-[#94A3B8]">
                <k.icon className="size-3.5" />
                {k.label}
              </div>
              <p className={`mt-2 text-2xl font-semibold ${k.tone}`}>{k.value}</p>
            </div>
          ))}
        </div>

        {/* shifts */}
        <div className="mt-6 rounded-2xl border border-[#E6EAF1] bg-white">
          <div className="border-b border-[#EEF1F6] px-5 py-3 text-sm font-semibold text-[#0F1B34]">
            Today&apos;s shifts
          </div>
          <ul className="divide-y divide-[#EEF1F6]">
            {SHIFTS.map((s) => (
              <li
                key={s.name}
                className="flex items-center justify-between px-5 py-3.5"
              >
                <div>
                  <p className="text-sm font-medium text-[#0F1B34]">{s.name}</p>
                  <p className="text-xs text-[#94A3B8]">{s.window}</p>
                </div>
                <span
                  className={
                    s.tone === "green"
                      ? "inline-flex items-center rounded-full bg-[#DCFCE7] px-2.5 py-0.5 text-xs font-medium text-[#166534]"
                      : "inline-flex items-center rounded-full bg-[#F1F5F9] px-2.5 py-0.5 text-xs font-medium text-[#475569]"
                  }
                >
                  {s.status}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="mt-6 text-xs text-[#94A3B8]">
          Sample data. The live operational modules (pipeline, shift log, OEE,
          quality, roster) arrive in later build steps.
        </p>
    </div>
  );
}
