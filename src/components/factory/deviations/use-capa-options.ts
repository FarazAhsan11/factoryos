"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import type { SelectOptionGroup } from "@/components/ui/select-field";
import {
  STAGE_LABELS,
  actionKeys,
  fetchActions,
} from "@/lib/factory/action-queries";

/**
 * The Issues & CAPAs register as picker options, for linking a deviation to
 * the CAPA it is being worked under.
 *
 * Read from the list Issues & CAPAs already caches, so the picker costs no
 * request of its own there. Issues still being worked come first; closed ones
 * stay offered, because a deviation is often linked after its CAPA is done.
 */
export function useCapaOptions(factoryId: string): SelectOptionGroup[] {
  const { data: actions = [] } = useQuery({
    queryKey: actionKeys.all(factoryId),
    queryFn: () => fetchActions(factoryId),
  });

  return useMemo(() => {
    const option = (a: (typeof actions)[number]) => ({
      value: a.id,
      label: a.title,
      meta: [STAGE_LABELS[a.status], a.batch_no].filter(Boolean).join(" · "),
    });
    const open = actions.filter((a) => a.status !== "closed").map(option);
    const closed = actions.filter((a) => a.status === "closed").map(option);
    return [
      { label: "Being worked", options: open },
      { label: "Closed", options: closed },
    ].filter((g) => g.options.length > 0);
  }, [actions]);
}
