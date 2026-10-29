/**
 * The shift report's columns — shared by the sheet (`shift-report-table`) and
 * the row typed into it (`new-entry-row`), so the two cannot disagree about
 * what sits where.
 */

/**
 * The sheet's columns, left to right — in the Log history's order, so a reader
 * moving between the two finds every figure where they last saw it: when, then
 * where and what, then how much, then how fast, then who, then what was said.
 *
 * `width` is in pixels and is also the column's floor when it is dragged:
 * each is sized to the longest word its heading has to hold, so a column
 * dragged narrower would clip its own heading — the "ACCUMU…" this table was
 * rebuilt to get rid of.
 */
export const REPORT_COLUMNS: {
  key: string;
  label: string;
  width: number;
  align?: "right";
}[] = [
  // The edit column. Not hidden here for print — `display:none` on a `<col>`
  // is not honoured the way it is on a cell, and the `th`/`td` already carry
  // `print:hidden`. It has no drag handle: it holds a pencil, not a reading.
  { key: "edit", label: "", width: 34 },
  { key: "time", label: "Start → End", width: 116 },
  { key: "runTime", label: "Run time", width: 88, align: "right" },
  // Labelled with the factory's own word for a room — see the heading.
  { key: "room", label: "Room", width: 84 },
  { key: "stage", label: "Status / stage", width: 110 },
  { key: "batch", label: "Batch", width: 80 },
  { key: "product", label: "Product", width: 140 },
  { key: "code", label: "Code", width: 74 },
  { key: "qty", label: "Shift qty", width: 92, align: "right" },
  // Not "Required": this column holds the entry's own target_qty — speed
  // times how long it ran, what this shift was expected to make — and
  // "Required qty" everywhere else in FactoryOS means the batch order
  // quantity. One word made a handover sheet read as "this batch needs
  // 10,000" where it said "this shift was expected to make 10,000". Named as
  // the log form names it.
  { key: "target", label: "Shift target", width: 90, align: "right" },
  { key: "rejected", label: "Rejected", width: 90, align: "right" },
  // "ACCUMULATIVE" is the longest unbreakable word on the sheet, and this
  // column is sized to it rather than the other way round.
  { key: "accumulative", label: "Accumulative", width: 118, align: "right" },
  { key: "progress", label: "Progress", width: 96 },
  { key: "targetSpeed", label: "Target speed", width: 96, align: "right" },
  { key: "actualSpeed", label: "Actual speed", width: 96, align: "right" },
  { key: "equipment", label: "EQ no.", width: 76 },
  { key: "operators", label: "Operators", width: 110 },
  { key: "comments", label: "Comments", width: 140 },
];

/** How many columns a cell spans to reach the sheet's right edge. */
export const REPORT_SPAN = REPORT_COLUMNS.length;
