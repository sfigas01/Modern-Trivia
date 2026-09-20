import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { users } from './auth';
import type { EvidenceDimensionResult, FactScope, QuestionContentSnapshot } from './theme-evidence';
import { questions } from './questions';
import type { InternalThemeFailure } from './theme';

export const themeEvidenceDocuments = pgTable(
  'theme_evidence_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contractVersion: varchar('contract_version', { length: 64 }).notNull(),
    requestedUrl: text('requested_url').notNull(),
    finalUrl: text('final_url').notNull(),
    canonicalUrl: text('canonical_url').notNull(),
    publisherId: varchar('publisher_id', { length: 255 }).notNull(),
    sourceClass: varchar('source_class', { length: 40 }).notNull(),
    publisher: varchar('publisher', { length: 255 }).notNull(),
    originGroup: varchar('origin_group', { length: 255 }).notNull(),
    sourcePolicyVersion: varchar('source_policy_version', { length: 255 }).notNull(),
    extractorVersion: varchar('extractor_version', { length: 255 }).notNull(),
    title: text('title').notNull(),
    language: varchar('language', { length: 35 }).notNull(),
    status: varchar('status', { length: 20 }).notNull(),
    contentHash: varchar('content_hash', { length: 64 }).notNull(),
    retrievedAt: timestamp('retrieved_at', { withTimezone: true }).notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    sourceUpdatedAt: timestamp('source_updated_at', { withTimezone: true }),
    validUntil: timestamp('valid_until', { withTimezone: true }),
    httpStatus: integer('http_status').notNull(),
    mediaType: varchar('media_type', { length: 255 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_theme_evidence_documents_url_hash').on(table.canonicalUrl, table.contentHash),
    index('idx_theme_evidence_documents_freshness').on(table.status, table.validUntil),
    check('theme_evidence_documents_hash_format', sql`${table.contentHash} ~ '^[a-f0-9]{64}$'`),
    check(
      'theme_evidence_documents_status',
      sql`${table.status} IN ('retrieved', 'stale', 'withdrawn', 'unreadable')`
    ),
    check(
      'theme_evidence_documents_source_class',
      sql`${table.sourceClass} IN ('primary_official', 'primary_record', 'secondary_authoritative', 'secondary_reputable')`
    ),
    check('theme_evidence_documents_http_status', sql`${table.httpStatus} BETWEEN 100 AND 599`),
  ]
);

export const themeEvidencePassages = pgTable(
  'theme_evidence_passages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contractVersion: varchar('contract_version', { length: 64 }).notNull(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => themeEvidenceDocuments.id, { onDelete: 'restrict' }),
    ordinal: integer('ordinal').notNull(),
    locator: text('locator').notNull(),
    passageText: text('passage_text').notNull(),
    contentHash: varchar('content_hash', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_theme_evidence_passages_document_ordinal').on(table.documentId, table.ordinal),
    uniqueIndex('uq_theme_evidence_passages_document_hash').on(table.documentId, table.contentHash),
    check('theme_evidence_passages_ordinal', sql`${table.ordinal} >= 0`),
    check('theme_evidence_passages_hash_format', sql`${table.contentHash} ~ '^[a-f0-9]{64}$'`),
  ]
);

export const themeFacts = pgTable('theme_facts', {
  id: uuid('id').primaryKey().defaultRandom(),
  canonicalKey: varchar('canonical_key', { length: 255 }).notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const themeFactRevisions = pgTable(
  'theme_fact_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    factId: uuid('fact_id')
      .notNull()
      .references(() => themeFacts.id, { onDelete: 'restrict' }),
    contractVersion: varchar('contract_version', { length: 64 }).notNull(),
    revision: integer('revision').notNull(),
    statement: text('statement').notNull(),
    scope: jsonb('scope').$type<FactScope>().notNull(),
    canonicalAnswer: text('canonical_answer').notNull(),
    supportedAliases: jsonb('supported_aliases').$type<string[]>().notNull().default([]),
    contentHash: varchar('content_hash', { length: 64 }).notNull(),
    timeSensitive: boolean('time_sensitive').notNull().default(false),
    validUntil: timestamp('valid_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_theme_fact_revisions_fact_revision').on(table.factId, table.revision),
    uniqueIndex('uq_theme_fact_revisions_fact_hash').on(table.factId, table.contentHash),
    uniqueIndex('uq_theme_fact_revisions_id_fact').on(table.id, table.factId),
    index('idx_theme_fact_revisions_freshness').on(table.timeSensitive, table.validUntil),
    check('theme_fact_revisions_revision', sql`${table.revision} > 0`),
    check('theme_fact_revisions_hash_format', sql`${table.contentHash} ~ '^[a-f0-9]{64}$'`),
    check(
      'theme_fact_revisions_time_sensitive_expiry',
      sql`NOT ${table.timeSensitive} OR ${table.validUntil} IS NOT NULL`
    ),
    check(
      'theme_fact_revisions_alias_array',
      sql`jsonb_typeof(${table.supportedAliases}) = 'array'`
    ),
  ]
);

export const themeFactEvidencePassages = pgTable(
  'theme_fact_evidence_passages',
  {
    factRevisionId: uuid('fact_revision_id')
      .notNull()
      .references(() => themeFactRevisions.id, { onDelete: 'restrict' }),
    passageId: uuid('passage_id')
      .notNull()
      .references(() => themeEvidencePassages.id, { onDelete: 'restrict' }),
    supportKind: varchar('support_kind', { length: 20 }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.factRevisionId, table.passageId] }),
    index('idx_theme_fact_evidence_passages_passage').on(table.passageId),
    check(
      'theme_fact_evidence_passages_support_kind',
      sql`${table.supportKind} IN ('supports', 'conflicts', 'context')`
    ),
  ]
);

