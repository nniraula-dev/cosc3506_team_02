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

-- Helpful indexes for discovery
CREATE INDEX IF NOT EXISTS idx_faculty_public
    ON faculty(public_profile);

CREATE INDEX IF NOT EXISTS idx_faculty_verified
    ON faculty(verified_faculty);

CREATE INDEX IF NOT EXISTS idx_projects_status
    ON projects(status);

CREATE INDEX IF NOT EXISTS idx_projects_owner
    ON projects(owner_faculty_id);