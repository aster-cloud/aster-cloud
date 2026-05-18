-- Monotonic revocation publication version allocator.
--
-- PR-L7 publisher uses nextval('revocation_publication_version_seq') instead
-- of SELECT MAX(version)+1 to avoid concurrent publisher races.

CREATE SEQUENCE IF NOT EXISTS "revocation_publication_version_seq"
    AS bigint
    START WITH 1
    INCREMENT BY 1
    MINVALUE 1
    NO CYCLE;