export const themeGameSessions = pgTable(
  'theme_game_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contractVersion: varchar('contract_version', { length: 64 }).notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 255 }).notNull().unique(),
    idempotencyOwnerHash: varchar('idempotency_owner_hash', { length: 64 }).notNull(),
    requestFingerprint: varchar('request_fingerprint', { length: 64 }).notNull(),
    roomId: uuid('room_id'),
    mode: varchar('mode', { length: 20 }).notNull(),
    status: varchar('status', { length: 32 }).notNull().default('setup'),
    theme: varchar('theme', { length: 60 }).notNull(),
    themeSlug: varchar('theme_slug', { length: 100 }).notNull(),
    relatedCategories: jsonb('related_categories').$type<string[]>().notNull(),
    playerCount: integer('player_count').notNull(),
    questionCount: integer('question_count').notNull(),
    themedQuestionTarget: integer('themed_question_target').notNull(),
    relatedQuestionTarget: integer('related_question_target').notNull(),
    candidateCeiling: integer('candidate_ceiling').notNull(),
    openingQuestionTarget: integer('opening_question_target').notNull(),
    openingThemedTarget: integer('opening_themed_target').notNull(),
    openingRelatedTarget: integer('opening_related_target').notNull(),
    mixConsentStatus: varchar('mix_consent_status', { length: 20 })
      .notNull()
      .default('not_required'),
    acceptedThemedTarget: integer('accepted_themed_target'),
    acceptedRelatedTarget: integer('accepted_related_target'),
    mixDecisionByHash: varchar('mix_decision_by_hash', { length: 64 }),
    mixDecidedAt: timestamp('mix_decided_at', { withTimezone: true }),
    corpusRevision: integer('corpus_revision').notNull().default(1),
    historyRevision: integer('history_revision').notNull().default(1),
    rosterLockedAt: timestamp('roster_locked_at', { withTimezone: true }),
    schedulingPausedAt: timestamp('scheduling_paused_at', { withTimezone: true }),
    disconnectGraceUntil: timestamp('disconnect_grace_until', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_theme_game_sessions_room').on(table.roomId),
    index('idx_theme_game_sessions_status_expiry').on(table.status, table.expiresAt),
    check('theme_game_sessions_mode', sql`${table.mode} IN ('multiplayer', 'shared_device')`),
    check(
      'theme_game_sessions_status',
      sql`${table.status} IN ('setup', 'preflight', 'preparing', 'awaiting_mix_consent', 'ready', 'active', 'paused', 'waiting', 'completed', 'failed', 'abandoned', 'expired')`
    ),
    check('theme_game_sessions_player_count', sql`${table.playerCount} IN (2, 3, 4)`),
    check('theme_game_sessions_question_count', sql`${table.questionCount} IN (40, 60, 80)`),
    check('theme_game_sessions_candidate_ceiling', sql`${table.candidateCeiling} IN (50, 75, 100)`),
    check(
      'theme_game_sessions_opening_target',
      sql`${table.openingQuestionTarget} IN (16, 24, 32)`
    ),
    check(
      'theme_game_sessions_mix_totals',
      sql`${table.themedQuestionTarget} + ${table.relatedQuestionTarget} = ${table.questionCount} AND ${table.openingThemedTarget} + ${table.openingRelatedTarget} = ${table.openingQuestionTarget}`
    ),
    check(
      'theme_game_sessions_plan',
      sql`(${table.playerCount} = 2 AND ${table.questionCount} = 40 AND ${table.themedQuestionTarget} = 30 AND ${table.relatedQuestionTarget} = 10 AND ${table.candidateCeiling} = 50 AND ${table.openingQuestionTarget} = 16 AND ${table.openingThemedTarget} = 12 AND ${table.openingRelatedTarget} = 4) OR (${table.playerCount} = 3 AND ${table.questionCount} = 60 AND ${table.themedQuestionTarget} = 45 AND ${table.relatedQuestionTarget} = 15 AND ${table.candidateCeiling} = 75 AND ${table.openingQuestionTarget} = 24 AND ${table.openingThemedTarget} = 18 AND ${table.openingRelatedTarget} = 6) OR (${table.playerCount} = 4 AND ${table.questionCount} = 80 AND ${table.themedQuestionTarget} = 60 AND ${table.relatedQuestionTarget} = 20 AND ${table.candidateCeiling} = 100 AND ${table.openingQuestionTarget} = 32 AND ${table.openingThemedTarget} = 24 AND ${table.openingRelatedTarget} = 8)`
    ),
    check(
      'theme_game_sessions_revisions_positive',
      sql`${table.corpusRevision} > 0 AND ${table.historyRevision} > 0`
    ),
    check(
      'theme_game_sessions_request_hashes',
      sql`${table.idempotencyOwnerHash} ~ '^[a-f0-9]{64}$' AND ${table.requestFingerprint} ~ '^[a-f0-9]{64}$'`
    ),
    check(
      'theme_game_sessions_mix_consent',
      sql`${table.mixConsentStatus} IN ('not_required', 'pending', 'accepted', 'declined') AND ((${table.mixConsentStatus} = 'accepted' AND ${table.acceptedThemedTarget} IS NOT NULL AND ${table.acceptedRelatedTarget} IS NOT NULL AND ${table.acceptedThemedTarget} >= 0 AND ${table.acceptedRelatedTarget} >= 0 AND ${table.acceptedThemedTarget} + ${table.acceptedRelatedTarget} = ${table.questionCount} AND ${table.mixDecisionByHash} IS NOT NULL AND ${table.mixDecisionByHash} ~ '^[a-f0-9]{64}$' AND ${table.mixDecidedAt} IS NOT NULL) OR (${table.mixConsentStatus} <> 'accepted' AND ${table.acceptedThemedTarget} IS NULL AND ${table.acceptedRelatedTarget} IS NULL AND ${table.mixDecisionByHash} IS NULL AND ${table.mixDecidedAt} IS NULL))`
    ),
    check(
      'theme_game_sessions_categories_array',
      sql`jsonb_typeof(${table.relatedCategories}) = 'array'`
    ),
  ]
);

