# FactoryOS — Implementation Guide, part 2 (Pipeline, Actions, and the refinements around them)

_How the Pipeline board, the Actions loop, the product bulk import and this round of shift-log / data-table changes are built — and **why** each one is shaped the way it is._

_Last updated: 2026-08-08_

Continues `docs/IMPLEMENTATION_GUIDE.md`, which covers everything up to and including the shift log and its data table. Read that one first for the house patterns (React Query cache keys, browser-direct writes under RLS, the `SetupListManager` flag plumbing); this file assumes them.

| # | Feature | Where |
|---|---|---|
| 1 | Data table — totals moved into a table footer | `/factory/[slug]/data` |
| 2 | Shift log — operators optional on waiting-time activities | `/factory/[slug]/log` |
| 3 | Products — bulk CSV import | `?tab=products` |
| 4 | Processes — the `Final` stage tag | `?tab=processes` |
| 5 | **Pipeline — Kanban batch tracker** | `/factory/[slug]/pipeline` |
| 6 | **Actions & escalations** | `/factory/[slug]/actions` |
| 7 | Shared CSV primitives | `src/lib/factory/csv.ts` |
| 8 | Dialog primitive — max height | `src/components/ui/dialog.tsx` |

---

## 0. Run these migrations first

Applied by hand via **Supabase Dashboard → SQL Editor**, in order, continuing from `0014`.

| File | What it does |
|---|---|
| `0015_shift_log_stats_target.sql` | Adds `total_target_qty` to `shift_log_stats()`. **Drops and recreates** the function — Postgres will not let `create or replace` change a return type. The signature is unchanged, so the browser sends the same eight arguments either way |
| `0016_pipeline_jobs.sql` | `factory_processes.is_final_stage` + the partial unique index, the `has_output` check and the demotion trigger; `pipeline_status` enum; `pipeline_jobs` table + RLS; `pipeline_sync_from_log()` — the trigger that moves cards; `pipeline_jobs_expanded` view |
| `0017_actions.sql` | `action_status` / `action_priority` enums; `action_window()`; `actions` + `action_notes` tables + RLS; `actions_from_log()` — a flagged entry raises an action; `actions_log_status_change()` — status changes write themselves into the thread; `actions_expanded` view, **where overdue and escalated are computed** |

No new npm dependencies.

---

## 1. Data table — totals in a `<tfoot>`, not a floating bar

**Files:** `data-table-workspace.tsx`, `shift-log-table.tsx`, `shift-log-table-queries.ts`, migration `0015`. `data-table-stats.tsx` was **deleted**.

### Two changes, one motivation

The totals used to sit in a bar above the table and were always visible. Two problems: unfiltered, it summed the factory's entire last 30 days directly above a table showing those same rows — a headline-looking figure answering no question anybody asked, easy to misread as a total for the page on screen. And a total labelled "Total qty" floating above twenty columns doesn't say *which* column it totals.

Now:

- **The footer only exists when the filters are non-default.** Gated on `!isDefault`, reusing `filtersAreDefault()` — the same predicate that enables the *Clear filters* button, so the two can never drift.
- **The stats RPC is `enabled: !isDefault`** too, so an untouched table doesn't pay for an aggregate nobody sees.
- **`showTotals` is a separate prop from `stats`.** Totals are shown or hidden by the filters, not by load state — keyed off `stats` being present, the row would blink out of the table on every refetch.

### Which columns get a total

`TOTALS` in `shift-log-table.tsx` maps a column key to a getter. Only four are there, and the exclusions are the point:

- **`accumulative`** is already a running total. Summing running totals adds the same units in once per entry.
- **`target_speed` / `actual_speed`** are rates. 1,200 caps/hr + 980 caps/hr is not 2,180 of anything; the honest summary of a rate column is a duration-weighted average, which belongs in OEE.

The row is built by walking `COLUMNS` with `FIRST_TOTAL` / `LAST_TOTAL` derived from that map, so inserting or reordering a column carries its footer cell with it instead of silently shifting every total one place left.

Columns between the first and last totalled one (Room, Activity, Batch, Product, Code) render as **genuinely empty cells**. An em-dash there reads as a missing total for a column that can't have one, and lands right-aligned under a left-aligned header.

Quality rate is not a column total — it's a ratio of two of them — so it's labelled and parked in the span the un-totallable columns leave.

### Separation

`TF` uses `border-t-2 border-[#94A3B8]` and a deeper background than the header. Body rows are conditionally tinted (pink for a flagged entry, amber for rejects), and a pale rule vanished against them, making the totals read as one more entry.

---

