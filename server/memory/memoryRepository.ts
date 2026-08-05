import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  ConsolidationSummary,
  HistoryItem,
  InteractionLesson,
  LumiaSelfModel,
  MemoryInspectorItem,
  RetrievedContext,
  RetrievedKnowledge,
  RetrievedOpenLoop,
  RetrievedOpinion,
  TurnPerformanceMetrics,
} from '../../shared/protocol/index.js';
import type {
  CognitiveDecision,
  CognitiveFrame,
  MemoryType,
  ResponseReview,
  TurnConsolidation,
} from '../../shared/schemas/cognition.js';
import { migration001 } from './migrations/001Initial.js';
import { migration002 } from './migrations/002CognitiveOs.js';
import { ContradictionResolver } from './contradictionResolver.js';

type MessageRecord = { id: string; role: 'user' | 'assistant'; content: string; createdAt: string };
type RetrievalOptions = {
  characterBudget?: number;
  depth?: 'minimal' | 'normal' | 'deep';
  desiredTypes?: MemoryType[];
  topic?: string | null;
  relationshipRelevant?: boolean;
};

const NEUTRAL_PROFILE: LumiaSelfModel['communicationProfile'] = {
  preferredVerbosity: 0.5,
  warmth: 0.5,
  directness: 0.5,
  humor: 0.5,
  playfulness: 0.5,
  willingnessToChallenge: 0.5,
};

export class MemoryRepository {
  private readonly db: Database.Database;
  private readonly contradictionResolver = new ContradictionResolver();
  readonly conversationId: string;
  readonly ftsAvailable: boolean;

  constructor(databasePath: string) {
    if (databasePath !== ':memory:') fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new Database(databasePath);
    this.db.pragma('foreign_keys = ON');
    if (databasePath !== ':memory:') this.db.pragma('journal_mode = WAL');
    this.migrate();
    this.initializeSelfModel();
    this.ftsAvailable = this.initializeFts();
    this.conversationId = randomUUID();
    this.db.prepare('INSERT INTO conversations (id, started_at, status) VALUES (?, ?, ?)').run(this.conversationId, now(), 'active');
  }

