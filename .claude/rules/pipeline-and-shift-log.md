---
paths:
  - "src/app/factory/[slug]/pipeline/**"
  - "src/app/factory/[slug]/log/**"
  - "src/components/factory/pipeline/**"
  - "src/components/factory/log/**"
  - "src/lib/factory/pipeline-queries.ts"
  - "src/lib/factory/batch-stage-queries.ts"
  - "src/lib/factory/stage-templates.ts"
  - "src/lib/factory/schedule.ts"
---

# Pipeline and shift log — invariants

The full behaviour is in `docs/MODULES.md` (Pipeline, Shift log, Products) and `docs/DATABASE.md` (`0031`–`0044`). The rules that are easy to break:

- **Nobody sets a card's status by hand.** It moves itself from the shift log (`pipeline_sync_from_log`) and from stage sign-offs.
- **Stored batch type ≠ its label.** `manufacturing | packing | combined` are what the database and every guard read; the UI says Bulk Production / Finished Lot / Single Batch (`BATCH_TYPES`). Renaming a label is wording; renaming a value is a migration.
- **The ordered quantity is shown, never typed.** `factory_products.required_qty` is the only copy — a second one gives the overrun check and the plan different numbers. The same goes for a due date: copied onto a new card, never linked afterwards, and changed only in Products.
- **The shift-log gate (`0038`):** a `preparatory` or `production` entry is accepted only if the typed batch names a product, that product has a card on the board, the card is **issued**, and the activity is a stage in its plan. `downtime` is exempt from the last two, but a batch number it names must be real and on the board. An open quarantine NCR refuses preparatory / production entries (`0044`).
- **The last stage completes the order — by position, not a flag** (the *final group*, `0036`: the last stage plus any contiguous `can_run_parallel` stages before it). Reordering moves it. Stage `unit_id`, `planned_date` and `est_finish_date` are advisory: nothing gates on them.
- **Tolerance and overage are different knobs — never merge them.** Overage is extra deliberately *made* against the work order and raises a flag; tolerance is how far past one stage's plan an entry may be *recorded*, and it **blocks** the write. Tolerance is set once on the batch and inherited by every stage.
- **The Schedule's Board and Queue are two views over `buildRoomLanes`** — change the derivation, not one view.
- Show a pack size with `formatPackSize`, not the two-decimal `fmt`.
- The shift-log form has three shapes chosen by the activity's `category` (downtime / preparatory / production); `has_machine` and `has_output` are derived columns, not editable.