export const themeParticipantIdentities = pgTable(
  'theme_participant_identities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: varchar('kind', { length: 20 }).notNull(),
    stableKeyHash: varchar('stable_key_hash', { length: 64 }).notNull(),
    accountUserId: varchar('account_user_id').references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_theme_participant_identities_kind_hash').on(table.kind, table.stableKeyHash),
    index('idx_theme_participant_identities_user').on(table.accountUserId),
    check(
      'theme_participant_identities_kind',
      sql`${table.kind} IN ('account', 'guest_browser', 'shared_device')`
    ),
    check(
      'theme_participant_identities_account_binding',
      sql`(${table.kind} = 'account' AND ${table.accountUserId} IS NOT NULL) OR (${table.kind} <> 'account' AND ${table.accountUserId} IS NULL)`
    ),
    check(
      'theme_participant_identities_hash_format',
      sql`${table.stableKeyHash} ~ '^[a-f0-9]{64}$'`
    ),
  ]
);

export const themeIdentityLinks = pgTable(
  'theme_identity_links',
  {
    sourceIdentityId: uuid('source_identity_id')
      .notNull()
      .references(() => themeParticipantIdentities.id, { onDelete: 'restrict' }),
    targetIdentityId: uuid('target_identity_id')
      .notNull()
      .references(() => themeParticipantIdentities.id, { onDelete: 'restrict' }),
    linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.sourceIdentityId, table.targetIdentityId] }),
    check(
      'theme_identity_links_distinct',
      sql`${table.sourceIdentityId} <> ${table.targetIdentityId}`
    ),
  ]
);

