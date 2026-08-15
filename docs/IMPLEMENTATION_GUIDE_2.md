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
| 9 | **Issues & CAPAs — the staged flow** (§6a) | `/factory/[slug]/actions` |
| 10 | **Shift Report** (§12) | `/factory/[slug]/report` |
| 11 | **Overproduction flag** (§13) | `/factory/[slug]/log`, `/data` |
| 12 | **Viewport workspace layout** (§14) | `factory-shell.tsx` |
| 13 | **Maintenance requests — raising** (§15) | `/factory/[slug]/maintenance` |
| 14 | **Shared batch summary** (§16) | `batch-summary.tsx` |

---

## 0. Run these migrations first

Applied by hand via **Supabase Dashboard → SQL Editor**, in order, continuing from `0014`.

| File | What it does |
|---|---|
| `0015_shift_log_stats_target.sql` | Adds `total_target_qty` to `shift_log_stats()`. **Drops and recreates** the function — Postgres will not let `create or replace` change a return type. The signature is unchanged, so the browser sends the same eight arguments either way |
| `0016_pipeline_jobs.sql` | `factory_processes.is_final_stage` + the partial unique index, the `has_output` check and the demotion trigger; `pipeline_status` enum; `pipeline_jobs` table + RLS; `pipeline_sync_from_log()` — the trigger that moves cards; `pipeline_jobs_expanded` view |
| `0017_actions.sql` | `action_status` / `action_priority` enums; `action_window()`; `actions` + `action_notes` tables + RLS; `actions_from_log()` — a flagged entry raises an action; `actions_log_status_change()` — status changes write themselves into the thread; `actions_expanded` view, **where overdue and escalated are computed** |
| `0020_action_stages.sql` | The staged CAPA flow — see §6a. Replaces `action_status` with the four-value `action_stage`, **renames** `resolved_at/_by` → `closed_at/_by`, adds the evidence columns + the `actions_evidence_follows_stage` constraint, `actions_stage_transition()` (drops `actions_log_status_change()`), the `revert_action()` RPC, and rebuilds `actions_expanded` with the second clock. Drops and recreates the view — Postgres will not alter a column type a view depends on |
| `0021_action_evidence_amend.sql` | `action_amend_note()` + the amendment path in `actions_stage_transition()`: recorded evidence can be corrected in place, the previous text is kept in the thread, and a stage already passed cannot be emptied |
| `0022_shift_supervisor.sql` | `factory_shift_times.supervisor_name` — the one field the shift report needs that nothing else knew. See §12 |
| `0025_action_batch.sql` | `actions.batch_no` + `product_id`; `actions_from_log()` now records the batch it already looked up; `actions_expanded` rebuilt with the product joined on. See §16 |
| `0024_maintenance_requests.sql` | `factory_departments` setup list; `factory_counters` + `next_document_number()`; `maintenance_priority` / `maintenance_status` enums; `maintenance_requests` + RLS + the number-stamping trigger; `maintenance_requests_expanded` view. See §15 |
| `0023_overrun_flag.sql` | Overproduction: `overrun_note` / `_cleared_by` / `_cleared_at` on `shift_log_entries`, a rewritten `shift_log_amend_guard` that tells a clearance from an amendment, and `shift_log_entries_expanded` rebuilt with `is_overrun` / `overrun_qty` / `needs_overrun_note`. See §13 |

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

## 6a. The staged CAPA flow — migration `0020`

_Supersedes the three-status model above. Everything in §6 about the clock being computed, the trigger raising actions from the log, and the thread still holds; what changed is the shape of the middle._

### Why

`open → in_progress → resolved` had both buttons live from the first second. You could open an issue and resolve it in one click, and the record would say a thing was fixed without ever saying what was wrong. Three statuses anyone can jump between is a label, not a loop.

```
open  →  investigating  →  action_taken  →  closed
```