## 2. Shift log — operators optional on waiting time

**Files:** `log/schemas.ts`, `log-entry-form.tsx`, `operator-picker.tsx`, `shift-log-queries.ts`. No migration — `operators text[]` always had a ceiling of 20 and no floor.

### The rule

```ts
export function operatorsRequired(hasMachine: boolean, hasOutput: boolean) {
  return hasMachine || hasOutput;
}
```

Exported and used by **both** the validator and the form, so the "(optional)" marker on screen and the rule that blocks submit can't disagree.

Deliberately **not** keyed on `has_output` alone. A machine stage that produces nothing still had someone at the machine, and Sorting produces units by hand — both keep the requirement. Only "time passed and nobody was operating anything" (Manning, Set Up, Idle, Ready, Materials, the cleans) drops it.

### How it's enforced

`operatorList` lost its `.min(1)` **and** its per-row `.min(1)`; blank rows are now dropped by the transform rather than rejected. The "at least one" rule moved into the object-level `superRefine`, which is the only place that can see the activity flags:

```ts
if (operatorsRequired(values.hasMachine, values.hasOutput) &&
    values.operators.length === 0) {
  ctx.addIssue({ code: "custom", path: ["operators", 0, "name"], message: OPERATOR_REQUIRED });
}
```

The path is pinned to the first picker rather than the array so the error still renders inline on the control the operator has to act on, rather than as a headless array error.

Verified against seven cases: Manning with a blank operator files (`operators=[]`); Manning with a name files; Sorting blank is blocked; machine/no-output blank is blocked; a named + blank row pair files with the blank dropped; `"Ali"` + `"ali"` is still caught as a duplicate.

---

## 3. Products — bulk CSV import

**Files:** `product-import-dialog.tsx`, `product-csv.ts`, `csv.ts`, `product-queries.ts` (`createProducts`), `products-panel.tsx`.

### CSV file only — the paste tab was built and removed

A "paste from Excel" tab existed briefly. It was removed because a clipboard paste carries no guarantee of **column count**: a three-column selection was read positionally and shifted every value one place left, importing plausible-looking rows with the product name in `code` and a required quantity of 0. Nothing failed, because every field it landed in accepted a string.

That failure is still reachable through a headerless *file*, so the parser guards it directly:

```ts
if (!hasHeader && firstCells.length !== 5) { /* refuse with an explicit message */ }
```

A headerless input is only accepted at exactly the five columns the positional order describes. Anything narrower is refused by name rather than silently shifted.

### Delimiter detection — a real bug worth remembering

The first cut treated comma, semicolon **and** tab as delimiters simultaneously. On a tab-separated row, `540,000` split into two cells and the batch filed with a target of **540** — a plausible number nothing downstream could tell was off by a thousand.

`detectDelimiter()` now decides **once** from the first line, quote-aware: tab wins outright when present, otherwise whichever of `;` / `,` appears more. `splitLine(line, delimiter)` takes it as a parameter.

### Existing batches are skipped, never upserted

Re-uploading last month's sheet must not silently reset a `required_qty` that production has been logging against. `splitExisting()` compares against the catalogue the panel already has loaded, so the review step **names** the batches it will skip before anything is written — rather than a `23505` that names nothing, after the fact.

### `createProducts` — chunked, with per-row attribution

Inserts in chunks of 50. A chunk that fails is **retried row by row**, because Postgres rejects the whole statement on one bad row and the error names no batch — without the retry, one late duplicate would report 50 failures.

---

## 4. Processes — the `Final` stage tag

**Files:** migration `0016` §1, `setup-queries.ts`, `admin-workspace.tsx`.

### Why it exists

A batch passes through several producing stages and **each logs roughly the full quantity** — dispensed 540,000, encapsulated 540,000, packed 540,000. Summing them finishes a job at a quarter of the real work; taking the largest finishes it when the *first* stage does. Neither is the truth. So exactly one process per factory is named as the one whose output **is** the batch's output.

### Three database guarantees

```sql
-- at most one per factory
create unique index factory_processes_one_final
  on factory_processes (factory_id) where is_final_stage;

-- must produce something, or produced_qty is always 0
alter table factory_processes add constraint factory_processes_final_produces_output
  check (not is_final_stage or has_output);

-- ticking it demotes the previous holder
create trigger factory_processes_single_final
  before insert or update of is_final_stage on factory_processes
  for each row when (new.is_final_stage) execute function clear_other_final_stages();
```

The demotion is a **trigger, not two client writes**. Clear-then-set from the browser leaves the factory with *no* final stage if the second write fails, which silently disables completion for every job on the board. Here the client makes one write and the invariant can't be observed broken, including by two admins tagging different processes at the same moment.

