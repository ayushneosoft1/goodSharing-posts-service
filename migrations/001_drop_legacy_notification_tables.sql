-- Module 5 PART C
-- Remove legacy posts-service notification and subscription tables.
-- These tables are no longer used by the application.
-- WARNING: Applying this migration permanently deletes their existing data.
-- Do not use CASCADE: unexpected dependencies must cause the migration to fail.

BEGIN;

DROP TABLE IF EXISTS public.notifications;
DROP TABLE IF EXISTS public.category_subscriptions;

COMMIT;
