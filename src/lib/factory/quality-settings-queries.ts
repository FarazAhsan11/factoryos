import { useQuery } from "@tanstack/react-query";

import { createClient } from "@/lib/supabase/client";

/**
 * Configuration → Quality settings (migration 0071): the days a case has to
 * close by class, and the days QA has to sign the initial assessment.
 *
 * Read and written browser-direct under RLS (members read, manager and up
 * write). A factory with no row runs on the defaults. The database stamps who
 * and when, logs every change (`quality_settings_log`), and reads the
 * due-date days itself when an assessment is signed (`quality_due_days`) —
 * the screens use these only to show what signing will set.
 */

export interface QualitySettings {
  dueCriticalDays: number;
  dueMajorDays: number;
  dueMinorDays: number;
  assessDays: number;
}

export const DEFAULT_QUALITY_SETTINGS: QualitySettings = {
  dueCriticalDays: 15,
  dueMajorDays: 30,
  dueMinorDays: 60,
  assessDays: 2,
};

export interface QualitySettingsChange {
  id: number;
  at: string;
  actor_name: string | null;
  setting: string;
  old_value: string | null;
  new_value: string | null;
}

export const qualitySettingsKeys = {
  all: (factoryId: string) => ["quality-settings", factoryId] as const,
  log: (factoryId: string) => ["quality-settings", factoryId, "log"] as const,
};

/** The days to close a case of this class. */
export function dueDaysFor(
  settings: QualitySettings,
  cls: "Critical" | "Major" | "Minor",
): number {
  return cls === "Critical"
    ? settings.dueCriticalDays
    : cls === "Major"
      ? settings.dueMajorDays
      : settings.dueMinorDays;
}

export async function fetchQualitySettings(
  factoryId: string,
): Promise<QualitySettings> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("factory_quality_settings")
    .select("due_critical_days, due_major_days, due_minor_days, assess_days")
    .eq("factory_id", factoryId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return DEFAULT_QUALITY_SETTINGS;
  return {
    dueCriticalDays: data.due_critical_days,
    dueMajorDays: data.due_major_days,
    dueMinorDays: data.due_minor_days,
    assessDays: data.assess_days,
  };
}

export async function saveQualitySettings(
  factoryId: string,
  values: QualitySettings,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("factory_quality_settings").upsert(
    {
      factory_id: factoryId,
      due_critical_days: values.dueCriticalDays,
      due_major_days: values.dueMajorDays,
      due_minor_days: values.dueMinorDays,
      assess_days: values.assessDays,
    },
    { onConflict: "factory_id" },
  );
  if (error) throw new Error(error.message);
}

export async function fetchQualitySettingsLog(
  factoryId: string,
): Promise<QualitySettingsChange[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("quality_settings_log")
    .select("id, at, actor_name, setting, old_value, new_value")
    .eq("factory_id", factoryId)
    .order("at", { ascending: false })
    .order("id", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * The factory's settings, or the defaults while they load — what a screen
 * shows is then never blank, and is corrected the moment the row arrives.
 */
export function useQualitySettings(factoryId: string): QualitySettings {
  const { data } = useQuery({
    queryKey: qualitySettingsKeys.all(factoryId),
    queryFn: () => fetchQualitySettings(factoryId),
  });
  return data ?? DEFAULT_QUALITY_SETTINGS;
}
