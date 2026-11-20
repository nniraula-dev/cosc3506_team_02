-- Release 4 additive migration for an existing R1–R3 deployment.
-- This deliberately contains only the R4 schema changes.  Do not run the
-- full schema.sql in a shared environment merely to release R4, because that
-- historical bootstrap file also removes the obsolete Phase 0 demo table.

ALTER TABLE industry_opportunities
    DROP CONSTRAINT IF EXISTS industry_opportunities_source_type_check;
ALTER TABLE industry_opportunities
    ADD CONSTRAINT industry_opportunities_source_type_check
    CHECK (source_type IN ('industry', 'faculty', 'external'));

CREATE TABLE IF NOT EXISTS external_sources (
    id SERIAL PRIMARY KEY,
    source_key TEXT NOT NULL UNIQUE CHECK (btrim(source_key) <> ''),
    display_name TEXT NOT NULL CHECK (btrim(display_name) <> ''),
    last_successful_sync_at TIMESTAMPTZ,
    last_successful_source_at DATE,
    last_failure_at TIMESTAMPTZ,
    last_failure_reason TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS external_opportunities (
    opportunity_id INTEGER PRIMARY KEY REFERENCES industry_opportunities(id) ON DELETE CASCADE,
    source_id INTEGER NOT NULL REFERENCES external_sources(id) ON DELETE RESTRICT,
    external_id TEXT NOT NULL CHECK (btrim(external_id) <> ''),
    authoritative_url TEXT NOT NULL CHECK (btrim(authoritative_url) <> ''),
    content_hash TEXT NOT NULL CHECK (btrim(content_hash) <> ''),
    source_status TEXT NOT NULL DEFAULT 'active'
        CHECK (source_status IN ('active', 'not-seen', 'withdrawn')),
    source_synced_at DATE NOT NULL,
    last_seen_at TIMESTAMPTZ,
    last_changed_at TIMESTAMPTZ,
    changed_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
    last_known_content JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (source_id, external_id)
);

CREATE TABLE IF NOT EXISTS external_faculty_interests (
    opportunity_id INTEGER NOT NULL REFERENCES external_opportunities(opportunity_id) ON DELETE CASCADE,
    faculty_id INTEGER NOT NULL REFERENCES faculty(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (opportunity_id, faculty_id)
);

CREATE TABLE IF NOT EXISTS r4_external_sync_runs (
    id SERIAL PRIMARY KEY,
    source_id INTEGER NOT NULL REFERENCES external_sources(id) ON DELETE RESTRICT,
    status TEXT NOT NULL CHECK (status IN ('successful', 'failed')),
    requested_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    source_synced_at DATE,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    new_count INTEGER NOT NULL DEFAULT 0,
    unchanged_count INTEGER NOT NULL DEFAULT 0,
    changed_count INTEGER NOT NULL DEFAULT 0,
    not_seen_count INTEGER NOT NULL DEFAULT 0,
    malformed_count INTEGER NOT NULL DEFAULT 0,
    failure_reason TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS r4_external_sync_events (
    id SERIAL PRIMARY KEY,
    sync_run_id INTEGER NOT NULL REFERENCES r4_external_sync_runs(id) ON DELETE CASCADE,
    opportunity_id INTEGER REFERENCES external_opportunities(opportunity_id) ON DELETE SET NULL,
    external_id TEXT NOT NULL DEFAULT '',
    classification TEXT NOT NULL
        CHECK (classification IN ('new', 'unchanged', 'changed', 'not-seen', 'malformed')),
    changed_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
    details TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_external_opportunities_source
    ON external_opportunities(source_id, source_status);
CREATE INDEX IF NOT EXISTS idx_external_interests_faculty
    ON external_faculty_interests(faculty_id, opportunity_id);
CREATE INDEX IF NOT EXISTS idx_r4_sync_runs_source
    ON r4_external_sync_runs(source_id, finished_at DESC);
CREATE INDEX IF NOT EXISTS idx_r4_sync_events_run
    ON r4_external_sync_events(sync_run_id, classification);
