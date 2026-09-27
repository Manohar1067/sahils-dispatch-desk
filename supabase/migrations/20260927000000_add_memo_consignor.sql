-- Additive, idempotent migration: give `memos` a real CONSIGNOR field.
--
-- WHY: the Goods Despatch Memo has always had a Consignor line, but the
-- application had NO column for it. The receipt hard-coded
-- `Consignor: memo.fromLocation`, so the Consignor cell could never carry the
-- actual source/consignor party and was not independently editable.
--
-- This adds a single nullable text column so the value can flow
-- New Memo form -> form state -> memos row -> memo display -> receipt.
--
-- COMPATIBILITY:
--  - Nullable, so every existing row stays valid and reads back as NULL/empty.
--  - NO BACKFILL: existing rows keep consignor = NULL. Their receipts print
--    "—" because there is no stored Consignor. Copying from_location or the
--    consignee into this column would fabricate data the user never entered.
--    A Consignor stays empty until a user explicitly types one and saves.
--  - `transport_list` is deliberately NOT touched: Consignor is a memo/receipt
--    field only.
--
-- NOTIFY pgrst, 'reload schema' forces PostgREST to rebuild its schema cache;
-- without it INSERT/UPDATE of the new column fails with
-- "Could not find the 'consignor' column of 'memos' in the schema cache".
--
-- ADDITIVE ONLY: no DROP, no RENAME, no DELETE, no data reset, no table recreation.

ALTER TABLE public.memos
  ADD COLUMN IF NOT EXISTS consignor text;

NOTIFY pgrst, 'reload schema';
