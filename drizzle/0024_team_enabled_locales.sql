-- Per-team UI language allow-list.
--
-- jsonb array of locale codes (e.g. ['en','hi']) that a team's owner/admin
-- has chosen to expose to that team's users. NULL = unconfigured = all
-- backend-available locales are open (default; does not disturb existing
-- teams). The language switcher's available set =
-- compiled-supported ∩ backend-available ∩ this allow-list
-- (the third term is skipped when the column is NULL).

ALTER TABLE "Team" ADD COLUMN "enabledLocales" jsonb;