The `has_output` check exists because a `has_output = false` process stores null quantities by design (0013) — tagging one would leave every job stuck at 0 produced, forever, with nothing on screen explaining why.

### UI

Threaded through `FLAG_COLUMNS` in `setup-queries.ts` as the neutral key `final`, so `SetupListManager` still never learns a column name. Renders as a third pill beside Manual / No output.

**Known limitation:** one final stage per factory assumes every product line ends at the same step. If a factory's powder line ends at Powder Pack and its liquid line at Liquid Packing, jobs on one of them can never complete. The fix is to drop the unique index and let a job complete when *any* tagged stage reaches the required quantity — a batch only passes through one of them in practice.

---

## 5. Pipeline — the Kanban batch tracker

**Files:** migration `0016`, `pipeline-queries.ts`, `pipeline-workspace.tsx`, `pipeline-board.tsx`, `new-job-dialog.tsx`, `job-detail-dialog.tsx`, route `pipeline/page.tsx`.

### The single most important property: nobody drags a card

A card's column is a **fact about what has been logged** against the batch. A hand-dragged card would be an opinion sitting next to it, and the two would disagree the moment anyone filed an entry. There is no drag-and-drop, and adding it later would break the model rather than extend it.

### The transitions

| From | Event | To |
|---|---|---|
| planned | **any** log entry for that batch — including Set Up / Manning / Idle | production |
| planned / production | entry carries an action flag | hold |
| hold | next entry with no flag | production |
| production | final-stage total ≥ required qty | finished |

Waiting-time activities **do** start a job: logging Set Up against a batch means somebody is on it, which is exactly what Planned stops being true about. A flag is checked *after* the start rule, so an issue raised during set-up lands the card in On Hold rather than Planned.

A held job can't finish — an unresolved issue outranks a quantity. A finished job is never re-opened: a late amendment shouldn't resurrect a card everyone has stopped looking at.

### Why the trigger, not the client

`pipeline_sync_from_log()` fires `after insert or update on shift_log_entries`. Three reasons this can't live in the browser:

1. **The log is audit-protected and permanent.** A client that dies between "insert the entry" and "update the job" leaves the board permanently disagreeing with the record it describes.
2. **Amendments.** Correcting an entry has to re-evaluate the job; client code written today never re-runs over a row amended tomorrow.
3. Any future caller — an import, a Server Action, a seed script — gets the behaviour without knowing it exists.

It is `SECURITY DEFINER` because the person logging is usually an operator while the `pipeline_jobs` write policy is managers-only. The card must move regardless of who did the work, but **only** through this function — which is why the policy stays narrow.

### Schema notes

- **`unit_id` is learned, not asked for.** Every log entry names a unit, so the card says which room without anyone maintaining it. It is set from the *latest* entry — a batch genuinely moves between rooms, so the card tells you where to walk to today. Limitation: a batch running in two rooms in parallel flip-flops between them.
- **One job per batch**, enforced by a unique index on `product_id`. Consistent with `factory_products`, which is already unique on `(factory_id, lower(batch_no))`.
- **No `priority`, `due_date` or `note` columns.** The prototype has them; the New Job modal is just checkboxes, and unused columns are cruft.

### `pipeline-queries.ts` — what's deliberately absent

**Nothing writes `status`.** The board moves itself from the shift log; a status write from the client would be a second, competing source of truth for the same fact.

`deletePipelineJob` is only ever offered on a **Planned** card. Once work is logged the job is the visible half of an audit-protected record, and deleting the card while the entries remain would make the board and the log disagree about whether a batch ran.

### New Job modal

Lists active products with **no job yet** — an anti-join computed in the workspace (`available`). This is the reason `pipeline_jobs` is a separate table rather than a status column on `factory_products`: "not in the pipeline" is a clean absence rather than a null special-case.

No fields to fill. Everything a card shows either comes from the product row or is learned later from the log; asking for a room here would only create something for the log to contradict.

**Select-all acts on what's visible**, not the whole catalogue — with a search active, "select all" meaning "including the 200 you filtered out" is a destructive surprise.

### Job detail dialog

Three tabs over **one** fetch, because they are three slices of the same rows: `totalsByProcess`, `totalsByRoom`, and flagged entries. Aggregated in the browser rather than through another view — a batch has tens of entries, not thousands.

The **By stage** tab exists because of a real confusion: the card's bar tracks the final stage alone, so 5,000 encapsulated against a Labelling-tagged factory shows as **0%**. That is correct, and it reads as broken until you can see where the work actually is. The dialog header restates the number as *"measured at the final stage"* for the same reason.