  close(): void {
    this.db.prepare('UPDATE conversations SET ended_at = ?, status = ? WHERE id = ?').run(now(), 'closed', this.conversationId);
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
    this.db.prepare(
      `INSERT INTO messages (id, conversation_id, turn_id, role, content, source, interrupted, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, this.conversationId, input.turnId, input.role, input.content, input.source, input.interrupted ? 1 : 0, now());
    if (this.ftsAvailable) this.db.prepare('INSERT INTO messages_fts (id, content) VALUES (?, ?)').run(id, input.content);
    return id;
  }

  getRecentMessages(limit = 14): RetrievedContext['recentMessages'] {
    const rows = this.db.prepare(
      `SELECT id, role, content, created_at AS createdAt FROM messages
       WHERE interrupted = 0 ORDER BY created_at DESC LIMIT ?`,
    ).all(limit) as MessageRecord[];
    return rows.reverse();
  }

  storeFrame(turnId: string, frame: CognitiveFrame): void {
    this.db.prepare(
      'INSERT INTO cognitive_frames (id, conversation_id, turn_id, frame_json, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(randomUUID(), this.conversationId, turnId, JSON.stringify(frame), now());
  }

  storeDecision(turnId: string, decision: CognitiveDecision): void {
    this.db.prepare(
      'INSERT INTO cognitive_decisions (id, conversation_id, turn_id, decision_json, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(randomUUID(), this.conversationId, turnId, JSON.stringify(decision), now());
  }

  storeReview(turnId: string, review: ResponseReview, revised: boolean): void {
    this.db.prepare(
      'INSERT INTO response_reviews (id, conversation_id, turn_id, review_json, revised, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(randomUUID(), this.conversationId, turnId, JSON.stringify(review), revised ? 1 : 0, now());
  }

  storeConsolidation(turnId: string, consolidation: TurnConsolidation): void {
    this.db.prepare(
      'INSERT INTO turn_consolidations (id, conversation_id, turn_id, consolidation_json, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(randomUUID(), this.conversationId, turnId, JSON.stringify(consolidation), now());
  }

  storeMetrics(turnId: string, metrics: TurnPerformanceMetrics, status: string): void {
    const timestamp = now();
    this.db.prepare(
      `INSERT INTO turn_metrics (turn_id, conversation_id, metrics_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(turn_id) DO UPDATE SET metrics_json=excluded.metrics_json, status=excluded.status, updated_at=excluded.updated_at`,
    ).run(turnId, this.conversationId, JSON.stringify(metrics), status, timestamp, timestamp);
  }

  retrieveContext(query: string, options: number | RetrievalOptions = {}): RetrievedContext {
    const normalized = typeof options === 'number' ? { characterBudget: options } : options;
    const depth = normalized.depth ?? 'normal';
    const limits = depth === 'minimal'
      ? { recent: 6, memories: 4, opinions: 2, loops: 2, lessons: 3 }
      : depth === 'deep'
        ? { recent: 24, memories: 14, opinions: 8, loops: 8, lessons: 10 }
        : { recent: 14, memories: 8, opinions: 5, loops: 5, lessons: 6 };
    const recentMessages = this.getRecentMessages(limits.recent);
    const memories = this.searchMemories(query, normalized.desiredTypes).slice(0, limits.memories);
    const opinions = this.searchOpinions(query).slice(0, limits.opinions);
    const openLoops = this.searchOpenLoops(query).slice(0, limits.loops);
    const lessons = this.searchLessons(query, normalized.topic, normalized.relationshipRelevant).slice(0, limits.lessons);
    return trimContext(
      { recentMessages, memories, opinions, openLoops, lessons },
      normalized.characterBudget ?? 12000,
    );
  }

  getSelfModel(): LumiaSelfModel {
    const row = this.db.prepare('SELECT profile_json, relationship_context_json, revision, updated_at FROM self_model WHERE id = ?').get('lumia') as {
      profile_json: string;
      relationship_context_json: string;
      revision: number;
      updated_at: string;
    };
    const profile = parseObject(row.profile_json) as Partial<LumiaSelfModel['communicationProfile']>;
    const learnedPreferenceIds = (this.db.prepare("SELECT id FROM memories WHERE status = 'active' AND type = 'procedural' ORDER BY updated_at DESC LIMIT 30").all() as Array<{ id: string }>).map((item) => item.id);
    const stableOpinionIds = (this.db.prepare('SELECT id FROM opinions WHERE current = 1 AND confidence >= 0.7 ORDER BY updated_at DESC LIMIT 30').all() as Array<{ id: string }>).map((item) => item.id);
    const interactionLessonIds = (this.db.prepare('SELECT id FROM interaction_lessons WHERE active = 1 ORDER BY updated_at DESC LIMIT 30').all() as Array<{ id: string }>).map((item) => item.id);
    return {
      communicationProfile: { ...NEUTRAL_PROFILE, ...profile },
      learnedPreferenceIds,
      stableOpinionIds,
      interactionLessonIds,
      relationshipContext: parseObject(row.relationship_context_json),
      revision: row.revision,
      updatedAt: row.updated_at,
    };
  }

  getOpenLoops(limit = 8, cooldownMinutes = 10): RetrievedOpenLoop[] {
    const eligibleBefore = new Date(Date.now() - cooldownMinutes * 60_000).toISOString();
    const rows = this.db.prepare(
      `SELECT id, topic, description, importance, source_message_ids AS sourceMessageIds,
       created_at AS createdAt, updated_at AS updatedAt
       FROM open_loops WHERE status = 'open' AND (last_initiative_at IS NULL OR last_initiative_at <= ?)
       ORDER BY initiative_attempts ASC, importance DESC, updated_at DESC LIMIT ?`,
    ).all(eligibleBefore, limit) as Array<Omit<RetrievedOpenLoop, 'sourceMessageIds' | 'relevanceScore'> & { sourceMessageIds: string }>;
    return rows.map((row) => ({ ...row, sourceMessageIds: parseStringArray(row.sourceMessageIds), relevanceScore: 1 }));
  }

  markInitiativeAttempt(openLoopId: string): void {
    const timestamp = now();
    this.db.prepare(
      `UPDATE open_loops SET initiative_attempts = initiative_attempts + 1,
       last_initiative_at = ?, updated_at = ? WHERE id = ? AND status = 'open'`,
    ).run(timestamp, timestamp, openLoopId);
  }

  applyConsolidation(consolidation: TurnConsolidation, validMessageIds: string[]): ConsolidationSummary {
    const valid = new Set(validMessageIds);
    const summary: ConsolidationSummary = {
      createdMemoryIds: [],
      revisedMemoryIds: [],
      opinionIds: [],
      lessonIds: [],
      openLoopIds: [],
      selfModelRevision: null,
    };
    this.db.transaction(() => {
      for (const candidate of consolidation.memoriesToCreate) {
        if (!validEvidence(candidate.evidenceMessageIds, valid)) continue;
        const duplicate = this.findDuplicateMemory(candidate.content);
        if (duplicate) {
          this.reviseMemoryFromModel(duplicate.id, { ...candidate, id: duplicate.id, contradictionKind: 'update', reason: 'Conteúdo semanticamente duplicado consolidado.' });
          summary.revisedMemoryIds.push(duplicate.id);
          continue;
        }
        const id = this.createMemory(candidate);
        summary.createdMemoryIds.push(id);
      }
      for (const revision of consolidation.memoriesToRevise) {
        if (!validEvidence(revision.evidenceMessageIds, valid)) continue;
        if (this.reviseMemoryFromModel(revision.id, revision)) summary.revisedMemoryIds.push(revision.id);
      }
      for (const opinion of consolidation.opinionsToCreate) {
        if (!validEvidence(opinion.evidenceMessageIds, valid)) continue;
        summary.opinionIds.push(this.upsertOpinion(opinion));
      }
      for (const opinion of consolidation.opinionsToRevise) {
        if (!validEvidence(opinion.evidenceMessageIds, valid)) continue;
        const id = this.reviseOpinion(opinion);
        if (id) summary.opinionIds.push(id);
      }
      for (const lesson of consolidation.lessonsToCreate) {
        if (!validEvidence(lesson.evidenceMessageIds, valid) || !lessonEvidenceIsSufficient(lesson)) continue;
        summary.lessonIds.push(this.createLesson(lesson));
      }
      for (const lesson of consolidation.lessonsToRevise) {
        if (!validEvidence(lesson.evidenceMessageIds, valid) || !lessonEvidenceIsSufficient(lesson)) continue;
        if (this.reviseLesson(lesson)) summary.lessonIds.push(lesson.id);
      }
      for (const loop of consolidation.openLoopsToCreate) {
        if (!validEvidence(loop.evidenceMessageIds, valid)) continue;
        const duplicate = this.db.prepare("SELECT id FROM open_loops WHERE status = 'open' AND lower(topic) = lower(?)").get(loop.topic) as { id: string } | undefined;
        if (duplicate) continue;
        const id = randomUUID();
        const timestamp = now();
        this.db.prepare(
          `INSERT INTO open_loops (id, conversation_id, topic, description, importance, source_message_ids, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(id, this.conversationId, loop.topic, loop.description, loop.importance, JSON.stringify(loop.evidenceMessageIds), timestamp, timestamp);
        summary.openLoopIds.push(id);
      }
      for (const id of consolidation.openLoopsToResolve) {
        this.db.prepare("UPDATE open_loops SET status = 'resolved', updated_at = ? WHERE id = ? AND status = 'open'").run(now(), id);
      }
      const revision = this.applySelfModelUpdate(consolidation.selfModelUpdate, valid);
      if (revision !== null) summary.selfModelRevision = revision;
    })();
    return deduplicateSummary(summary);
  }