export const themeGameParticipants = pgTable(
  'theme_game_participants',
  {
    gameId: uuid('game_id')
      .notNull()
      .references(() => themeGameSessions.id, { onDelete: 'cascade' }),
    identityId: uuid('identity_id')
      .notNull()
      .references(() => themeParticipantIdentities.id, { onDelete: 'restrict' }),
    roomPlayerId: uuid('room_player_id'),
    seat: integer('seat').notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    leftAt: timestamp('left_at', { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.gameId, table.identityId] }),
    uniqueIndex('uq_theme_game_participants_seat').on(table.gameId, table.seat),
    index('idx_theme_game_participants_identity').on(table.identityId),
    check('theme_game_participants_seat', sql`${table.seat} BETWEEN 0 AND 3`),
  ]
);

export const themePreparationJobs = pgTable(
  'theme_preparation_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contractVersion: varchar('contract_version', { length: 64 }).notNull(),
    gameId: uuid('game_id')
      .notNull()
      .references(() => themeGameSessions.id, { onDelete: 'cascade' }),
    stableKey: varchar('stable_key', { length: 255 }).notNull().unique(),
    status: varchar('status', { length: 20 }).notNull().default('queued'),
    publicStage: varchar('public_stage', { length: 20 }).notNull().default('waiting'),
    candidateCeiling: integer('candidate_ceiling').notNull(),
    candidatesUsed: integer('candidates_used').notNull().default(0),
    readyCount: integer('ready_count').notNull().default(0),
    themedReadyCount: integer('themed_ready_count').notNull().default(0),
    relatedReadyCount: integer('related_ready_count').notNull().default(0),
    lastFailure: jsonb('last_failure').$type<InternalThemeFailure>(),
    leaseOwner: varchar('lease_owner', { length: 255 }),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_theme_preparation_jobs_game').on(table.gameId),
    uniqueIndex('uq_theme_preparation_jobs_id_game').on(table.id, table.gameId),
    index('idx_theme_preparation_jobs_status_lease').on(table.status, table.leaseExpiresAt),
    check(
      'theme_preparation_jobs_status',
      sql`${table.status} IN ('queued', 'researching', 'retrieving', 'extracting', 'writing', 'reviewing', 'qa', 'semantic_check', 'reserving', 'ready', 'shortfall', 'waiting', 'completed', 'failed', 'canceled', 'expired')`
    ),
    check(
      'theme_preparation_jobs_public_stage',
      sql`${table.publicStage} IN ('waiting', 'researching', 'generating', 'verifying', 'reserving', 'ready', 'paused', 'failed')`
    ),
    check('theme_preparation_jobs_ceiling', sql`${table.candidateCeiling} IN (50, 75, 100)`),
    check(
      'theme_preparation_jobs_counts',
      sql`${table.candidatesUsed} BETWEEN 0 AND ${table.candidateCeiling} AND ${table.readyCount} >= 0 AND ${table.themedReadyCount} >= 0 AND ${table.relatedReadyCount} >= 0 AND ${table.themedReadyCount} + ${table.relatedReadyCount} = ${table.readyCount}`
    ),
  ]
);

