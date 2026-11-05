-- Project 2 - Opportunity Registry & Pathway Platform
-- Release 1 schema

-- Remove old Phase 0 demo table
DROP TABLE IF EXISTS items;

-- Research areas supplied by the R1 fixture
CREATE TABLE IF NOT EXISTS research_areas (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);

-- Faculty accounts/profiles
CREATE TABLE IF NOT EXISTS faculty (
    id SERIAL PRIMARY KEY,
    fixture_id TEXT UNIQUE,
    user_id INTEGER,
    display_name TEXT NOT NULL,
    public_profile BOOLEAN NOT NULL DEFAULT FALSE,
    verified_faculty BOOLEAN NOT NULL DEFAULT FALSE,
    inquiry_preference TEXT NOT NULL DEFAULT 'general',
    bio TEXT NOT NULL DEFAULT '',
    external_links TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT faculty_inquiry_preference_check
        CHECK (
            inquiry_preference IN (
                'general',
                'listed-projects-only',
                'none'
            )
        )
);

-- Faculty can belong to multiple research areas
CREATE TABLE IF NOT EXISTS faculty_research_areas (
    faculty_id INTEGER NOT NULL REFERENCES faculty(id) ON DELETE CASCADE,
    research_area_id INTEGER NOT NULL REFERENCES research_areas(id) ON DELETE CASCADE,
    PRIMARY KEY (faculty_id, research_area_id)
);

-- Faculty projects
CREATE TABLE IF NOT EXISTS projects (
    id SERIAL PRIMARY KEY,
    fixture_id TEXT UNIQUE,
    owner_faculty_id INTEGER NOT NULL REFERENCES faculty(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    student_level TEXT NOT NULL,
    term TEXT NOT NULL,
    prerequisite TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT project_status_check
        CHECK (
            status IN (
                'draft',
                'published',
                'withdrawn',
                'closed'
            )
        )
);

-- Projects can belong to multiple research areas
CREATE TABLE IF NOT EXISTS project_research_areas (
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    research_area_id INTEGER NOT NULL REFERENCES research_areas(id) ON DELETE CASCADE,
    PRIMARY KEY (project_id, research_area_id)
);

-- Basic authenticated users.
-- Authentication behavior will be implemented by the backend later.
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    is_verified_faculty BOOLEAN NOT NULL DEFAULT FALSE,
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Authentication challenges and sessions are persisted so authentication works
-- across backend restarts and deployments.
CREATE TABLE IF NOT EXISTS auth_challenges (
    id SERIAL PRIMARY KEY,
    email TEXT NOT NULL,
    challenge_code TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_challenges_email
    ON auth_challenges(email);

CREATE TABLE IF NOT EXISTS auth_sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id
    ON auth_sessions(user_id);

-- Safe upgrades for databases initialized with the original R1 schema.
ALTER TABLE faculty
    ADD COLUMN IF NOT EXISTS user_id INTEGER;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'faculty_user_id_fkey'
    ) THEN
        ALTER TABLE faculty
            ADD CONSTRAINT faculty_user_id_fkey
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'faculty_user_id_unique'
    ) THEN
        ALTER TABLE faculty
            ADD CONSTRAINT faculty_user_id_unique UNIQUE (user_id);
    END IF;
END $$;

ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS prerequisite TEXT NOT NULL DEFAULT '';

-- Helpful indexes for discovery
CREATE INDEX IF NOT EXISTS idx_faculty_public
    ON faculty(public_profile);

CREATE INDEX IF NOT EXISTS idx_faculty_verified
    ON faculty(verified_faculty);

CREATE INDEX IF NOT EXISTS idx_projects_status
    ON projects(status);

CREATE INDEX IF NOT EXISTS idx_projects_owner
    ON projects(owner_faculty_id);

CREATE INDEX IF NOT EXISTS idx_faculty_user_id
    ON faculty(user_id);