  listMemories(query = '', memoryType?: string): MemoryInspectorItem[] {
    const tokens = searchTokens(query);
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (memoryType) {
      clauses.push('type = ?');
      params.push(memoryType);
    }
    if (tokens.length) {
      clauses.push(`(${tokens.map(() => 'lower(content) LIKE ?').join(' OR ')})`);
      params.push(...tokens.map((token) => `%${token}%`));
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db.prepare(
      `SELECT id, content, type, confidence, importance, source, source_message_ids AS sourceMessageIds,
       status, created_at AS createdAt, updated_at AS updatedAt FROM memories ${where} ORDER BY updated_at DESC LIMIT 200`,
    ).all(...params) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      content: String(row.content),
      type: normalizeMemoryType(String(row.type)),
      confidence: Number(row.confidence),
      importance: Number(row.importance),
      source: String(row.source),
      sourceMessageIds: parseStringArray(String(row.sourceMessageIds)),
      status: normalizeStatus(String(row.status)),
      createdAt: String(row.createdAt),
      updatedAt: String(row.updatedAt),
      history: this.getMemoryRevisions(String(row.id)),
    }));
  }

  reviseMemoryManually(id: string, content: string, reason: string): boolean {
    const existing = this.getMemoryRow(id);
    if (!existing) return false;
    const timestamp = now();
    this.insertMemoryRevision(id, 'manual_correction', existing.content, content, reason, parseStringArray(existing.source_message_ids), 'manual_inspector');
    this.db.prepare("UPDATE memories SET content = ?, status = 'active', updated_at = ? WHERE id = ?").run(content, timestamp, id);
    this.refreshMemoryFts(id, content);
    return true;
  }

  markMemoryUncertain(id: string, reason: string): boolean {
    const existing = this.getMemoryRow(id);
    if (!existing) return false;
    this.insertMemoryRevision(id, 'manual_uncertain', existing.content, existing.content, reason, parseStringArray(existing.source_message_ids), 'manual_inspector');
    this.db.prepare("UPDATE memories SET status = 'uncertain', confidence = MIN(confidence, 0.5), updated_at = ? WHERE id = ?").run(now(), id);
    return true;
  }

  deleteMemory(id: string, reason = 'Exclusão consciente pelo inspetor.'): boolean {
    const existing = this.getMemoryRow(id);
    if (!existing) return false;
    this.insertMemoryRevision(id, 'manual_delete', existing.content, null, reason, parseStringArray(existing.source_message_ids), 'manual_inspector');
    this.db.prepare("UPDATE memories SET status = 'superseded', updated_at = ? WHERE id = ?").run(now(), id);
    if (this.ftsAvailable) this.db.prepare('DELETE FROM memories_fts WHERE id = ?').run(id);
    return true;
  }

  getHistory(limit = 60): HistoryItem[] {
    const rows = this.db.prepare(
      `SELECT id, role, content, created_at AS createdAt, interrupted FROM messages
       ORDER BY created_at DESC LIMIT ?`,
    ).all(limit) as Array<{ id: string; role: 'user' | 'assistant'; content: string; createdAt: string; interrupted: number }>;
    return rows.reverse().map((row) => row.role === 'user'
      ? { id: row.id, kind: 'user', text: row.content, createdAt: row.createdAt }
      : { id: row.id, kind: 'lumia', createdAt: row.createdAt, interrupted: Boolean(row.interrupted) });
  }

  private migrate(): void {
    this.db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
    for (const migration of [migration001, migration002]) {
      const applied = this.db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(migration.version);
      if (applied) continue;
      this.db.transaction(() => {
        this.db.exec(migration.sql);
        this.db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(migration.version, migration.name, now());
      })();
    }
  }

  private initializeSelfModel(): void {
    this.db.prepare(
      `INSERT OR IGNORE INTO self_model (id, profile_json, relationship_context_json, revision, updated_at)
       VALUES ('lumia', ?, '{}', 0, ?)`,
    ).run(JSON.stringify(NEUTRAL_PROFILE), now());
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

  private searchMemories(query: string, desiredTypes?: MemoryType[]): RetrievedKnowledge[] {
    const rows = this.queryTextTable(
      'memories_fts',
      query,
      `SELECT id, content, type, source_message_ids AS sourceMessageIds, confidence, importance,
       status, created_at AS createdAt, updated_at AS updatedAt FROM memories WHERE status IN ('active', 'uncertain')`,
    ) as Array<Record<string, unknown>>;
    return rankRows(rows, query, (row) => String(row.content), (row) => Number(row.importance), (row) => Number(row.confidence), (row) => String(row.updatedAt))
      .map(({ row, score }) => ({
        id: String(row.id),
        type: normalizeMemoryType(String(row.type)),
        content: String(row.content),
        sourceMessageIds: parseStringArray(String(row.sourceMessageIds)),
        confidence: Number(row.confidence),
        importance: Number(row.importance),
        createdAt: String(row.createdAt),
        updatedAt: String(row.updatedAt),
        relevanceScore: desiredTypes?.includes(normalizeMemoryType(String(row.type))) ? Math.min(1, score + 0.1) : score,
        status: normalizeStatus(String(row.status)),
      }))
      .sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  private searchOpinions(query: string): RetrievedOpinion[] {
    const rows = this.db.prepare(
      `SELECT id, topic, position, reason, confidence, source_message_ids AS sourceMessageIds,
       created_at AS createdAt, updated_at AS updatedAt FROM opinions WHERE current = 1 ORDER BY updated_at DESC LIMIT 60`,
    ).all() as Array<Record<string, unknown>>;
    return rankRows(rows, query, (row) => `${row.topic} ${row.position}`, () => 0.8, (row) => Number(row.confidence), (row) => String(row.updatedAt))
      .map(({ row, score }) => ({
        id: String(row.id), topic: String(row.topic), position: String(row.position), reason: String(row.reason),
        confidence: Number(row.confidence), sourceMessageIds: parseStringArray(String(row.sourceMessageIds)),
        createdAt: String(row.createdAt), updatedAt: String(row.updatedAt), relevanceScore: score,
      }));
  }

  private searchOpenLoops(query: string): RetrievedOpenLoop[] {
    const rows = this.db.prepare(
      `SELECT id, topic, description, importance, source_message_ids AS sourceMessageIds,
       created_at AS createdAt, updated_at AS updatedAt FROM open_loops WHERE status = 'open' ORDER BY updated_at DESC LIMIT 60`,
    ).all() as Array<Record<string, unknown>>;
    return rankRows(rows, query, (row) => `${row.topic} ${row.description}`, (row) => Number(row.importance), () => 0.8, (row) => String(row.updatedAt))
      .map(({ row, score }) => ({
        id: String(row.id), topic: String(row.topic), description: String(row.description), importance: Number(row.importance),
        sourceMessageIds: parseStringArray(String(row.sourceMessageIds)), createdAt: String(row.createdAt),
        updatedAt: String(row.updatedAt), relevanceScore: score,
      }));
  }

  private searchLessons(query: string, topic?: string | null, relationshipRelevant?: boolean): InteractionLesson[] {
    const rows = this.db.prepare(
      `SELECT id, scope, scope_key AS scopeKey, lesson, evidence_message_ids AS evidenceMessageIds,
       confidence, active, revision_json AS revisionHistory, created_at AS createdAt, updated_at AS updatedAt
       FROM interaction_lessons WHERE active = 1 ORDER BY updated_at DESC LIMIT 80`,
    ).all() as Array<Record<string, unknown>>;
    const relatedQuery = `${query} ${topic ?? ''}`;
    return rankRows(rows, relatedQuery, (row) => `${row.scopeKey ?? ''} ${row.lesson}`, () => 0.7, (row) => Number(row.confidence), (row) => String(row.updatedAt))
      .map(({ row, score }) => ({
        id: String(row.id), scope: row.scope as InteractionLesson['scope'], scopeKey: row.scopeKey ? String(row.scopeKey) : null,
        lesson: String(row.lesson), evidenceMessageIds: parseStringArray(String(row.evidenceMessageIds)), confidence: Number(row.confidence),
        active: Boolean(row.active), revisionHistory: parseRecordArray(String(row.revisionHistory)), createdAt: String(row.createdAt),
        updatedAt: String(row.updatedAt), relevanceScore: row.scope === 'global' || (relationshipRelevant && row.scope === 'relationship') ? Math.min(1, score + 0.2) : score,
      }))
      .filter((lesson) => lesson.scope === 'global' || lesson.relevanceScore >= 0.25)
      .sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  private queryTextTable(ftsTable: string, query: string, selectSql: string): unknown[] {
    const tokens = searchTokens(query);
    if (!tokens.length) return this.db.prepare(`${selectSql} ORDER BY updated_at DESC LIMIT 80`).all();
    if (this.ftsAvailable) {
      try {
        const match = tokens.map((token) => `"${token.replace(/"/g, '""')}"`).join(' OR ');
        return this.db.prepare(`${selectSql} AND id IN (SELECT id FROM ${ftsTable} WHERE ${ftsTable} MATCH ?) LIMIT 80`).all(match);
      } catch {
        // A busca LIKE abaixo mantém a recuperação disponível quando FTS rejeita a consulta.
      }
    }
    const where = tokens.map(() => 'lower(content) LIKE ?').join(' OR ');
    return this.db.prepare(`${selectSql} AND (${where}) ORDER BY updated_at DESC LIMIT 80`).all(...tokens.map((token) => `%${token}%`));
  }

  private createMemory(candidate: TurnConsolidation['memoriesToCreate'][number]): string {
    const id = randomUUID();
    const timestamp = now();
    this.db.prepare(
      `INSERT INTO memories
       (id, conversation_id, content, type, source, source_message_ids, confidence, importance, history_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', 'active', ?, ?)`,
    ).run(id, this.conversationId, candidate.content, candidate.type, 'turn_consolidation', JSON.stringify(candidate.evidenceMessageIds), candidate.confidence, candidate.importance, timestamp, timestamp);
    this.insertMemoryRevision(id, 'created', null, candidate.content, 'Consolidação cognitiva com evidência.', candidate.evidenceMessageIds, 'cognitive_consolidation');
    this.refreshMemoryFts(id, candidate.content);
    return id;
  }

  private reviseMemoryFromModel(id: string, revision: TurnConsolidation['memoriesToRevise'][number]): boolean {
    const existing = this.getMemoryRow(id);
    if (!existing) return false;
    const resolution = this.contradictionResolver.resolve({ content: existing.content, confidence: existing.confidence }, revision);
    const evidence = uniqueStrings([...parseStringArray(existing.source_message_ids), ...revision.evidenceMessageIds]);
    this.insertMemoryRevision(id, resolution.action, existing.content, resolution.content, revision.reason, revision.evidenceMessageIds, 'cognitive_consolidation');
    this.db.prepare(
      `UPDATE memories SET content = ?, type = ?, confidence = ?, importance = ?, source_message_ids = ?, status = ?, updated_at = ? WHERE id = ?`,
    ).run(resolution.content, revision.type, resolution.confidence, revision.importance, JSON.stringify(evidence), resolution.status, now(), id);
    this.refreshMemoryFts(id, resolution.content);
    return true;
  }

  private findDuplicateMemory(content: string): { id: string } | undefined {
    const candidates = this.db.prepare("SELECT id, content FROM memories WHERE status != 'superseded' ORDER BY updated_at DESC LIMIT 150").all() as Array<{ id: string; content: string }>;
    return candidates.find((candidate) => similarity(candidate.content, content) >= 0.86);
  }

  private upsertOpinion(candidate: TurnConsolidation['opinionsToCreate'][number]): string {
    const existing = this.db.prepare('SELECT id FROM opinions WHERE current = 1 AND lower(topic) = lower(?) ORDER BY updated_at DESC LIMIT 1').get(candidate.topic) as { id: string } | undefined;
    if (existing) {
      return this.reviseOpinion({ ...candidate, id: existing.id, relation: 'refined', changeReason: candidate.reason }) ?? existing.id;
    }
    const id = randomUUID();
    const timestamp = now();
    this.db.prepare(
      `INSERT INTO opinions (id, conversation_id, topic, position, reason, confidence, source_message_ids, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, this.conversationId, candidate.topic, candidate.position, candidate.reason, candidate.confidence, JSON.stringify(candidate.evidenceMessageIds), timestamp, timestamp);
    return id;
  }

  private reviseOpinion(candidate: TurnConsolidation['opinionsToRevise'][number]): string | null {
    const existing = this.db.prepare('SELECT * FROM opinions WHERE id = ? AND current = 1').get(candidate.id) as Record<string, unknown> | undefined;
    if (!existing) return null;
    const timestamp = now();
    this.db.prepare(
      `INSERT INTO opinion_revisions
       (id, opinion_id, previous_position, previous_reason, previous_confidence, change_reason, source_message_ids, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(randomUUID(), candidate.id, existing.position, existing.reason, existing.confidence, candidate.changeReason, JSON.stringify(candidate.evidenceMessageIds), timestamp);
    const evidence = uniqueStrings([...parseStringArray(String(existing.source_message_ids)), ...candidate.evidenceMessageIds]);
    this.db.prepare(
      `UPDATE opinions SET topic = ?, position = ?, reason = ?, confidence = ?, source_message_ids = ?, updated_at = ? WHERE id = ?`,
    ).run(candidate.topic, candidate.position, candidate.reason, candidate.confidence, JSON.stringify(evidence), timestamp, candidate.id);
    return candidate.id;
  }

  private createLesson(candidate: TurnConsolidation['lessonsToCreate'][number]): string {
    const existing = this.db.prepare(
      `SELECT id FROM interaction_lessons WHERE active = 1 AND scope = ? AND ifnull(scope_key, '') = ifnull(?, '') AND lower(lesson) = lower(?)`,
    ).get(candidate.scope, candidate.scopeKey, candidate.lesson) as { id: string } | undefined;
    if (existing) return existing.id;
    const id = randomUUID();
    const timestamp = now();
    this.db.prepare(
      `INSERT INTO interaction_lessons
       (id, scope, scope_key, lesson, evidence_message_ids, confidence, active, revision_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, '[]', ?, ?)`,
    ).run(id, candidate.scope, candidate.scopeKey, candidate.lesson, JSON.stringify(candidate.evidenceMessageIds), candidate.confidence, timestamp, timestamp);
    return id;
  }

  private reviseLesson(candidate: TurnConsolidation['lessonsToRevise'][number]): boolean {
    const existing = this.db.prepare('SELECT * FROM interaction_lessons WHERE id = ?').get(candidate.id) as Record<string, unknown> | undefined;
    if (!existing) return false;
    const history = parseRecordArray(String(existing.revision_json));
    history.push({ at: now(), previousLesson: existing.lesson, reason: candidate.reason, evidenceMessageIds: candidate.evidenceMessageIds });
    const evidence = uniqueStrings([...parseStringArray(String(existing.evidence_message_ids)), ...candidate.evidenceMessageIds]);
    this.db.prepare(
      `UPDATE interaction_lessons SET scope = ?, scope_key = ?, lesson = ?, evidence_message_ids = ?, confidence = ?, active = ?, revision_json = ?, updated_at = ? WHERE id = ?`,
    ).run(candidate.scope, candidate.scopeKey, candidate.lesson, JSON.stringify(evidence), candidate.confidence, candidate.active ? 1 : 0, JSON.stringify(history), now(), candidate.id);
    return true;
  }

  private applySelfModelUpdate(update: TurnConsolidation['selfModelUpdate'], valid: Set<string>): number | null {
    if (!update?.traitUpdates.length) return null;
    const model = this.getSelfModel();
    let changed = false;
    for (const traitUpdate of update.traitUpdates) {
      if (!validEvidence(traitUpdate.evidenceMessageIds, valid) || !selfUpdateIsSufficient(traitUpdate)) continue;
      const previous = model.communicationProfile[traitUpdate.trait];
      const bounded = clamp(traitUpdate.value, previous - 0.15, previous + 0.15);
      if (Math.abs(previous - bounded) < 0.001) continue;
      model.communicationProfile[traitUpdate.trait] = bounded;
      this.db.prepare(
        `INSERT INTO self_model_revisions
         (id, trait, previous_value, new_value, reason, confidence, evidence_message_ids, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(randomUUID(), traitUpdate.trait, previous, bounded, traitUpdate.reason, traitUpdate.confidence, JSON.stringify(traitUpdate.evidenceMessageIds), now());
      changed = true;
    }
    if (!changed) return null;
    const revision = model.revision + 1;
    this.db.prepare('UPDATE self_model SET profile_json = ?, revision = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(model.communicationProfile), revision, now(), 'lumia');
    return revision;
  }

  private getMemoryRow(id: string): { content: string; confidence: number; source_message_ids: string } | undefined {
    return this.db.prepare('SELECT content, confidence, source_message_ids FROM memories WHERE id = ?').get(id) as { content: string; confidence: number; source_message_ids: string } | undefined;
  }

  private insertMemoryRevision(
    memoryId: string,
    action: string,
    previousContent: string | null,
    newContent: string | null,
    reason: string,
    evidenceMessageIds: string[],
    actor: 'cognitive_consolidation' | 'manual_inspector',
  ): void {
    this.db.prepare(
      `INSERT INTO memory_revisions
       (id, memory_id, action, previous_content, new_content, reason, evidence_message_ids, actor, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(randomUUID(), memoryId, action, previousContent, newContent, reason, JSON.stringify(evidenceMessageIds), actor, now());
  }

  private getMemoryRevisions(memoryId: string): MemoryInspectorItem['history'] {
    const rows = this.db.prepare(
      `SELECT id, action, previous_content AS previousContent, new_content AS newContent, reason,
       evidence_message_ids AS evidenceMessageIds, actor, created_at AS createdAt
       FROM memory_revisions WHERE memory_id = ? ORDER BY created_at DESC`,
    ).all(memoryId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id), action: String(row.action), previousContent: row.previousContent === null ? null : String(row.previousContent),
      newContent: row.newContent === null ? null : String(row.newContent), reason: String(row.reason),
      evidenceMessageIds: parseStringArray(String(row.evidenceMessageIds)), actor: row.actor as 'cognitive_consolidation' | 'manual_inspector',
      createdAt: String(row.createdAt),
    }));
  }

  private refreshMemoryFts(id: string, content: string): void {
    if (!this.ftsAvailable) return;
    this.db.prepare('DELETE FROM memories_fts WHERE id = ?').run(id);
    this.db.prepare('INSERT INTO memories_fts (id, content) VALUES (?, ?)').run(id, content);
  }
}

function now(): string {
  return new Date().toISOString();
}

function validEvidence(ids: string[], valid: Set<string>): boolean {
  return ids.length > 0 && ids.every((id) => valid.has(id));
}

function lessonEvidenceIsSufficient(candidate: TurnConsolidation['lessonsToCreate'][number] | TurnConsolidation['lessonsToRevise'][number]): boolean {
  return candidate.confidence >= 0.75 && (candidate.evidenceStrength !== 'repeated_pattern' || candidate.evidenceMessageIds.length >= 2);
}

function selfUpdateIsSufficient(update: NonNullable<TurnConsolidation['selfModelUpdate']>['traitUpdates'][number]): boolean {
  if (update.confidence < 0.8) return false;
  return update.evidenceStrength !== 'repeated_pattern' || update.evidenceMessageIds.length >= 2;
}

function searchTokens(value: string): string[] {
  return [...new Set(value.toLocaleLowerCase('pt-BR').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').match(/[a-z0-9]{3,}/g) ?? [])].slice(0, 16);
}

function normalizedWords(value: string): Set<string> {
  return new Set(searchTokens(value));
}

function similarity(leftValue: string, rightValue: string): number {
  const left = normalizedWords(leftValue);
  const right = normalizedWords(rightValue);
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const item of left) if (right.has(item)) overlap += 1;
  return overlap / (left.size + right.size - overlap);
}

function rankRows<T>(
  rows: T[],
  query: string,
  text: (row: T) => string,
  importance: (row: T) => number,
  confidence: (row: T) => number,
  updatedAt: (row: T) => string,
): Array<{ row: T; score: number }> {
  const queryWords = normalizedWords(query);
  return rows.map((row) => {
    const words = normalizedWords(text(row));
    let matches = 0;
    for (const word of queryWords) if (words.has(word)) matches += 1;
    const textual = queryWords.size ? matches / queryWords.size : 0.2;
    const ageDays = Math.max(0, (Date.now() - Date.parse(updatedAt(row))) / 86_400_000);
    const recency = 1 / (1 + ageDays / 30);
    return { row, score: clamp(textual * 0.5 + importance(row) * 0.2 + confidence(row) * 0.2 + recency * 0.1, 0, 1) };
  }).sort((a, b) => b.score - a.score);
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
  return {
    memories: take(context.memories, (item) => item.content),
    opinions: take(context.opinions, (item) => `${item.topic}${item.position}${item.reason}`),
    openLoops: take(context.openLoops, (item) => `${item.topic}${item.description}`),
    lessons: take(context.lessons, (item) => `${item.scopeKey ?? ''}${item.lesson}`),
    recentMessages: take([...context.recentMessages].reverse(), (item) => item.content).reverse(),
  };
}

function normalizeMemoryType(value: string): MemoryType {
  if (['episodic', 'semantic_personal', 'procedural', 'relationship', 'self_continuity'].includes(value)) return value as MemoryType;
  if (value === 'event') return 'episodic';
  if (value === 'relationship') return 'relationship';
  if (value === 'preference') return 'semantic_personal';
  return 'semantic_personal';
}

function normalizeStatus(value: string): RetrievedKnowledge['status'] {
  return value === 'uncertain' || value === 'superseded' ? value : 'active';
}

function parseStringArray(value: string): string[] {
  const parsed = parseUnknownArray(value);
  return parsed.filter((item): item is string => typeof item === 'string');
}

function parseUnknownArray(value: string): unknown[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseRecordArray(value: string): Array<Record<string, unknown>> {
  return parseUnknownArray(value).filter(
    (item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item),
  );
}

function parseObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function deduplicateSummary(summary: ConsolidationSummary): ConsolidationSummary {
  return {
    ...summary,
    createdMemoryIds: uniqueStrings(summary.createdMemoryIds),
    revisedMemoryIds: uniqueStrings(summary.revisedMemoryIds),
    opinionIds: uniqueStrings(summary.opinionIds),
    lessonIds: uniqueStrings(summary.lessonIds),
    openLoopIds: uniqueStrings(summary.openLoopIds),
  };
}