export const themeDailyBudgets = pgTable(
  'theme_daily_budgets',
  {
    budgetDate: date('budget_date').primaryKey(),
    currency: varchar('currency', { length: 3 }).notNull().default('USD'),
    limitMicros: integer('limit_micros').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check('theme_daily_budgets_limit', sql`${table.limitMicros} >= 0`)]
);

export const themeBudgetAllocations = pgTable(
  'theme_budget_allocations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    budgetDate: date('budget_date')
      .notNull()
      .references(() => themeDailyBudgets.budgetDate, { onDelete: 'restrict' }),
    jobId: uuid('job_id')
      .notNull()
      .references(() => themePreparationJobs.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 24 }).notNull().default('reserved'),
    reservedMicros: integer('reserved_micros').notNull(),
    settledMicros: integer('settled_micros').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_theme_budget_allocations_id_job').on(table.id, table.jobId),
    index('idx_theme_budget_allocations_day_status').on(table.budgetDate, table.status),
    index('idx_theme_budget_allocations_job').on(table.jobId),
    check(
      'theme_budget_allocations_status',
      sql`${table.status} IN ('reserved', 'partially_settled', 'settled', 'released', 'expired')`
    ),
    check(
      'theme_budget_allocations_amounts',
      sql`${table.reservedMicros} >= 0 AND ${table.settledMicros} >= 0 AND ${table.settledMicros} <= ${table.reservedMicros}`
    ),
  ]
);

