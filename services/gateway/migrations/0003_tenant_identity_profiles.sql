ALTER TABLE organizations
    ADD COLUMN display_name TEXT NOT NULL DEFAULT 'Tenant';

ALTER TABLE organizations
    ADD CONSTRAINT organizations_org_id_uuidv7_check
    CHECK (uuid_extract_version(org_id::uuid) = 7);