One stage at a time, forward, and **each move has to be paid for with the thing that stage exists to produce**:

| Move | Costs |
|---|---|
| → `investigating` | an owner (`assigned_to`) |
| → `action_taken` | `root_cause` + `corrective_action` (`preventive_action` optional) |
| → `closed` | `verification`, and `can_review_factory()` — supervisor and up |

### Where it is enforced

`actions_stage_transition()`, a **single** `before insert or update` trigger. Deliberately one function rather than a guard plus a history trigger: two `before update` triggers fire in *name* order, so the correctness of the gate would rest on nobody ever renaming one.

Two things back it up:

- **`actions_evidence_follows_stage`**, a check constraint — a row carrying `corrective_action` while still `open` does not exist. It holds on insert too, so it can't be dodged by creating an issue pre-filled. It is also why `advanceAction()` sends the evidence and the status in **one** update: writing the text first and the status second is a sequence Postgres will not accept.
- **Enum declaration order is comparison order**, which is what lets both the constraint and the view say `status >= 'action_taken'` and mean "at or past the stage where a fix exists".

The UI's half is `ActionStageForm`, which renders the form for the *one* move available next and nothing else. While an issue is Open there is no box to type a corrective action into. The trigger refuses the write; this refuses the temptation. Neither is sufficient alone — issues are written browser-direct under RLS, so a gate that lives only in React is a gate anyone with a session can PATCH straight past.

### Going backwards costs a written reason

`action_taken → investigating` (verification failed) and `closed → open` (re-open) are legal. Nothing else backwards is — there is no `investigating → open`, because un-assigning is what that means and it is a field, not a stage.

Both go through the **`revert_action(id, to, reason)` RPC**, and the reason is a required *argument* rather than a note the client is trusted to write first — "please also add a note" is not a rule, it is a hope. The trigger knows the caller came through that door via a transaction-local `set_config('factoryos.revert', 'on', true)`; a direct `update … set status = 'open'` from the browser cannot set it, so a revert without a recorded reason is not expressible.

Reverting **clears** the evidence of the abandoned stage — a re-opened issue must not sit under a root cause already proved wrong — and copies the cleared text into the thread first, so nothing is lost.

### Two clocks

`factories.escalate_hours` (1–48h, added in `0005`, editable in Company settings) had sat unread since it was created. It is now the verification window.

| Clock | Runs while | Columns |
|---|---|---|
| Fix | `status < 'action_taken'` | `is_overdue`, `is_escalated`, `escalates_at` |
| Sign-off | `status = 'action_taken'` | `verify_due_at`, `is_verify_overdue` |

Once the corrective action is in, the urgency is genuinely over — what remains is a signature. Keeping the Critical badge burning through that window is how a factory learns to stop reading badges. `verify_due_at` is null unless the issue is actually waiting on one, so the UI keys off the column rather than off the stage.

### Four-eyes, soft

Closing requires supervisor and up, but is **not** blocked when the closer is the person who recorded the fix — a factory running one supervisor on nights would deadlock until the day shift. It is recorded instead: the trigger's system line reads *"Closed by the same person who took the action."*

### Tabs, and why Escalated isn't one

Four tabs, one per stage. Escalated is a **toggle** (`Needs attention`), not a fifth tab: an escalated issue is already sitting in Open or Investigating, so a tab of its own would show the same row twice and make every count a little bit of a lie. The toggle folds both clocks together — from the floor, "this has been ignored too long" is one idea.

### Correcting what a stage recorded — migration `0021`

Freezing the evidence would leave known-wrong text nobody can fix, which is how people learn to write nothing much in the box. Letting it be silently rewritten would let a signed-off issue be re-authored after the fact. So: **amendable, never silently** — the same bargain `shift_log_amend_guard` strikes.

The amendment path lives in the `status is not distinct from old.status` branch of `actions_stage_transition()`:

- Every changed field writes a system line carrying the **previous text** (`action_amend_note()`, a helper so the four fields can't drift apart in how they're recorded).
- **A stage already passed cannot be emptied.** You may correct a root cause, not delete one — otherwise the record could be hollowed out field by field, which is reverting minus the reason.
- Amending a **closed** issue needs `can_review_factory()`: it rewrites something a supervisor signed.

In the UI each recorded block in `ActionStageTimeline` carries an inline **Edit**. `Raised with` and `Owner` deliberately don't: the first is the shift log's own words, the second has its own control.

### One control per question

Reassignment shows only from Investigating onwards. While an issue is Open, naming an owner **is** the first stage — `StartForm` collects it — so rendering the standalone *Assigned to* box there as well put two controls for one column in one dialog, and read as the app asking the same question twice.

Note that a shift-log-raised issue arrives **unassigned by design** (§6, and `actions_from_log()` has never set `assigned_to`): the operator who spots a capping fault is not the person who fixes it. That is not a lost value.

### Backfill

The `using` clause on the `alter column … type` *is* the backfill: `in_progress → investigating`, `resolved → closed`, in place. `resolved_at/_by` are **renamed** to `closed_at/_by` rather than dropped and re-added — they hold who signed off on every issue closed before today, and that is not regenerable. Old rows carry no root cause and never will; the guard applies to transitions made from here on, not retroactively.

### Files

```
supabase/migrations/0020_action_stages.sql        new
supabase/migrations/0021_action_evidence_amend.sql new
src/app/factory/[slug]/actions/schemas.ts         new — one zod schema per boundary
src/components/factory/actions/action-stage-tabs.tsx      new
src/components/factory/actions/action-stage-timeline.tsx  new
src/components/factory/actions/action-stage-form.tsx      new
src/components/factory/actions/action-detail-dialog.tsx   now a shell composing the three
src/lib/factory/action-queries.ts                 ActionStatus → ActionStage; advance/revert
```

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
- **`assigned_to` is still free text** (§6), so the four-eyes note on closure compares `action_taken_by` to `auth.uid()` — the *accounts*, not the typed name. Someone who records a fix under a colleague's name and then closes it will not be flagged.
- **Nothing escalates a late sign-off to anyone.** `is_verify_overdue` is computed and badged, but no one is notified — same gap the fix clock has.
- **Priority is fixed once raised.** Nothing re-prioritises an issue that turns out worse than it looked, so the due window it was born with is the one it keeps.
- **`preventive_action` is never reported on.** It is collected but nothing aggregates it, so the "P" half of CAPA is currently write-only.
- **No work order anywhere.** The prototype's shift report has a WO column; `shift_log_entries` has no such field, so the column was dropped rather than faked. Adding it means a migration plus the log form, the data table and both CSV exports.
- **The shift report has no totals row.** The summary strip covers the shift; per-room subtotals stop at `producedQty` in the room header, and there is no factory-wide footer the way the data table has one.
- **The shift report reads the whole slice into the browser.** Fine at tens of rows per shift; a factory logging several hundred entries in one shift would want the grouping pushed into an RPC.
- **Nothing links a shift report to a handover.** It prints, but nobody signs it and no record says it was produced — the handover-report module in `ARCHITECTURE_FLOW.md` is still unbuilt.

---

## 12. Shift Report — `/factory/[slug]/report`

**Files:** `shift-report-queries.ts`, `shift-report-csv.ts`, `shift-report-workspace.tsx`, `shift-report-table.tsx`, `shift-report-summary.tsx`, `shift-report-header.tsx`, migration `0022`. Ported from the `factoryos_v13.html` prototype's Shift Report view.

One day, one shift, the whole floor on one sheet. Supervisor and up, under Analytics in `nav.ts`.

### Why it isn't a preset on the data table

