import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  HistoryItem,
  MemoryInspectorItem,
  RetrievedContext,
  RetrievedMemory,
  RetrievedOpenLoop,
  RetrievedOpinion,
  TurnPerformanceMetrics,
} from '../../shared/protocol/index.js';
import type { CognitiveDecision, TurnConsolidation } from '../../shared/schemas/cognition.js';
import { migration001 } from './migrations/001Initial.js';

type MessageRecord = { id: string; role: 'user' | 'assistant'; content: string; createdAt: string };

export type ConsolidationResult = {
  createdMemoryIds: string[];
  updatedOpinionId: string | null;
  openLoopIds: string[];
};

export class MemoryRepository {
  private readonly db: Database.Database;
  readonly conversationId: string;
  readonly ftsAvailable: boolean;

  constructor(databasePath: string) {
    if (databasePath !== ':memory:') fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new Database(databasePath);
    this.db.pragma('foreign_keys = ON');
    if (databasePath !== ':memory:') this.db.pragma('journal_mode = WAL');
    this.migrate();
    this.ftsAvailable = this.initializeFts();
    this.conversationId = randomUUID();
    this.db.prepare('INSERT INTO conversations (id, started_at, status) VALUES (?, ?, ?)').run(
      this.conversationId,
      now(),
      'active',
    );
  }

  close(): void {
    this.db.prepare('UPDATE conversations SET ended_at = ?, status = ? WHERE id = ?').run(
      now(),
      'closed',
      this.conversationId,
    );
    this.db.close();
  }

