export const migration002 = {
  version: 2,
  name: 'cognitive_os_generalist',
  sql: `
    ALTER TABLE memories ADD COLUMN status TEXT NOT NULL DEFAULT 'active';

    CREATE TABLE IF NOT EXISTS memory_revisions (
      id TEXT PRIMARY KEY,
      memory_id TEXT NOT NULL REFERENCES memories(id),
      action TEXT NOT NULL,
      previous_content TEXT,
      new_content TEXT,
      reason TEXT NOT NULL,
      evidence_message_ids TEXT NOT NULL,
      actor TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS memory_revisions_memory_created ON memory_revisions(memory_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS interaction_lessons (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      scope_key TEXT,
      lesson TEXT NOT NULL,
      evidence_message_ids TEXT NOT NULL,
      confidence REAL NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      revision_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS interaction_lessons_active_updated ON interaction_lessons(active, updated_at DESC);

    CREATE TABLE IF NOT EXISTS self_model (
      id TEXT PRIMARY KEY CHECK(id = 'lumia'),
      profile_json TEXT NOT NULL,
      relationship_context_json TEXT NOT NULL,
      revision INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS self_model_revisions (
      id TEXT PRIMARY KEY,
      trait TEXT NOT NULL,
      previous_value REAL NOT NULL,
      new_value REAL NOT NULL,
      reason TEXT NOT NULL,
      confidence REAL NOT NULL,
      evidence_message_ids TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cognitive_frames (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id),
      turn_id TEXT NOT NULL,
      frame_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS response_reviews (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id),
      turn_id TEXT NOT NULL,
      review_json TEXT NOT NULL,
      revised INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS turn_consolidations (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id),
      turn_id TEXT NOT NULL,
      consolidation_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `,
} as const;
