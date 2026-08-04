import { z } from 'zod';

export const relationshipToPreviousSchema = z.enum(['new', 'consistent', 'changed', 'uncertain']);

export const cognitiveDecisionSchema = z.object({
  interpretation: z.string().min(1).max(1200),
  topic: z.string().min(1).max(300).nullable(),
  stance: z
    .object({
      position: z.string().min(1).max(1200),
      confidence: z.number().min(0).max(1),
      previousOpinionId: z.string().nullable(),
      relationshipToPrevious: relationshipToPreviousSchema,
      changeReason: z.string().max(1000).nullable(),
    })
    .nullable(),
  intention: z.string().min(1).max(600),
  tone: z.string().min(1).max(200),
  relevantMemoryIds: z.array(z.string()).max(20),
  relevantOpenLoopIds: z.array(z.string()).max(20),
  publicAction: z.enum(['respond', 'challenge', 'ask', 'defer', 'silence']),
});

export type CognitiveDecision = z.infer<typeof cognitiveDecisionSchema>;

const memoryCandidateSchema = z.object({
  content: z.string().min(1).max(2000),
  type: z.enum(['fact', 'impression', 'preference', 'relationship', 'event']),
  confidence: z.number().min(0).max(1),
  importance: z.number().min(0).max(1),
  evidenceMessageIds: z.array(z.string()).min(1).max(20),
});

const memoryUpdateSchema = memoryCandidateSchema.partial().extend({
  id: z.string().min(1),
  evidenceMessageIds: z.array(z.string()).min(1).max(20),
});

const opinionCandidateSchema = z.object({
  topic: z.string().min(1).max(300),
  position: z.string().min(1).max(2000),
  reason: z.string().min(1).max(2000),
  confidence: z.number().min(0).max(1),
  evidenceMessageIds: z.array(z.string()).min(1).max(20),
  previousOpinionId: z.string().nullable(),
});

const openLoopCandidateSchema = z.object({
  topic: z.string().min(1).max(300),
  description: z.string().min(1).max(1600),
  importance: z.number().min(0).max(1),
  evidenceMessageIds: z.array(z.string()).min(1).max(20),
});

export const turnConsolidationSchema = z.object({
  memoriesToCreate: z.array(memoryCandidateSchema).max(10),
  memoriesToUpdate: z.array(memoryUpdateSchema).max(10),
  opinionUpdate: opinionCandidateSchema.nullable(),
  openLoopsToCreate: z.array(openLoopCandidateSchema).max(10),
  openLoopsToResolve: z.array(z.string()).max(20),
});

export type TurnConsolidation = z.infer<typeof turnConsolidationSchema>;

export const initiativeDecisionSchema = z.object({
  initiate: z.boolean(),
  openLoopId: z.string().nullable(),
  reason: z.string().min(1).max(1000),
});

export type InitiativeDecision = z.infer<typeof initiativeDecisionSchema>;

export const cognitiveDecisionJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'interpretation',
    'topic',
    'stance',
    'intention',
    'tone',
    'relevantMemoryIds',
    'relevantOpenLoopIds',
    'publicAction',
  ],
  properties: {
    interpretation: { type: 'string' },
    topic: { type: ['string', 'null'] },
    stance: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          required: ['position', 'confidence', 'previousOpinionId', 'relationshipToPrevious', 'changeReason'],
          properties: {
            position: { type: 'string' },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            previousOpinionId: { type: ['string', 'null'] },
            relationshipToPrevious: { enum: ['new', 'consistent', 'changed', 'uncertain'] },
            changeReason: { type: ['string', 'null'] },
          },
        },
      ],
    },
    intention: { type: 'string' },
    tone: { type: 'string' },
    relevantMemoryIds: { type: 'array', items: { type: 'string' } },
    relevantOpenLoopIds: { type: 'array', items: { type: 'string' } },
    publicAction: { enum: ['respond', 'challenge', 'ask', 'defer', 'silence'] },
  },
} as const;

export const turnConsolidationJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['memoriesToCreate', 'memoriesToUpdate', 'opinionUpdate', 'openLoopsToCreate', 'openLoopsToResolve'],
  properties: {
    memoriesToCreate: { type: 'array', items: memoryCandidateJsonSchema() },
    memoriesToUpdate: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'evidenceMessageIds'],
        properties: {
          id: { type: 'string' },
          content: { type: 'string' },
          type: { enum: ['fact', 'impression', 'preference', 'relationship', 'event'] },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          importance: { type: 'number', minimum: 0, maximum: 1 },
          evidenceMessageIds: { type: 'array', minItems: 1, items: { type: 'string' } },
        },
      },
    },
    opinionUpdate: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          required: ['topic', 'position', 'reason', 'confidence', 'evidenceMessageIds', 'previousOpinionId'],
          properties: {
            topic: { type: 'string' },
            position: { type: 'string' },
            reason: { type: 'string' },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            evidenceMessageIds: { type: 'array', minItems: 1, items: { type: 'string' } },
            previousOpinionId: { type: ['string', 'null'] },
          },
        },
      ],
    },
    openLoopsToCreate: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['topic', 'description', 'importance', 'evidenceMessageIds'],
        properties: {
          topic: { type: 'string' },
          description: { type: 'string' },
          importance: { type: 'number', minimum: 0, maximum: 1 },
          evidenceMessageIds: { type: 'array', minItems: 1, items: { type: 'string' } },
        },
      },
    },
    openLoopsToResolve: { type: 'array', items: { type: 'string' } },
  },
} as const;

export const initiativeDecisionJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['initiate', 'openLoopId', 'reason'],
  properties: {
    initiate: { type: 'boolean' },
    openLoopId: { type: ['string', 'null'] },
    reason: { type: 'string' },
  },
} as const;

function memoryCandidateJsonSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['content', 'type', 'confidence', 'importance', 'evidenceMessageIds'],
    properties: {
      content: { type: 'string' },
      type: { enum: ['fact', 'impression', 'preference', 'relationship', 'event'] },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      importance: { type: 'number', minimum: 0, maximum: 1 },
      evidenceMessageIds: { type: 'array', minItems: 1, items: { type: 'string' } },
    },
  } as const;
}