Non-producing stages are excluded from that tab — they store null quantities and would be a row of dashes.

---

## 6. Actions & escalations

**Files:** migration `0017`, `action-queries.ts`, `actions-workspace.tsx`, `action-list.tsx`, `action-detail-dialog.tsx`, `new-action-dialog.tsx`, route `actions/page.tsx`.

### The design point: overdue and escalated are **not stored**

```sql
(status <> 'resolved' and now() > due_at) as is_overdue,
(status <> 'resolved' and now() > due_at + action_window(priority)) as is_escalated
```

The prototype stored them and walked the list flipping statuses whenever someone happened to open the page — so an action that went overdue at 2am looked fine until the first person logged in, and if nobody did, it never escalated at all.

But nobody *decides* to escalate. It's simply what "still not done, this long after it was due" means. Computed, it's true the moment it's true, with no cron job, no background worker and no write. `status` holds only what a person chose: `open` / `in_progress` / `resolved`.

The view also exposes **`escalates_at`**, so the list can say "Escalates in 40m" — a warning while you can still act, rather than only telling you once it's too late.

### The clock

`action_window(priority)` is **one** function used for both the due time and the escalation grace, so the two can never drift apart:

| Priority | From flag | Due within | Escalates at |
|---|---|---|---|
| critical | Safety | 2h | 4h |
| high | Quality, Maintenance | 4h | 8h |
| medium | Process | 8h | 16h |
| low | manual only | 24h | 48h |

Priority earns its keep here rather than being a coloured label. A flat window for everything — the prototype's four hours — means the label says nothing.

### Two deliberate departures from the prototype

- **Auto-created actions are unassigned.** The prototype assigns them to whoever logged the entry. The operator who spots a capping fault is not the person who fixes it, and an action assigned to the wrong name *looks handled* while nothing happens. Unassigned renders in amber, visibly waiting.
- **Priority comes from the flag**, not `'high'` for everything.

### `assigned_to` is free text, for now

Same reasoning as the shift log's operators: the person who has to fix a gate sensor is often a contractor or maintenance tech with no login. A dropdown of accounts can be layered on later without moving what's already recorded.

### Triggers

- **`actions_from_log()`** — `after insert or update on shift_log_entries`. Guarded by `if exists (select 1 from actions where shift_log_entry_id = new.id)`, because amending a flagged entry re-fires it and a second action would split the conversation. The unique index on `shift_log_entry_id` is the backstop. Notes are built from the entry's `comment` + `slow_reason` so nobody has to open the shift log to find out what happened.
- **`actions_log_status_change()`** — `before update on actions`. Stamps `resolved_at` / `resolved_by` from `auth.uid()` and appends a system line to `action_notes`. In a trigger so the history can't be skipped and "resolved by" isn't something the client claims. Re-opening **clears** the resolution rather than leaving a stale stamp.

### `matchesFilter` — escalated is a filter, not a status

It cuts across open and in-progress alike. An action someone started and then left for a shift is exactly the one worth surfacing, so "in progress" does not exempt it.

### The list refetches every 60s

`refetchInterval: 60_000`. The clock keeps moving even when nothing is written — an action can go overdue, then escalate, while the page sits open.

### The dialog is keyed, not effect-reset

`ActionDetailDialog` renders `<Body key={action.id} …>`. Resetting the note and assignee fields with a `useEffect` runs a render late and leaks half-typed text from one action into the next — and trips `react-hooks/set-state-in-effect`.

`ActionsWorkspace` re-reads the selected action from the refetched list (`selectedLive`), because the dialog holds a snapshot — otherwise resolving an action leaves its own dialog showing "Open".

---

## 7. Shared CSV primitives — `src/lib/factory/csv.ts`

Extracted when the product importer needed the same splitter as the employee one. `employee-csv.ts` was refactored onto it rather than keeping a second copy, and gained tab support and delimiter detection as a side effect.

| Export | Notes |
|---|---|
| `splitLine(line, delimiter)` | Minimal RFC-4180: quoted fields, escaped `""` |
| `detectDelimiter(firstLine)` | Quote-aware; tab wins, else `;` vs `,` by count |
| `numberedLines(text)` | Non-blank lines with their 1-based numbers, so errors point somewhere real |
| `indexOfHeader(cells, candidates)` | Header matching by alias |
| `parseQuantity(value)` | Strips `,` / space / `_`; `""` → 0; unparseable → `null` |
| `chunk(rows, size)` | |