  addMessage(input: {
    turnId: string;
    role: 'user' | 'assistant';
    content: string;
    source: 'typed' | 'ollama_stream' | 'initiative';
    interrupted?: boolean;
  }): string {
    const id = randomUUID();
    const createdAt = now();
    this.db
      .prepare(
        `INSERT INTO messages (id, conversation_id, turn_id, role, content, source, interrupted, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, this.conversationId, input.turnId, input.role, input.content, input.source, input.interrupted ? 1 : 0, createdAt);
    if (this.ftsAvailable) this.db.prepare('INSERT INTO messages_fts (id, content) VALUES (?, ?)').run(id, input.content);
    return id;
  }

  storeDecision(turnId: string, decision: CognitiveDecision): void {
    this.db
      .prepare(
        'INSERT INTO cognitive_decisions (id, conversation_id, turn_id, decision_json, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(randomUUID(), this.conversationId, turnId, JSON.stringify(decision), now());
  }

  storeMetrics(turnId: string, metrics: TurnPerformanceMetrics, status: string): void {
    const timestamp = now();
    this.db
      .prepare(
        `INSERT INTO turn_metrics (turn_id, conversation_id, metrics_json, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(turn_id) DO UPDATE SET metrics_json=excluded.metrics_json, status=excluded.status, updated_at=excluded.updated_at`,
      )
      .run(turnId, this.conversationId, JSON.stringify(metrics), status, timestamp, timestamp);
  }

  retrieveContext(query: string, characterBudget = 12000): RetrievedContext {
    const recentMessages = this.db
      .prepare(
        `SELECT id, role, content, created_at AS createdAt FROM messages
         WHERE interrupted = 0 ORDER BY created_at DESC LIMIT 14`,
      )
      .all() as MessageRecord[];
    recentMessages.reverse();

    const memories = this.searchMemories(query).slice(0, 8);
    const opinions = this.searchOpinions(query).slice(0, 5);
    const openLoops = this.searchOpenLoops(query).slice(0, 5);
    return trimContext({ recentMessages, memories, opinions, openLoops }, characterBudget);
  }

  getOpenLoops(limit = 8, cooldownMinutes = 10): RetrievedOpenLoop[] {
    const eligibleBefore = new Date(Date.now() - cooldownMinutes * 60_000).toISOString();
    return (this.db
      .prepare(
        `SELECT id, topic, description, importance, updated_at AS updatedAt
         FROM open_loops WHERE status = 'open' AND (last_initiative_at IS NULL OR last_initiative_at <= ?)
         ORDER BY initiative_attempts ASC, importance DESC, updated_at DESC LIMIT ?`,
      )
      .all(eligibleBefore, limit) as RetrievedOpenLoop[]);
  }

  markInitiativeAttempt(openLoopId: string): void {
    this.db
      .prepare(
        `UPDATE open_loops SET initiative_attempts = initiative_attempts + 1,
         last_initiative_at = ?, updated_at = ? WHERE id = ? AND status = 'open'`,
      )
      .run(now(), now(), openLoopId);
  }

  applyConsolidation(consolidation: TurnConsolidation, validMessageIds: string[]): ConsolidationResult {
    const valid = new Set(validMessageIds);
    const result: ConsolidationResult = { createdMemoryIds: [], updatedOpinionId: null, openLoopIds: [] };
    const transaction = this.db.transaction(() => {
      for (const candidate of consolidation.memoriesToCreate) {
        if (!candidate.evidenceMessageIds.every((id) => valid.has(id))) continue;
        const duplicate = this.findDuplicateMemory(candidate.content);
        if (duplicate) {
          this.updateMemory(duplicate.id, candidate, 'deduplicated');
          continue;
        }
        const id = randomUUID();
        const timestamp = now();
        this.db
          .prepare(
            `INSERT INTO memories
             (id, conversation_id, content, type, source, source_message_ids, confidence, importance, history_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            id,
            this.conversationId,
            candidate.content,
            candidate.type,
            'turn_consolidation',
            JSON.stringify(candidate.evidenceMessageIds),
            candidate.confidence,
            candidate.importance,
            JSON.stringify([{ at: timestamp, action: 'created', evidenceMessageIds: candidate.evidenceMessageIds }]),
            timestamp,
            timestamp,
          );
        if (this.ftsAvailable) this.db.prepare('INSERT INTO memories_fts (id, content) VALUES (?, ?)').run(id, candidate.content);
        result.createdMemoryIds.push(id);
      }

      for (const update of consolidation.memoriesToUpdate) {
        if (!update.evidenceMessageIds.every((id) => valid.has(id))) continue;
        const existing = this.db.prepare('SELECT id FROM memories WHERE id = ?').get(update.id) as { id: string } | undefined;
        if (existing) this.updateMemory(update.id, update, 'model_update');
      }

      if (consolidation.opinionUpdate?.evidenceMessageIds.every((id) => valid.has(id))) {
        result.updatedOpinionId = this.upsertOpinion(consolidation.opinionUpdate);
      }

      for (const loop of consolidation.openLoopsToCreate) {
        if (!loop.evidenceMessageIds.every((id) => valid.has(id))) continue;
        const duplicate = this.db
          .prepare("SELECT id FROM open_loops WHERE status = 'open' AND lower(topic) = lower(?)")
          .get(loop.topic) as { id: string } | undefined;
        if (duplicate) continue;
        const id = randomUUID();
        const timestamp = now();
        this.db
          .prepare(
            `INSERT INTO open_loops
             (id, conversation_id, topic, description, importance, source_message_ids, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(id, this.conversationId, loop.topic, loop.description, loop.importance, JSON.stringify(loop.evidenceMessageIds), timestamp, timestamp);
        result.openLoopIds.push(id);
      }

      for (const id of consolidation.openLoopsToResolve) {
        this.db
          .prepare("UPDATE open_loops SET status = 'resolved', updated_at = ? WHERE id = ? AND status = 'open'")
          .run(now(), id);
      }
    });
    transaction();
    return result;
  }

  listMemories(): MemoryInspectorItem[] {
    const rows = this.db
      .prepare(
        `SELECT id, content, type, confidence, importance, source_message_ids AS sourceMessageIds,
         created_at AS createdAt, updated_at AS updatedAt FROM memories ORDER BY updated_at DESC`,
      )
      .all() as Array<Omit<MemoryInspectorItem, 'sourceMessageIds'> & { sourceMessageIds: string }>;
    return rows.map((row) => ({ ...row, sourceMessageIds: parseStringArray(row.sourceMessageIds) }));
  }

  deleteMemory(id: string): boolean {
    const deleted = this.db.prepare('DELETE FROM memories WHERE id = ?').run(id).changes > 0;
    if (deleted && this.ftsAvailable) this.db.prepare('DELETE FROM memories_fts WHERE id = ?').run(id);
    return deleted;
  }

  getHistory(limit = 60): HistoryItem[] {
    const rows = this.db
      .prepare(
        `SELECT id, role, content, created_at AS createdAt, interrupted FROM messages
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(limit) as Array<{ id: string; role: 'user' | 'assistant'; content: string; createdAt: string; interrupted: number }>;
    return rows.reverse().map((row) =>
      row.role === 'user'
        ? { id: row.id, kind: 'user', text: row.content, createdAt: row.createdAt }
        : { id: row.id, kind: 'lumia', createdAt: row.createdAt, interrupted: Boolean(row.interrupted) },
    );
  }

  private migrate(): void {
    this.db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
    const applied = this.db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(migration001.version);
    if (!applied) {
      const apply = this.db.transaction(() => {
        this.db.exec(migration001.sql);
        this.db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
          migration001.version,
          migration001.name,
          now(),
        );
      });
      apply();
    }
  }

  private initializeFts(): boolean {
    try {
      this.db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(id UNINDEXED, content)');
      this.db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(id UNINDEXED, content)');
      return true;
    } catch {
      return false;
    }
  }

  private searchMemories(query: string): RetrievedMemory[] {
    const rows = this.queryTextTable(
      'memories',
      'memories_fts',
      query,
      `SELECT id, content, type, confidence, importance, updated_at AS updatedAt FROM memories`,
    ) as RetrievedMemory[];
    return rankByQuality(rows, query, (row) => row.content, (row) => row.importance, (row) => row.confidence, (row) => row.updatedAt);
  }

  private searchOpinions(query: string): RetrievedOpinion[] {
    const tokens = searchTokens(query);
    const where = tokens.length ? ` AND (${tokens.map(() => '(lower(topic) LIKE ? OR lower(position) LIKE ?)').join(' OR ')})` : '';
    const params = tokens.flatMap((token) => [`%${token}%`, `%${token}%`]);
    const rows = this.db
      .prepare(
        `SELECT id, topic, position, reason, confidence, updated_at AS updatedAt FROM opinions
         WHERE current = 1${where} ORDER BY updated_at DESC LIMIT 30`,
      )
      .all(...params) as RetrievedOpinion[];
    return rankByQuality(rows, query, (row) => `${row.topic} ${row.position}`, () => 0.8, (row) => row.confidence, (row) => row.updatedAt);
  }

  private searchOpenLoops(query: string): RetrievedOpenLoop[] {
    const tokens = searchTokens(query);
    const where = tokens.length ? ` AND (${tokens.map(() => '(lower(topic) LIKE ? OR lower(description) LIKE ?)').join(' OR ')})` : '';
    const params = tokens.flatMap((token) => [`%${token}%`, `%${token}%`]);
    return this.db
      .prepare(
        `SELECT id, topic, description, importance, updated_at AS updatedAt FROM open_loops
         WHERE status = 'open'${where} ORDER BY importance DESC, updated_at DESC LIMIT 20`,
      )
      .all(...params) as RetrievedOpenLoop[];
  }

  private queryTextTable(table: string, ftsTable: string, query: string, selectSql: string): unknown[] {
    const tokens = searchTokens(query);
    if (!tokens.length) return this.db.prepare(`${selectSql} ORDER BY updated_at DESC LIMIT 30`).all();
    if (this.ftsAvailable) {
      try {
        const match = tokens.map((token) => `"${token.replace(/"/g, '""')}"`).join(' OR ');
        return this.db
          .prepare(`${selectSql} WHERE id IN (SELECT id FROM ${ftsTable} WHERE ${ftsTable} MATCH ?) LIMIT 30`)
          .all(match);
      } catch {
        // Fallback LIKE below handles FTS query syntax or availability problems.
      }
    }
    const where = tokens.map(() => 'lower(content) LIKE ?').join(' OR ');
    return this.db.prepare(`${selectSql} WHERE ${where} ORDER BY updated_at DESC LIMIT 30`).all(...tokens.map((token) => `%${token}%`));
  }

  private findDuplicateMemory(content: string): { id: string } | undefined {
    const candidates = this.db.prepare('SELECT id, content FROM memories ORDER BY updated_at DESC LIMIT 100').all() as Array<{
      id: string;
      content: string;
    }>;
    return candidates.find((candidate) => similarity(candidate.content, content) >= 0.86);
  }

  private updateMemory(
    id: string,
    update: Partial<TurnConsolidation['memoriesToCreate'][number]> & { evidenceMessageIds: string[] },
    action: string,
  ): void {
    const existing = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!existing) return;
    const history = parseHistory(existing.history_json);
    history.push({ at: now(), action, previousContent: existing.content, evidenceMessageIds: update.evidenceMessageIds });
    const content = update.content ?? String(existing.content);
    this.db
      .prepare(
        `UPDATE memories SET content = ?, type = ?, confidence = ?, importance = ?, source_message_ids = ?,
         history_json = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        content,
        update.type ?? existing.type,
        update.confidence ?? existing.confidence,
        update.importance ?? existing.importance,
        JSON.stringify(update.evidenceMessageIds),
        JSON.stringify(history),
        now(),
        id,
      );
    if (this.ftsAvailable) {
      this.db.prepare('DELETE FROM memories_fts WHERE id = ?').run(id);
      this.db.prepare('INSERT INTO memories_fts (id, content) VALUES (?, ?)').run(id, content);
    }
  }

  private upsertOpinion(candidate: NonNullable<TurnConsolidation['opinionUpdate']>): string {
    const existing = candidate.previousOpinionId
      ? (this.db.prepare('SELECT * FROM opinions WHERE id = ? AND current = 1').get(candidate.previousOpinionId) as Record<string, unknown> | undefined)
      : (this.db
          .prepare('SELECT * FROM opinions WHERE current = 1 AND lower(topic) = lower(?) ORDER BY updated_at DESC LIMIT 1')
          .get(candidate.topic) as Record<string, unknown> | undefined);
    const timestamp = now();
    if (existing) {
      if (String(existing.position) !== candidate.position) {
        this.db
          .prepare(
            `INSERT INTO opinion_revisions
             (id, opinion_id, previous_position, previous_reason, previous_confidence, change_reason, source_message_ids, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            randomUUID(),
            existing.id,
            existing.position,
            existing.reason,
            existing.confidence,
            candidate.reason,
            JSON.stringify(candidate.evidenceMessageIds),
            timestamp,
          );
      }
      this.db
        .prepare(
          `UPDATE opinions SET topic=?, position=?, reason=?, confidence=?, source_message_ids=?, updated_at=? WHERE id=?`,
        )
        .run(candidate.topic, candidate.position, candidate.reason, candidate.confidence, JSON.stringify(candidate.evidenceMessageIds), timestamp, existing.id);
      return String(existing.id);
    }
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO opinions
         (id, conversation_id, topic, position, reason, confidence, source_message_ids, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, this.conversationId, candidate.topic, candidate.position, candidate.reason, candidate.confidence, JSON.stringify(candidate.evidenceMessageIds), timestamp, timestamp);
    return id;
  }
}

