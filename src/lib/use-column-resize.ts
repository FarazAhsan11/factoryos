"use client";

import { useState, type PointerEvent } from "react";

/**
 * Spreadsheet-style column widths: drag a heading's right edge to widen the
 * column and read what it cut off.
 *
 * `floors` are the columns' starting widths, in pixels, in column order — and
 * also how narrow a drag may take each one, because a table's starting widths
 * are the ones sized to hold its headings. The ceiling is the column's longest
 * value: past that a drag only adds blank space and pushes the rest of the
 * sheet out of view.
 *
 * `widths` is null until the first drag, and the table should lay itself out
 * as it always has while it is — stretched to fill the window, typically. Once
 * a column is dragged every width is pinned to what was on screen and the
 * table should be exactly as wide as their sum, so the edge follows the cursor
 * and the other columns stay where they are.
 */
export function useColumnResize(floors: readonly number[]) {
  const [widths, setWidths] = useState<number[] | null>(null);
  /** Mid-drag: the cursor should hold as a resize arrow wherever it strays. */
  const [resizing, setResizing] = useState(false);

  /** Hand to a heading's handle as its `onPointerDown`, with its column. */
  function startResize(index: number, event: PointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    event.preventDefault();

    const handle = event.currentTarget;
    const table = handle.closest("table");
    const cells = handle.closest("tr")?.children;
    if (!table || !cells) return;
    // What is on screen, not the floors — on a wide window the table has
    // stretched every column past them, and pinning to the floors would snap
    // the whole grid narrower the moment the drag began.
    const start = Array.from(
      cells,
      (cell) => cell.getBoundingClientRect().width,
    );
    const startX = event.clientX;
    const floor = floors[index] ?? 0;
    // Never below where the column already stands, though: a column the
    // table stretched past its data would otherwise snap narrower the instant
    // it was grabbed.
    const ceiling = Math.max(floor, start[index], dataWidth(table, index));
    setWidths(start);
    setResizing(true);

    handle.setPointerCapture(event.pointerId);
    const move = (e: globalThis.PointerEvent) => {
      const width = Math.min(
        ceiling,
        Math.max(floor, start[index] + e.clientX - startX),
      );
      setWidths((prev) =>
        (prev ?? start).map((w, i) => (i === index ? width : w)),
      );
    };
    const end = () => {
      setResizing(false);
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }

  return { widths, resizing, startResize };
}

/**
 * How wide column `index` must be to show its longest value without an
 * ellipsis.
 *
 * Read off the rendered rows rather than the data: what decides the width is
 * how a value is drawn — its font, the unit after a quantity, the chevron on a
 * dropdown — and only the page knows that. Cells that span columns (a room's
 * band, a row's detail strip) belong to no one column and are skipped.
 */
function dataWidth(table: HTMLTableElement, index: number): number {
  let widest = 0;
  for (const body of Array.from(table.tBodies)) {
    for (const row of Array.from(body.rows)) {
      let col = 0;
      for (const cell of Array.from(row.cells)) {
        if (col === index && cell.colSpan === 1) {
          widest = Math.max(widest, fullWidth(cell));
        }
        col += cell.colSpan;
        if (col > index) break;
      }
    }
  }
  return widest;
}

/**
 * One cell's width with nothing in it cut off: its width now, plus the most
 * that any one thing inside it overflows by.
 *
 * Per element rather than per cell, because the text that gets clipped is
 * rarely the cell's own — it is a truncated label inside a dropdown, a value
 * inside an input, a name inside a span that shares its cell with an icon.
 * Every one of those grows with its cell, so its overflow is what the cell is
 * short by.
 *
 * One pixel is added on top, because `scrollWidth` is rounded *down*: a name
 * 204.19px long reports 204, and a cell sized to 204 is still a fifth of a
 * pixel short — which the browser answers with an ellipsis over the last two
 * letters, exactly as though the drag had stopped early. (Chrome already
 * counts the trailing padding in `scrollWidth`, on a cell and on an input
 * alike, so that is not added again.)
 */
function fullWidth(cell: HTMLTableCellElement): number {
  let short = 0;
  for (const el of [cell, ...Array.from(cell.querySelectorAll("*"))]) {
    // Inline elements report no width at all, and an element squeezed to a
    // pixel is screen-reader text, not a value anyone is trying to read.
    if (el.clientWidth < 2) continue;
    short = Math.max(short, el.scrollWidth - el.clientWidth);
  }
  const width = cell.getBoundingClientRect().width;
  return short > 0 ? Math.ceil(width + short + 1) : width;
}