They answer different questions. The **data table** answers *"find me the entries matching this"* — thousands of rows, so it filters, sorts and pages in Postgres. The **shift report** answers *"what happened on the floor during that shift"* — a fixed, small slice (one date, one shift; tens of rows) always read whole, and read **by room**.

So this one fetches the slice from the same `shift_log_entries_expanded` view and does the grouping, room ordering and totals in the browser, where the same rows have to be laid out anyway. Aggregating it in SQL would mean a view or RPC producing exactly one screen's shape and nothing else.

### Idle rooms are the point

A room that logged nothing is **kept on the sheet**, not filtered out. A report listing only the busy rooms can't answer "was anything running in 7?" — and the blank row is the answer.

Their status comes from `pipeline_jobs` rather than being assumed idle: a room holding a batch is not a room standing ready. `IDLE_FROM_PIPELINE` maps `production`/`hold`/`planned`; a finished job left the room free, so that falls through to `READY`.

Rooms with entries but since deactivated in Admin are also kept — their work still happened.

### Room ordering

`compareRoomNames()` compares the embedded number first. Plain alphabetical puts "Room 10" before "Room 2", which is wrong on a sheet people read by room number.

### Three departures from the prototype

- **16 columns, not 18.** The prototype printed the same figure twice, twice over: *Shift Total* and *Achieved* were both `qty`, *Required* and *Target* were both `target_qty`. A wide sheet that prints one number in two places invites the reader to hunt for a difference that cannot exist. **Rejected** was added in the space freed — it was in the log and missing from the report.
- **No WO column.** No work order is captured anywhere in FactoryOS; it rendered blank for every row in the prototype too. Noted in §11 rather than faked.
- **The CSV is built from the data, not scraped from the DOM.** The prototype exported `querySelectorAll('td').textContent`, which ships the truncated product name, the `—` placeholders and the `%` glued to a number — and breaks silently the moment a column is reordered. `toShiftReportCsv()` walks the same room grouping the table renders.

### The supervisor line — migration `0022`

`factory_shift_times.supervisor_name`, edited in Admin → Shift times next to the clock it belongs to. On the shift-time row rather than on `factories` because it is a property of *a* shift: mornings and afternoons have different supervisors, which is the whole reason the report names one.

Free text, same reasoning as the shift log's operators and an issue's assignee — a supervisor covering at short notice may have no login. Optional, and the header omits the line entirely when it's blank: "Supervisor: —" on a handover sheet reads as nobody being in charge, which is worse than silence.

### Printing

The report *is* a handover document — printed at the end of a shift and handed to the next one — so print is a first-class output, not an afterthought.

- A `@media print` block in `globals.css`: landscape (sixteen columns), `print-color-adjust: exact` so flagged rows and progress bars survive, `break-inside: avoid` on rows, and `thead { display: table-header-group }` so the header repeats on page two.
- `print:hidden` on the shell's top bar and sidebar, and on the report's own controls — you cannot press a button on paper.

### Refetch

`refetchInterval` is 60s **only when the date is today**. A shift in progress is still being written to; a past shift is finished and polling it buys nothing.

---

## 13. Overproduction — flagged on the entry, cleared by a manager

**Files:** migration `0023`, `shift-log-queries.ts`, `shift-log-table-queries.ts`, `shift-log-csv.ts`, `log/schemas.ts`, `explain-overrun-dialog.tsx`, `activity-feed.tsx`, `shift-log-table.tsx`, `data-table-workspace.tsx`.

A batch has a `required_qty`. When the running total for a batch **and activity** goes past it, the entry is still filed — the units exist, and refusing to record them would only make the log wrong — but it carries an **Attention** flag until a manager writes down why there is more product than the work order asked for.

### The flag is computed, not stored

Nothing holds an `is_overrun` boolean. It is `accumulative > required_qty`, evaluated on every read in the view — same call as `is_overdue` on an issue.