export const themeJobAttempts = pgTable(
  'theme_job_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => themePreparationJobs.id, { onDelete: 'cascade' }),
    allocationId: uuid('allocation_id'),
    sequence: integer('sequence').notNull(),
    operation: varchar('operation', { length: 24 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('reserved'),
    provider: varchar('provider', { length: 255 }),
    model: varchar('model', { length: 255 }),
    providerRequestKey: varchar('provider_request_key', { length: 255 }),
    candidateSlotsConsumed: integer('candidate_slots_consumed').notNull().default(0),
    reservedCostMicros: integer('reserved_cost_micros').notNull().default(0),
    actualCostMicros: integer('actual_cost_micros').notNull().default(0),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    failure: jsonb('failure').$type<InternalThemeFailure>(),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_theme_job_attempts_sequence').on(table.jobId, table.sequence),
    uniqueIndex('uq_theme_job_attempts_id_job').on(table.id, table.jobId),
    uniqueIndex('uq_theme_job_attempts_provider_request').on(table.providerRequestKey),
    index('idx_theme_job_attempts_status').on(table.status),
    foreignKey({
      name: 'fk_theme_job_attempts_allocation_job',
      columns: [table.allocationId, table.jobId],
      foreignColumns: [themeBudgetAllocations.id, themeBudgetAllocations.jobId],
    }).onDelete('restrict'),
    check(
      'theme_job_attempts_operation',
      sql`${table.operation} IN ('research', 'retrieve', 'extract_fact', 'generate', 'review', 'repair', 'embed', 'semantic_check')`
    ),
    check(
      'theme_job_attempts_status',
      sql`${table.status} IN ('reserved', 'dispatched', 'succeeded', 'failed', 'unknown', 'canceled')`
    ),
    check(
      'theme_job_attempts_accounting',
      sql`${table.sequence} > 0 AND ${table.candidateSlotsConsumed} BETWEEN 0 AND 100 AND ${table.reservedCostMicros} >= 0 AND ${table.actualCostMicros} >= 0 AND ${table.actualCostMicros} <= ${table.reservedCostMicros} AND (${table.inputTokens} IS NULL OR ${table.inputTokens} >= 0) AND (${table.outputTokens} IS NULL OR ${table.outputTokens} >= 0)`
    ),
  ]
);

export const themeCandidates = pgTable(
  'theme_candidates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => themePreparationJobs.id, { onDelete: 'cascade' }),
    attemptId: uuid('attempt_id'),
    parentCandidateId: uuid('parent_candidate_id').references(
      (): AnyPgColumn => themeCandidates.id,
      { onDelete: 'restrict' }
    ),
    factId: uuid('fact_id')
      .notNull()
      .references(() => themeFacts.id, { onDelete: 'restrict' }),
    factRevisionId: uuid('fact_revision_id').notNull(),
    ordinal: integer('ordinal').notNull(),
    revision: integer('revision').notNull().default(1),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    contentHash: varchar('content_hash', { length: 64 }).notNull(),
    content: jsonb('content').$type<QuestionContentSnapshot>().notNull(),
    rejectionReasons: jsonb('rejection_reasons').$type<string[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_theme_candidates_job_ordinal').on(table.jobId, table.ordinal),
    index('idx_theme_candidates_job_status').on(table.jobId, table.status),
    foreignKey({
      name: 'fk_theme_candidates_attempt_job',
      columns: [table.attemptId, table.jobId],
      foreignColumns: [themeJobAttempts.id, themeJobAttempts.jobId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_theme_candidates_fact_revision',
      columns: [table.factRevisionId, table.factId],
      foreignColumns: [themeFactRevisions.id, themeFactRevisions.factId],
    }).onDelete('restrict'),
    check('theme_candidates_ordinal', sql`${table.ordinal} BETWEEN 1 AND 100`),
    check('theme_candidates_revision', sql`${table.revision} > 0`),
    check('theme_candidates_hash_format', sql`${table.contentHash} ~ '^[a-f0-9]{64}$'`),
    check(
      'theme_candidates_status',
      sql`${table.status} IN ('pending', 'reviewing', 'accepted', 'rejected', 'duplicate', 'superseded')`
    ),
    check(
      'theme_candidates_rejections_array',
      sql`jsonb_typeof(${table.rejectionReasons}) = 'array'`
    ),
  ]
);

export const themeQuestionRevisions = pgTable(
  'theme_question_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contractVersion: varchar('contract_version', { length: 64 }).notNull(),
    questionId: varchar('question_id').references(() => questions.id, { onDelete: 'restrict' }),
    candidateId: uuid('candidate_id').references(() => themeCandidates.id, {
      onDelete: 'restrict',
    }),
    revision: integer('revision').notNull(),
    contentHash: varchar('content_hash', { length: 64 }).notNull(),
    content: jsonb('content').$type<QuestionContentSnapshot>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_theme_question_revisions_id_hash').on(table.id, table.contentHash),
    uniqueIndex('uq_theme_question_revisions_id_question').on(table.id, table.questionId),
    uniqueIndex('uq_theme_question_revisions_question_revision').on(
      table.questionId,
      table.revision
    ),
    uniqueIndex('uq_theme_question_revisions_candidate').on(table.candidateId),
    check(
      'theme_question_revisions_owner',
      sql`(${table.questionId} IS NOT NULL) <> (${table.candidateId} IS NOT NULL)`
    ),
    check('theme_question_revisions_revision', sql`${table.revision} > 0`),
    check('theme_question_revisions_hash_format', sql`${table.contentHash} ~ '^[a-f0-9]{64}$'`),
  ]
);

export const themeEvidenceReviews = pgTable(
  'theme_evidence_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contractVersion: varchar('contract_version', { length: 64 }).notNull(),
    questionRevisionId: uuid('question_revision_id').notNull(),
    questionContentHash: varchar('question_content_hash', { length: 64 }).notNull(),
    reviewPolicyVersion: varchar('review_policy_version', { length: 255 }).notNull(),
    reviewerPromptVersion: varchar('reviewer_prompt_version', { length: 255 }).notNull(),
    verdict: varchar('verdict', { length: 10 }).notNull(),
    dimensionResults: jsonb('dimension_results').$type<EvidenceDimensionResult[]>().notNull(),
    reviewerKind: varchar('reviewer_kind', { length: 10 }).notNull(),
    reviewerModel: varchar('reviewer_model', { length: 255 }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }).notNull(),
    validUntil: timestamp('valid_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'fk_theme_evidence_reviews_exact_revision',
      columns: [table.questionRevisionId, table.questionContentHash],
      foreignColumns: [themeQuestionRevisions.id, themeQuestionRevisions.contentHash],
    }).onDelete('restrict'),
    index('idx_theme_evidence_reviews_revision_time').on(
      table.questionRevisionId,
      table.reviewedAt
    ),
    index('idx_theme_evidence_reviews_verdict_expiry').on(table.verdict, table.validUntil),
    check('theme_evidence_reviews_verdict', sql`${table.verdict} IN ('pass', 'flag', 'fail')`),
    check(
      'theme_evidence_reviews_reviewer',
      sql`${table.reviewerKind} IN ('model', 'human') AND (${table.reviewerKind} <> 'model' OR ${table.reviewerModel} IS NOT NULL)`
    ),
    check(
      'theme_evidence_reviews_hash_format',
      sql`${table.questionContentHash} ~ '^[a-f0-9]{64}$'`
    ),
    check(
      'theme_evidence_reviews_dimensions_array',
      sql`jsonb_typeof(${table.dimensionResults}) = 'array' AND jsonb_array_length(${table.dimensionResults}) = 7`
    ),
  ]
);

