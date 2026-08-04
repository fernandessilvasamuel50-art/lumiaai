export const migration001 = {
  version: 1,
  name: 'cognitive_core_initial',
  sql: `
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id),
      turn_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      source TEXT NOT NULL,
      interrupted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS messages_conversation_created ON messages(conversation_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS messages_turn ON messages(turn_id);

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id),
      content TEXT NOT NULL,
      type TEXT NOT NULL,
      source TEXT NOT NULL,
      source_message_ids TEXT NOT NULL,
      confidence REAL NOT NULL,
      importance REAL NOT NULL,
      history_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS memories_updated ON memories(updated_at DESC);

    CREATE TABLE IF NOT EXISTS opinions (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id),
      topic TEXT NOT NULL,
      position TEXT NOT NULL,
      reason TEXT NOT NULL,
      confidence REAL NOT NULL,
      source_message_ids TEXT NOT NULL,
      current INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS opinions_topic_current ON opinions(topic, current);

    CREATE TABLE IF NOT EXISTS opinion_revisions (
      id TEXT PRIMARY KEY,
      opinion_id TEXT NOT NULL REFERENCES opinions(id),
      previous_position TEXT NOT NULL,
      previous_reason TEXT NOT NULL,
      previous_confidence REAL NOT NULL,
      change_reason TEXT NOT NULL,
      source_message_ids TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS open_loops (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id),
      topic TEXT NOT NULL,
      description TEXT NOT NULL,
      importance REAL NOT NULL,
      source_message_ids TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      initiative_attempts INTEGER NOT NULL DEFAULT 0,
      last_initiative_at TEXT,
      resolution_message_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS open_loops_status_updated ON open_loops(status, updated_at DESC);

    CREATE TABLE IF NOT EXISTS cognitive_decisions (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id),
      turn_id TEXT NOT NULL,
      decision_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS turn_metrics (
      turn_id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id),
      metrics_json TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `,
} as const;