---

## 8. Dialog primitive — max height

`DialogContent` is centred with `-translate-y-1/2` and had **no ceiling of its own**, so content taller than the window grew off both edges with nothing to scroll — taking the close button with it. Now `max-h-[calc(100dvh-2rem)] overflow-y-auto`.

Two levels of scrolling is the right arrangement: an inner container (the job detail's tabs, the import review lists) keeps headers and tabs visible, and the outer one is a safety net.

---

## 9. Cross-module cache invalidation

A shift-log write now has three downstream readers, all updated by database triggers the client can't see:

```ts
// log-entry-form.tsx onSuccess
logKeys.factory(factoryId)        // the activity feed
["shift_log_batch", factoryId]    // the accumulative total
pipelineKeys.all(factoryId)       // a card may have moved
actionKeys.all(factoryId)         // a flag may have raised an action
```

`amend-entry-dialog.tsx` invalidates `logTableKeys`, `logKeys` and `pipelineKeys` — an amendment re-runs the status trigger.

**If you add another trigger on `shift_log_entries`, add its cache key here too.** The write succeeds either way; the UI just won't show it until something else refetches.

---

## 10. File map for this work

### New

```
supabase/migrations/
  0015_shift_log_stats_target.sql
  0016_pipeline_jobs.sql
  0017_actions.sql

src/lib/factory/
  csv.ts                     shared CSV primitives
  product-csv.ts             product parser + template + splitExisting
  pipeline-queries.ts        board reads, job create/delete, detail aggregation
  action-queries.ts          actions, notes, filters, time formatting

src/components/factory/
  admin/product-import-dialog.tsx
  pipeline/pipeline-workspace.tsx
  pipeline/pipeline-board.tsx
  pipeline/new-job-dialog.tsx
  pipeline/job-detail-dialog.tsx
  actions/actions-workspace.tsx
  actions/action-list.tsx
  actions/action-detail-dialog.tsx
  actions/new-action-dialog.tsx

src/app/factory/[slug]/
  pipeline/page.tsx + loading.tsx
  actions/page.tsx  + loading.tsx
```

### Changed

```
src/app/factory/[slug]/log/schemas.ts      operatorsRequired + relaxed operatorList
src/components/factory/log/log-entry-form.tsx    optional operators, new cache keys
src/components/factory/log/operator-picker.tsx   `optional` prop
src/components/factory/data/data-table-workspace.tsx  footer gating
src/components/factory/data/shift-log-table.tsx       TotalsRow, TOTALS map
src/components/factory/data/amend-entry-dialog.tsx    pipeline invalidation
src/components/factory/admin/products-panel.tsx       Bulk import button
src/components/factory/admin/admin-workspace.tsx      Final flag config
src/components/ui/dialog.tsx                          max-height
src/lib/factory/setup-queries.ts           final → is_final_stage
src/lib/factory/shift-log-table-queries.ts totalTargetQty
src/lib/factory/shift-log-queries.ts       operators no longer re-filtered
src/lib/factory/employee-csv.ts            refactored onto csv.ts
src/lib/factory/nav.ts                     Pipeline + Actions ready: true
```

### Deleted

```
src/components/factory/data/data-table-stats.tsx   → became a <tfoot>
```

---

## 11. Known gaps and things left deliberately

- **One final stage per factory** may be too rigid for multi-line factories — see §4.
- **Pipeline holds and Actions are not linked.** A hold clears on the next clean log entry; resolving the action doesn't release it. Agreed as separate for now.
- **`flagged_count`** on a pipeline card counts entries that *ever* raised a flag, not open ones. It will mean "open" once it can join to `actions`.
- **`defaultFilters()` derives `from` as "30 days ago" at call time** and `filtersAreDefault()` recomputes it — a session left open across midnight sees them disagree, which makes the data table's footer appear and *Clear filters* light up unprompted.
- **`fetchBatchEntries` uses `ilike` on `batch_no`** without escaping `%` / `_`, so a batch number containing either would over-match.
- **The batch progress bar in the log form** is still scoped to the selected activity and shows 0% with no activity chosen. Left as-is by decision; `is_final_stage` now makes a batch-level figure possible if that changes.
- **Pipeline tabs** — Planning by room, Gantt and Archive exist in the prototype and are not built.

---

## 12. Related docs

- `docs/IMPLEMENTATION_GUIDE.md` — everything up to and including the shift log and data table. **Read first.**
- `docs/PROGRESS.md` — narrative record of what landed when.
- `docs/ARCHITECTURE_FLOW.md` — product scope and intent; predates most of the code.