A stored flag goes stale the moment someone amends the quantity down: the numbers would read 14,900 of 15,000 and a flag would still sit there claiming an overrun that no longer exists. Computed, **correcting the entry clears the flag by itself**.

What *is* stored is the only part a comparison cannot derive: the explanation. Three columns — `overrun_note`, `overrun_cleared_by`, `overrun_cleared_at` — and the note's presence is what clears the badge.

`required_qty` comes through as `nullif(pr.required_qty, 0)`: the column defaults to 0, and a product with no requirement must never look overrun.

### Clearing is not an amendment

This is the subtle part. Every update to `shift_log_entries` passes through `shift_log_amend_guard`, which demands an `amend_note` and stamps `amended_at`. Explaining an overrun changes none of the logged numbers, so routing it through that path would mark the row as *corrected* when nothing about the shift was corrected.

The guard was rewritten to recognise a **clearance-only** update — one touching nothing but the three overrun columns:

```sql
probe := new;
probe.overrun_note := old.overrun_note;        -- …and the other two
clearance_only := (new is distinct from old) and (probe is not distinct from old);
```

A clearance needs no `amend_note`, leaves `amended_at` alone, is refused unless `can_manage_factory()`, and has `overrun_cleared_by` / `_at` stamped by the trigger rather than sent by the client.

The manager-only rule **has** to live there, not in the dialog: `shift_log_amend` lets an operator update their own entry, so without it the person who logged the overrun could wave it away themselves — the one thing this feature exists to prevent.

The amendment branch also forces the three overrun columns back to their old values, so a correction cannot smuggle an explanation in alongside the numbers.

### Where the explanation is visible

An audit trail nobody can read is a control on paper only, so the note and the name are surfaced, not buried in a tooltip:

- **Data table** — a second line under Comments: `↳ Overrun: <reason> — <name>`, plus an **Overrun explained** pill where the flag was.
- **Log feed** — the same line under the entry.
- **CSV export** — six columns: required qty, over by, status, reason, explained by, explained at.

`overrun_cleared_by_name` is resolved in the view by joining `profiles`; `profiles_factory_read` (migration 0007) lets a member read every profile in their own tenant, and the view is `security_invoker`, so it stays inside the tenant boundary.

### Two badge states, not one

**Attention** (unexplained) is the thing to act on. Once explained it becomes **Overrun explained** rather than disappearing — the batch still ran over, and that is a fact about the batch, not a problem that went away because someone described it.

In the feed the Attention badge is a **button** for a manager: the feed is where a supervisor is actually looking when the overrun lands, and making them walk to the data table to clear it is how a flag gets ignored.

### Why the feed needs a second query

`ActivityFeed` reads `shift_log_entries` directly — it needs the nested unit/process/product shape, and the insert returns that same shape for the optimistic update. The overrun flag can't come from there: it compares a batch's running total against its requirement, and that total is a window function that only exists in `shift_log_entries_expanded`.

So `fetchOverrunFlags(factoryId, date)` is a small second read keyed per day and merged by id in the browser — cheaper than reshaping the feed's read around one badge. Its cache key sits under `logKeys.factory(factoryId)`, so the log form's existing invalidation already covers it.

### Decisions taken

- **Any excess flags.** 15,001 of 15,000 counts. No tolerance setting yet — see §11 if it proves noisy.
- **Manager and admin only** (`can_manage_factory()`), not supervisors.
- **No CAPA is raised.** Overproduction is usually explained in a sentence; routing every one through Investigating → Action taken → Closed would bury the board.

---

## 14. The workspace is a frame, not a page

**Files:** `factory-shell.tsx`, `factory-sidebar.tsx`, the `data` and `report` pages and their workspaces, `shift-log-table.tsx`, `shift-report-table.tsx`.

From **`lg` up**, the viewport is the frame and scrolling happens *inside* it:

```
h-svh flex flex-col overflow-hidden
├── header                     shrink-0
└── flex min-h-0 flex-1
    ├── sidebar wrapper        overflow-y-auto
    └── <main>                 flex flex-col overflow-y-auto   ← the scroller
```

### Why it was needed

`<thead>` already carried `sticky top-0` and it did nothing, because **sticky resolves against the nearest scrolling ancestor** — and that was the document. Scrolling a twenty-column table meant losing the header and scrolling back up to find out which column a number was in.

### How a page opts in — no prop, no route-sniffing

`<main>` is the scroll container, so ordinary pages overflow it and scroll exactly as they did; only the scrollbar moved from the document to `<main>`.

A page that wants the viewport instead makes its **own root** `lg:flex lg:min-h-0 lg:flex-1 lg:flex-col` and passes `lg:min-h-0 lg:flex-1` down to the element that should absorb the slack. It then fits `<main>` exactly, never overflows, and the table inside becomes the only scroller. The layout needs no `fullHeight` prop and no `usePathname()` — the page decides by how it sizes itself.

`min-h-0` on every flex ancestor is the load-bearing part. A flex item's default `min-height: auto` refuses to shrink below its content, so one missing `min-h-0` and the table pushes the frame open and the page scrolls again.

### Below `lg`, and on paper

Both are exempt, deliberately:

- **Mobile** keeps document scroll. The rail stacks *above* the content there, so a locked viewport would pin the whole nav on screen and leave a sliver for the page.
- **Print** unwinds the frame (`print:h-auto`, `print:overflow-visible`, `print:block`, `print:static` on the sticky cells). A fixed-height frame prints exactly one screen — it would have silently truncated the shift report to its first dozen rooms.

### Sticky goes on the cells, never the row