function now(): string {
  return new Date().toISOString();
}

function searchTokens(value: string): string[] {
  return [...new Set(value.toLocaleLowerCase('pt-BR').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').match(/[a-z0-9]{3,}/g) ?? [])].slice(0, 12);
}

function normalizedWords(value: string): Set<string> {
  return new Set(searchTokens(value));
}

function similarity(a: string, b: string): number {
  const left = normalizedWords(a);
  const right = normalizedWords(b);
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const item of left) if (right.has(item)) overlap += 1;
  return overlap / (left.size + right.size - overlap);
}

function rankByQuality<T>(
  rows: T[],
  query: string,
  text: (row: T) => string,
  importance: (row: T) => number,
  confidence: (row: T) => number,
  updatedAt: (row: T) => string,
): T[] {
  const queryWords = normalizedWords(query);
  return rows
    .map((row) => {
      const words = normalizedWords(text(row));
      let matches = 0;
      for (const word of queryWords) if (words.has(word)) matches += 1;
      const relevance = queryWords.size ? matches / queryWords.size : 0.2;
      const ageDays = Math.max(0, (Date.now() - Date.parse(updatedAt(row))) / 86_400_000);
      const recency = 1 / (1 + ageDays / 30);
      return { row, score: relevance * 0.5 + importance(row) * 0.2 + confidence(row) * 0.2 + recency * 0.1 };
    })
    .sort((a, b) => b.score - a.score)
    .map(({ row }) => row);
}

function trimContext(context: RetrievedContext, budget: number): RetrievedContext {
  let used = 0;
  const take = <T>(items: T[], render: (item: T) => string): T[] => {
    const kept: T[] = [];
    for (const item of items) {
      const length = render(item).length;
      if (used + length > budget) break;
      used += length;
      kept.push(item);
    }
    return kept;
  };
  const memories = take(context.memories, (item) => item.content);
  const opinions = take(context.opinions, (item) => `${item.topic}${item.position}${item.reason}`);
  const openLoops = take(context.openLoops, (item) => `${item.topic}${item.description}`);
  const recentMessages = take([...context.recentMessages].reverse(), (item) => item.content).reverse();
  return { recentMessages, memories, opinions, openLoops };
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function parseHistory(value: unknown): Array<Record<string, unknown>> {
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as Array<Record<string, unknown>>) : [];
  } catch {
    return [];
  }
}
