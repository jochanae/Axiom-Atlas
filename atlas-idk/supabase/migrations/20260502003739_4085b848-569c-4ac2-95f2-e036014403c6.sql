-- Purge auto-written process noise from the Decision Ledger.
-- These rows were created by client-side auto-writes that violated
-- POSITIONING.md's rule that the Ledger updates only on Commit or
-- Proceed Anyway. The auto-writes have been removed in src/routes/index.tsx.
-- This deletes the historical pollution so the Decision Catch substrate
-- is clean. Conservative filter: only machine-written titles.
DELETE FROM public.entries
WHERE status = 'committed'
  AND (
    (verb = 'note'  AND title LIKE 'Thought for%')
    OR
    (verb = 'build' AND title LIKE 'Applied Patch%')
  );