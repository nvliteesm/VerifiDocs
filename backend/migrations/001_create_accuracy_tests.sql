-- Migration: 001_create_accuracy_tests
-- Description: Create the accuracy_tests table for AI accuracy testing module
-- Requirements: 5.1, 5.2, 5.3, 5.4

CREATE TABLE accuracy_tests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
    question TEXT NOT NULL,
    ai_answer TEXT NOT NULL,
    source_evidence JSONB NOT NULL DEFAULT '[]',
    reference_answer TEXT,
    judgment TEXT,
    status TEXT DEFAULT 'needs_review'
        CHECK (status IN ('likely_correct', 'needs_review', 'incorrect', 'human_approved', 'human_rejected')),
    confidence_score NUMERIC,
    reason TEXT,
    failure_reason TEXT,
    human_status TEXT
        CHECK (human_status IN ('human_approved', 'human_rejected') OR human_status IS NULL),
    human_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Composite index for efficient filtered queries by document ordered by recency
CREATE INDEX idx_accuracy_tests_document_created
    ON accuracy_tests (document_id, created_at DESC);
