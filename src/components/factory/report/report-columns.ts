/**
 * The shift report's columns — shared by the sheet (`shift-report-table`) and
 * the row typed into it (`new-entry-row`), so the two cannot disagree about
 * what sits where.
 */

/**
 * The sheet's groups, left to right. Each one is its own panel: a titled cap in
 * the heading, and a gap either side instead of a rule, so the eye reads the
 * sheet in sections without lines cutting through every row.
 *
 * `accent` is the pale step of a palette hue, because it sits on the dark
 * heading: the strong steps shout there, and the group is a label, not an alert.
 */
export const REPORT_GROUPS = [
  { key: "entry", label: "Entry", accent: "var(--color-brand-line)" },
  { key: "time", label: "Time", accent: "var(--color-sky-line)" },
  { key: "product", label: "Product", accent: "var(--color-teal-line)" },
  { key: "output", label: "Output", accent: "var(--color-warn-line)" },
  { key: "results", label: "Against target", accent: "var(--color-danger-line)" },
  { key: "machine", label: "Machine", accent: "var(--color-azure-line)" },
  { key: "team", label: "Team & notes", accent: "var(--color-line-strong)" },
] as const;

export interface ReportColumn {
  key: string;
  label: string;
  /**
   * In pixels, and also the column's floor when it is dragged: each is sized to
   * the longest word its heading has to hold, so a column dragged narrower
   * would clip its own heading — the "ACCUMU…" this table was rebuilt to get
   * rid of.
   */
  width: number;
  align?: "right";
  /** Which panel it sits in. Only the row's controls belong to none. */
  group?: (typeof REPORT_GROUPS)[number]["key"];
  /** Worked out rather than typed, and tinted so it reads that way. */
  derived?: true;
}

/**
 * The sheet's columns, left to right — the plant's own layout: where and what,
 * when, which batch, how much, against what, how fast and on what, then who and
 * what was said. A group's columns have to stay side by side; a heading cannot
 * span columns that aren't.
 *
 * Two things that have no column of their own stay in the cell they qualify:
 * the action flag sits under the activity it was raised on, and the progress
 * bar under the accumulative total it is drawn from.
 */
export const REPORT_COLUMNS: ReportColumn[] = [
  // The edit column. Not hidden here for print — `display:none` on a `<col>`
  // is not honoured the way it is on a cell, and the `th`/`td` already carry
  // `print:hidden`. It has no drag handle: it holds the row's two controls, the
  // pencil and the amendment history, not a reading.
  { key: "edit", label: "", width: 66 },
  // Labelled with the factory's own word for a room — see the heading.
  { key: "room", label: "Room", width: 90, group: "entry" },
  { key: "stage", label: "Activity / Stage", width: 130, group: "entry" },
  { key: "time", label: "Start → End", width: 124, group: "time" },
  { key: "runTime", label: "Duration", width: 84, group: "time", derived: true },
  { key: "batch", label: "Batch", width: 86, group: "product" },
  { key: "product", label: "Product", width: 170, group: "product", derived: true },
  { key: "code", label: "Product Code", width: 84, group: "product", derived: true },
  { key: "qty", label: "Qty produced", width: 102, align: "right", group: "output" },
  { key: "unit", label: "Unit", width: 76, group: "output" },
  // Not "Required": this column holds the entry's own target_qty — speed
  // times how long it ran, what this shift was expected to make — and
  // "Required qty" everywhere else in FactoryOS means the batch order
  // quantity. One word made a handover sheet read as "this batch needs
  // 10,000" where it said "this shift was expected to make 10,000". Named as
  // the log form names it.
  {
    key: "target",
    label: "Shift target",
    width: 96,
    align: "right",
    group: "results",
    derived: true,
  },
  { key: "rejected", label: "Rejected", width: 90, align: "right", group: "results" },
  // "ACCUMULATIVE" is the longest unbreakable word on the sheet, and this
  // column is sized to it rather than the other way round.
  {
    key: "accumulative",
    label: "Accumulative Total",
    width: 118,
    align: "right",
    group: "results",
    derived: true,
  },
  { key: "targetSpeed", label: "Target speed", width: 102, align: "right", group: "machine" },
  { key: "actualSpeed", label: "Actual speed", width: 110, align: "right", group: "machine" },
  { key: "slowReason", label: "Slow reason", width: 180, group: "machine" },
  { key: "equipment", label: "EQ No.", width: 76, group: "machine" },
  { key: "operators", label: "Operators", width: 226, group: "team" },
  { key: "comments", label: "Comments", width: 170, group: "team" },
];

/** How many columns a cell spans to reach the sheet's right edge. */
export const REPORT_SPAN = REPORT_COLUMNS.length;