`position: sticky` on a `<tr>` is ignored everywhere except Firefox. Both tables put it on the `<th>` (and the data table's `<td>` totals), each with its own background so body rows don't show through.

The data table's `<tfoot>` is `sticky bottom-0` for the same reason as the header: a total you have to scroll to the end to read is a total nobody reads.

### Filters collapse

The data table's filter bar is seven controls tall, read once; the table under it is read all day. It is now behind a **Filters** button, collapsed by default, carrying a badge of how many filters are active — so a narrowed table can never be mistaken for the whole log.

`activeFilterCount()` counts the date range as **one**, not two: "16 Jul → 15 Aug" is a single decision, and counting both inputs would show `2` on a table nobody has touched.

---

## 15. Maintenance requests — raising one

**Files:** migration `0024`, `maintenance-queries.ts`, `maintenance/schemas.ts`, `new-maintenance-dialog.tsx`, `maintenance-workspace.tsx`, `admin-tabs.ts`, `setup-queries.ts`, `nav.ts`. Ported from the prototype's Maintenance module.

**Scope is the raising half only.** A request is created, numbered and listed; nothing assigns it, works it or verifies it. `maintenance_status` declares the full journey (`reported → assigned → in_progress → completed → verified`) so the states arrive later without a type swap, but only `reported` is reachable and no column that would record the *work* has been invented ahead of knowing what it must hold.

### Two departures from the prototype, both asked for

**Department, not issue type.** The prototype asks what kind of fault it is — mechanical, electrical, pneumatic. What actually needs recording is *who is needed*, and which trades a plant keeps in-house differ: one factory has Electrical and Utilities, the next outsources both. So it is a per-tenant setup list.

`factory_departments` has the same shape as `factory_units`, which means the generic `SetupListManager` drives it with **no new component** — the work was one migration, one entry in the `SetupTable` union, one row in `ADMIN_TABS`, and one `<Panel>`. It carries no flags.

**The batch is typed, not picked.** Same as the shift log, and the same reasoning: the number is on the paperwork in front of whoever found the fault. A dropdown of open batches is slower and stops working the moment the batch isn't on the pipeline board — which, for a machine that broke mid-run, it may not be.

Both `batch_no` (text) and `product_id` are stored. The text is what someone searches for later and survives a batch nobody added to the catalogue; the id is the resolution *when there is one*, never a requirement. A no-match is stated in the form ("saved as typed"), not treated as an error — blocking there would only teach people to leave the field blank. Matching is done in the browser against the already-cached product list, exactly as `log-entry-form.tsx` does it.

### Request numbers

`MR-2026-014`, so a request can be read out on the floor rather than referred to by uuid.

`factory_counters (factory_id, kind, year, next_value)` plus `next_document_number()`, **not** `max(number) + 1` at insert time — that pattern hands the same number to two people submitting at once and then fails one of them on the unique index. The function inserts the counter row if absent, then `update … returning`; the update takes a **row lock**, so a second caller blocks and comes out with the next number.

Keyed by `kind` as well as factory because CAPA numbers will want exactly this and should not grow their own counter. The table has RLS on and **no policy at all** — only the definer function touches it, and nothing in the browser has business reading it.

The number is stamped by a `before insert` trigger, never sent by the client, so it can't be chosen or skipped. Allocating it inside the same transaction as the row also means a failed insert doesn't burn a number and leave a gap people read as "one went missing".

### Optional fields and the zod/RHF gotcha

`unitId`, `departmentId`, `batchNo`, `reportedBy` and `assignedTo` are typed as plain **required strings that may be empty**, not `.optional()`.

`.optional().default("")` gives zod an *input* type that differs from its output, and `zodResolver` then refuses to typecheck against the form's value type. The form always supplies `""` from its defaults, so "optional" here means "may be blank", and `createMaintenanceRequest` turns blank into `null` on the way in. Worth remembering for the next form.

### Access

Nav item is `roles: ALL` — the person who finds a broken machine is whoever was standing next to it, and the insert policy stamps the raiser from the session. Update and delete policies are manager-only and currently unused; they exist so the workflow has something to build on.

---

## 16. The affected batch, and one component for it

**Files:** migration `0025`, `batch-summary.tsx`, `action-queries.ts`, `new-action-dialog.tsx`, `action-list.tsx`, `action-detail-dialog.tsx`, `new-maintenance-dialog.tsx`.

### Issues carry a batch now

An issue raised from the shift log **already knew** which batch it concerned — `actions_from_log()` looks the product up to build the title — and then threw it away, folded into a string. So "Quality flagged — Room 5 · Vitamin D3" could not be traced back to a run without opening the shift log and hunting, and an issue raised by hand had nowhere to record one at all.

`actions.batch_no` + `product_id`, exactly as maintenance carries them (§15): the text survives a batch nobody added to the catalogue and is what someone searches for later; the id is the resolution *when there is one*.

The trigger fills both **straight off the entry**. Asking a supervisor to retype a batch number the operator already typed is how the two drift apart.

In the detail dialog the batch is **read-only**. It was settled when the issue was raised; re-pointing an investigation at a different run halfway through is a new issue, not an edit.

### `BatchSummary` — one component, two forms

The maintenance form had its own inline hint; rather than write a second variant for issues, both now share `BatchSummary`: **product, code and required qty**, and nothing else.

Its whole job is to confirm the number was typed correctly, so it reads the already-cached product catalogue and makes no other query. Actual/produced quantity was built and then removed — on a maintenance request or an issue it answered a question nobody was asking, and it cost two extra reads (batch entries + process names) per keystroke to compute.

The shift log keeps its own `BatchAutofill`, and that is not duplication: there the running total is *for the activity being logged* plus whatever is currently in the quantity field — a live figure that depends on form state this component has no business knowing.

---

## 17. Related docs

- `docs/IMPLEMENTATION_GUIDE.md` — everything up to and including the shift log and data table. **Read first.**
- `docs/PROGRESS.md` — narrative record of what landed when.
- `docs/ARCHITECTURE_FLOW.md` — product scope and intent; predates most of the code.