export const themeEvidenceReviewFacts = pgTable(
  'theme_evidence_review_facts',
  {
    reviewId: uuid('review_id')
      .notNull()
      .references(() => themeEvidenceReviews.id, { onDelete: 'restrict' }),
    factRevisionId: uuid('fact_revision_id')
      .notNull()
      .references(() => themeFactRevisions.id, { onDelete: 'restrict' }),
  },
  (table) => [primaryKey({ columns: [table.reviewId, table.factRevisionId] })]
);

export const themeEvidenceReviewPassages = pgTable(
  'theme_evidence_review_passages',
  {
    reviewId: uuid('review_id')
      .notNull()
      .references(() => themeEvidenceReviews.id, { onDelete: 'restrict' }),
    passageId: uuid('passage_id')
      .notNull()
      .references(() => themeEvidencePassages.id, { onDelete: 'restrict' }),
  },
  (table) => [primaryKey({ columns: [table.reviewId, table.passageId] })]
);

export const themeQuestionReservations = pgTable(
  'theme_question_reservations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gameId: uuid('game_id')
      .notNull()
      .references(() => themeGameSessions.id, { onDelete: 'cascade' }),
    jobId: uuid('job_id'),
    questionId: varchar('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'restrict' }),
    questionRevisionId: uuid('question_revision_id').notNull(),
    factId: uuid('fact_id')
      .notNull()
      .references(() => themeFacts.id, { onDelete: 'restrict' }),
    factRevisionId: uuid('fact_revision_id').notNull(),
    role: varchar('role', { length: 20 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('held'),
    corpusRevision: integer('corpus_revision').notNull(),
    historyRevision: integer('history_revision').notNull(),
    reservedAt: timestamp('reserved_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    releasedAt: timestamp('released_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('uq_theme_question_reservations_game_question').on(table.gameId, table.questionId),
    uniqueIndex('uq_theme_question_reservations_game_fact').on(table.gameId, table.factId),
    uniqueIndex('uq_theme_question_reservations_id_fact').on(table.id, table.factId),
    index('idx_theme_question_reservations_status_expiry').on(table.status, table.expiresAt),
    foreignKey({
      name: 'fk_theme_question_reservations_job_game',
      columns: [table.jobId, table.gameId],
      foreignColumns: [themePreparationJobs.id, themePreparationJobs.gameId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_theme_question_reservations_question_revision',
      columns: [table.questionRevisionId, table.questionId],
      foreignColumns: [themeQuestionRevisions.id, themeQuestionRevisions.questionId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_theme_question_reservations_fact_revision',
      columns: [table.factRevisionId, table.factId],
      foreignColumns: [themeFactRevisions.id, themeFactRevisions.factId],
    }).onDelete('restrict'),
    check('theme_question_reservations_role', sql`${table.role} IN ('theme', 'related_backup')`),
    check(
      'theme_question_reservations_status',
      sql`${table.status} IN ('held', 'selected', 'displayed', 'released', 'expired')`
    ),
    check(
      'theme_question_reservations_revisions',
      sql`${table.corpusRevision} > 0 AND ${table.historyRevision} > 0`
    ),
  ]
);

export const themeReservationParticipants = pgTable(
  'theme_reservation_participants',
  {
    reservationId: uuid('reservation_id').notNull(),
    identityId: uuid('identity_id')
      .notNull()
      .references(() => themeParticipantIdentities.id, { onDelete: 'restrict' }),
    factId: uuid('fact_id')
      .notNull()
      .references(() => themeFacts.id, { onDelete: 'restrict' }),
    releasedAt: timestamp('released_at', { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.reservationId, table.identityId] }),
    foreignKey({
      name: 'fk_theme_reservation_participants_reservation_fact',
      columns: [table.reservationId, table.factId],
      foreignColumns: [themeQuestionReservations.id, themeQuestionReservations.factId],
    }).onDelete('cascade'),
    uniqueIndex('uq_theme_reservation_participants_active_fact')
      .on(table.identityId, table.factId)
      .where(sql`${table.releasedAt} IS NULL`),
  ]
);

export const themeQuestionExposures = pgTable(
  'theme_question_exposures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gameId: uuid('game_id')
      .notNull()
      .references(() => themeGameSessions.id, { onDelete: 'restrict' }),
    identityId: uuid('identity_id')
      .notNull()
      .references(() => themeParticipantIdentities.id, { onDelete: 'restrict' }),
    questionId: varchar('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'restrict' }),
    factId: uuid('fact_id').references(() => themeFacts.id, { onDelete: 'restrict' }),
    factRevisionId: uuid('fact_revision_id').references(() => themeFactRevisions.id, {
      onDelete: 'restrict',
    }),
    displayKey: varchar('display_key', { length: 255 }).notNull(),
    displayedAt: timestamp('displayed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_theme_question_exposures_display').on(
      table.gameId,
      table.identityId,
      table.displayKey
    ),
    index('idx_theme_question_exposures_identity_time').on(table.identityId, table.displayedAt),
    index('idx_theme_question_exposures_identity_fact').on(table.identityId, table.factId),
    index('idx_theme_question_exposures_identity_game').on(table.identityId, table.gameId),
    foreignKey({
      name: 'fk_theme_question_exposures_fact_revision',
      columns: [table.factRevisionId, table.factId],
      foreignColumns: [themeFactRevisions.id, themeFactRevisions.factId],
    }).onDelete('restrict'),
    check(
      'theme_question_exposures_fact_binding',
      sql`(${table.factId} IS NULL) = (${table.factRevisionId} IS NULL)`
    ),
  ]
);

export type ThemeEvidenceDocument = typeof themeEvidenceDocuments.$inferSelect;
export type ThemeEvidencePassage = typeof themeEvidencePassages.$inferSelect;
export type ThemeFact = typeof themeFacts.$inferSelect;
export type ThemeFactRevision = typeof themeFactRevisions.$inferSelect;
export type ThemeGameSession = typeof themeGameSessions.$inferSelect;
export type ThemeParticipantIdentity = typeof themeParticipantIdentities.$inferSelect;
export type ThemeGameParticipant = typeof themeGameParticipants.$inferSelect;
export type ThemePreparationJob = typeof themePreparationJobs.$inferSelect;
export type ThemeBudgetAllocation = typeof themeBudgetAllocations.$inferSelect;
export type ThemeJobAttempt = typeof themeJobAttempts.$inferSelect;
export type ThemeCandidate = typeof themeCandidates.$inferSelect;
export type ThemeQuestionRevision = typeof themeQuestionRevisions.$inferSelect;
export type ThemeEvidenceReview = typeof themeEvidenceReviews.$inferSelect;
export type ThemeQuestionReservation = typeof themeQuestionReservations.$inferSelect;
export type ThemeQuestionExposure = typeof themeQuestionExposures.$inferSelect;