-- Release 2: accountless industry intake and faculty coordination.
CREATE TABLE IF NOT EXISTS industry_opportunities (
    id SERIAL PRIMARY KEY,
    submission_id TEXT UNIQUE,
    organisation_name TEXT NOT NULL CHECK (btrim(organisation_name) <> ''),
    contact_name TEXT NOT NULL DEFAULT '',
    contact_email TEXT NOT NULL CHECK (btrim(contact_email) <> ''),
    title TEXT NOT NULL CHECK (btrim(title) <> ''),
    description TEXT NOT NULL DEFAULT '',
    capacity TEXT NOT NULL DEFAULT 'not-sure'
        CHECK (capacity IN ('one-team-only', 'multiple-teams', 'not-sure')),
    status TEXT NOT NULL DEFAULT 'awaiting-supervisor'
        CHECK (status IN ('awaiting-supervisor', 'supervised')),
    engagement_state TEXT NOT NULL DEFAULT 'not-contacted'
        CHECK (engagement_state IN ('not-contacted', 'discussion-underway', 'partner-confirmed', 'no-longer-pursuing')),
    engagement_faculty_id INTEGER REFERENCES faculty(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS industry_opportunity_areas (
    opportunity_id INTEGER NOT NULL REFERENCES industry_opportunities(id) ON DELETE CASCADE,
    research_area_id INTEGER NOT NULL REFERENCES research_areas(id) ON DELETE RESTRICT,
    PRIMARY KEY (opportunity_id, research_area_id)
);

CREATE TABLE IF NOT EXISTS industry_opportunity_supervisors (
    opportunity_id INTEGER NOT NULL REFERENCES industry_opportunities(id) ON DELETE CASCADE,
    faculty_id INTEGER NOT NULL REFERENCES faculty(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (opportunity_id, faculty_id)
);

CREATE TABLE IF NOT EXISTS faculty_opportunity_subscriptions (
    faculty_id INTEGER PRIMARY KEY REFERENCES faculty(id) ON DELETE CASCADE,
    subscribe_all BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS faculty_opportunity_subscription_areas (
    faculty_id INTEGER NOT NULL REFERENCES faculty(id) ON DELETE CASCADE,
    research_area_id INTEGER NOT NULL REFERENCES research_areas(id) ON DELETE CASCADE,
    PRIMARY KEY (faculty_id, research_area_id)
);

CREATE TABLE IF NOT EXISTS faculty_notifications (
    id SERIAL PRIMARY KEY,
    faculty_id INTEGER NOT NULL REFERENCES faculty(id) ON DELETE CASCADE,
    opportunity_id INTEGER NOT NULL REFERENCES industry_opportunities(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    read_at TIMESTAMPTZ,
    UNIQUE (faculty_id, opportunity_id)
);

CREATE INDEX IF NOT EXISTS idx_industry_opportunities_status
    ON industry_opportunities(status);
CREATE INDEX IF NOT EXISTS idx_industry_supervisors_faculty
    ON industry_opportunity_supervisors(faculty_id);
CREATE INDEX IF NOT EXISTS idx_industry_areas_area
    ON industry_opportunity_areas(research_area_id);
CREATE INDEX IF NOT EXISTS idx_faculty_notifications_faculty
    ON faculty_notifications(faculty_id, created_at DESC);

-- Upgrade early R2 development databases that used the pre-fixture name
-- "one-team" for the one-team capacity value.
ALTER TABLE industry_opportunities
    DROP CONSTRAINT IF EXISTS industry_opportunities_capacity_check;
ALTER TABLE industry_opportunities
    ADD CONSTRAINT industry_opportunities_capacity_check
    CHECK (capacity IN ('one-team-only', 'multiple-teams', 'not-sure'));

-- Release 3: opportunity lifecycle, mutual matches, and outcome showcase.
-- Keep R2's publication status separate from this lifecycle state: an
-- opportunity must still be supervised before it can be discovered, while its
-- lifecycle answers whether it is currently available for a new match.
ALTER TABLE industry_opportunities
    ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'industry',
    ADD COLUMN IF NOT EXISTS target_term TEXT,
    ADD COLUMN IF NOT EXISTS application_deadline DATE,
    ADD COLUMN IF NOT EXISTS lifecycle_state TEXT NOT NULL DEFAULT 'open',
    ADD COLUMN IF NOT EXISTS lifecycle_reason TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS expiry_exception BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS partner_agreed_in_principle BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS r3_schedule_required BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE industry_opportunities
    DROP CONSTRAINT IF EXISTS industry_opportunities_source_type_check;
ALTER TABLE industry_opportunities
    ADD CONSTRAINT industry_opportunities_source_type_check
    CHECK (source_type IN ('industry', 'faculty'));

ALTER TABLE industry_opportunities
    DROP CONSTRAINT IF EXISTS industry_opportunities_lifecycle_state_check;
ALTER TABLE industry_opportunities
    ADD CONSTRAINT industry_opportunities_lifecycle_state_check
    CHECK (lifecycle_state IN ('open', 'expired', 'withdrawn', 'matched', 'completed', 'archived'));

-- The fixture deliberately evaluates fixed deadlines against a simulated date.
-- Store that clock explicitly so it is auditable in release evidence rather
-- than relying on the wall clock of a developer or deployment server.
CREATE TABLE IF NOT EXISTS r3_evaluation_settings (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    evaluation_date DATE NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO r3_evaluation_settings (singleton, evaluation_date)
VALUES (TRUE, DATE '2026-11-06')
ON CONFLICT (singleton) DO NOTHING;

-- A student account can sign in through the existing passwordless flow.  This
-- profile is intentionally separate from faculty and starts private by default.
CREATE TABLE IF NOT EXISTS student_profiles (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    fixture_id TEXT UNIQUE,
    display_name TEXT NOT NULL,
    public_profile BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Renewals keep the opportunity id stable.  Each term/deadline is a run, so
-- completed outcomes continue to belong to the earlier run after renewal.
CREATE TABLE IF NOT EXISTS opportunity_runs (
    id SERIAL PRIMARY KEY,
    opportunity_id INTEGER NOT NULL REFERENCES industry_opportunities(id) ON DELETE CASCADE,
    run_number INTEGER NOT NULL,
    target_term TEXT NOT NULL,
    application_deadline DATE,
    lifecycle_state TEXT NOT NULL DEFAULT 'open'
        CHECK (lifecycle_state IN ('open', 'expired', 'withdrawn', 'matched', 'completed', 'archived')),
    lifecycle_reason TEXT NOT NULL DEFAULT '',
    is_current BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (opportunity_id, run_number)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_opportunity_runs_one_current
    ON opportunity_runs(opportunity_id) WHERE is_current = TRUE;

CREATE TABLE IF NOT EXISTS opportunity_lifecycle_events (
    id SERIAL PRIMARY KEY,
    opportunity_id INTEGER NOT NULL REFERENCES industry_opportunities(id) ON DELETE CASCADE,
    run_id INTEGER REFERENCES opportunity_runs(id) ON DELETE SET NULL,
    from_state TEXT,
    to_state TEXT NOT NULL
        CHECK (to_state IN ('open', 'expired', 'withdrawn', 'matched', 'completed', 'archived')),
    reason TEXT NOT NULL DEFAULT '',
    changed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS match_proposals (
    id SERIAL PRIMARY KEY,
    fixture_id TEXT UNIQUE,
    opportunity_id INTEGER NOT NULL REFERENCES industry_opportunities(id) ON DELETE CASCADE,
    run_id INTEGER REFERENCES opportunity_runs(id) ON DELETE SET NULL,
    faculty_id INTEGER NOT NULL REFERENCES faculty(id) ON DELETE RESTRICT,
    state TEXT NOT NULL DEFAULT 'proposed'
        CHECK (state IN ('proposed', 'partly-confirmed', 'confirmed', 'declined', 'withdrawn')),
    partner_agreed_in_principle BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS match_participants (
    match_id INTEGER NOT NULL REFERENCES match_proposals(id) ON DELETE CASCADE,
    student_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    response_state TEXT NOT NULL DEFAULT 'pending'
        CHECK (response_state IN ('pending', 'confirmed', 'declined')),
    responded_at TIMESTAMPTZ,
    PRIMARY KEY (match_id, student_user_id)
);

CREATE TABLE IF NOT EXISTS opportunity_outcomes (
    id SERIAL PRIMARY KEY,
    fixture_id TEXT UNIQUE,
    opportunity_id INTEGER NOT NULL REFERENCES industry_opportunities(id) ON DELETE CASCADE,
    run_id INTEGER REFERENCES opportunity_runs(id) ON DELETE SET NULL,
    summary TEXT NOT NULL CHECK (btrim(summary) <> ''),
    completed_on DATE NOT NULL,
    links JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    faculty_confirmed_by INTEGER REFERENCES faculty(id) ON DELETE SET NULL,
    faculty_confirmed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Consent and profile appearance are stored per participant.  A showcase item
-- is public only when its confirming faculty is public and every participant
-- has consented; a student can still hide it from only their own profile.
CREATE TABLE IF NOT EXISTS outcome_participants (
    id SERIAL PRIMARY KEY,
    outcome_id INTEGER NOT NULL REFERENCES opportunity_outcomes(id) ON DELETE CASCADE,
    participant_kind TEXT NOT NULL CHECK (participant_kind IN ('faculty', 'student')),
    faculty_id INTEGER REFERENCES faculty(id) ON DELETE CASCADE,
    student_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    public_consent BOOLEAN NOT NULL DEFAULT FALSE,
    profile_visible BOOLEAN NOT NULL DEFAULT TRUE,
    CHECK (
        (participant_kind = 'faculty' AND faculty_id IS NOT NULL AND student_user_id IS NULL)
        OR
        (participant_kind = 'student' AND student_user_id IS NOT NULL AND faculty_id IS NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_outcome_participant_faculty
    ON outcome_participants(outcome_id, faculty_id)
    WHERE faculty_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_outcome_participant_student
    ON outcome_participants(outcome_id, student_user_id)
    WHERE student_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_student_profiles_fixture
    ON student_profiles(fixture_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_lifecycle
    ON industry_opportunities(lifecycle_state, application_deadline);
CREATE INDEX IF NOT EXISTS idx_match_proposals_opportunity
    ON match_proposals(opportunity_id, state);
CREATE INDEX IF NOT EXISTS idx_match_participants_student
    ON match_participants(student_user_id, response_state);
CREATE INDEX IF NOT EXISTS idx_outcomes_opportunity
    ON opportunity_outcomes(opportunity_id, completed_on DESC);
