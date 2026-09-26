import { createHash, randomUUID } from 'node:crypto';

import type { Pool, PoolClient, QueryResultRow } from 'pg';

import {
  createThemeGameRequestSchema,
  publicThemeJobSchema,
  themeGamePlanFor,
  type CreateThemeGameRequest,
  type InternalThemeFailure,
  type PublicThemeFailure,
  type PublicThemeJob,
} from '@shared/models/theme';

type PlayerCount = 2 | 3 | 4;

export const THEME_TERMINAL_JOB_STATUSES = ['completed', 'failed', 'canceled', 'expired'] as const;
export type ThemeTerminalJobStatus = (typeof THEME_TERMINAL_JOB_STATUSES)[number];
export const THEME_TERMINAL_GAME_STATUSES = [
  'completed',
  'failed',
  'abandoned',
  'expired',
] as const;

export type ThemeJobStatus =
  | 'queued'
  | 'researching'
  | 'retrieving'
  | 'extracting'
  | 'writing'
  | 'reviewing'
  | 'qa'
  | 'semantic_check'
  | 'reserving'
  | 'ready'
  | 'shortfall'
  | 'waiting'
  | ThemeTerminalJobStatus;

export type ThemePublicStage =
  | 'waiting'
  | 'researching'
  | 'generating'
  | 'verifying'
  | 'reserving'
  | 'ready'
  | 'paused'
  | 'failed';

export type ThemeGameStatus =
  | 'setup'
  | 'preflight'
  | 'preparing'
  | 'awaiting_mix_consent'
  | 'ready'
  | 'active'
  | 'paused'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'abandoned'
  | 'expired';

export interface ThemeGameRecord {
  id: string;
  contractVersion: string;
  idempotencyKey: string;
  idempotencyOwnerHash: string;
  requestFingerprint: string;
  roomId: string | null;
  mode: 'multiplayer' | 'shared_device';
  status: ThemeGameStatus;
  theme: string;
  themeSlug: string;
  relatedCategories: string[];
  playerCount: PlayerCount;
  questionCount: number;
  themedQuestionTarget: number;
  relatedQuestionTarget: number;
  candidateCeiling: number;
  openingQuestionTarget: number;
  openingThemedTarget: number;
  openingRelatedTarget: number;
  mixConsentStatus: 'not_required' | 'pending' | 'accepted' | 'declined';
  acceptedThemedTarget: number | null;
  acceptedRelatedTarget: number | null;
  rosterLockedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ThemeJobRecord {
  id: string;
  contractVersion: string;
  gameId: string;
  stableKey: string;
  status: ThemeJobStatus;
  publicStage: ThemePublicStage;
  candidateCeiling: number;
  candidatesUsed: number;
  readyCount: number;
  themedReadyCount: number;
  relatedReadyCount: number;
  lastFailure: InternalThemeFailure | null;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ThemeRosterMemberInput {
  identityId: string;
  roomPlayerId?: string | null;
}

export interface CreateThemeLifecycleInput {
  request: CreateThemeGameRequest;
  ownerKey: string;
  roomId?: string | null;
  roster: ThemeRosterMemberInput[];
  expiresAt: Date;
}

export interface PreparedThemeLifecycleCreate {
  request: CreateThemeGameRequest;
  idempotencyOwnerHash: string;
  requestFingerprint: string;
  roomId: string | null;
  roster: Array<ThemeRosterMemberInput & { seat: number }>;
  now: Date;
  expiresAt: Date;
}

export interface ThemeLifecycleBundle {
  game: ThemeGameRecord;
  job: ThemeJobRecord;
  created: boolean;
}

export interface ThemeLifecycleRepository {
  createGameWithRosterAndJob(input: PreparedThemeLifecycleCreate): Promise<ThemeLifecycleBundle>;
  getGame(gameId: string): Promise<ThemeGameRecord | null>;
  getJob(jobId: string): Promise<ThemeJobRecord | null>;
  isGameAvailable(gameId: string, now: Date): Promise<boolean>;
  acquireLease(input: {
    jobId: string;
    claimToken: string;
    now: Date;
    leaseDurationMs: number;
  }): Promise<ThemeJobRecord | null>;
  renewLease(input: {
    jobId: string;
    claimToken: string;
    now: Date;
    leaseDurationMs: number;
  }): Promise<ThemeJobRecord | null>;
  releaseLease(input: {
    jobId: string;
    claimToken: string;
    now: Date;
  }): Promise<ThemeJobRecord | null>;
  transitionJob(input: {
    jobId: string;
    claimToken: string;
    expectedStatus: ThemeJobStatus;
    status: ThemeJobStatus;
    publicStage: ThemePublicStage;
    now: Date;
  }): Promise<ThemeJobRecord | null>;
  terminalizeJob(input: {
    jobId: string;
    expectedStatus: ThemeJobStatus;
    status: ThemeTerminalJobStatus;
    publicStage: ThemePublicStage;
    now: Date;
  }): Promise<ThemeJobRecord | null>;
}

export type ThemeLifecycleErrorCode =
  | 'invalid_owner'
  | 'invalid_roster'
  | 'invalid_expiry'
  | 'invalid_time'
  | 'idempotency_conflict'
  | 'job_not_found'
  | 'game_unavailable'
  | 'lease_unavailable'
  | 'stale_lease'
  | 'terminal_job'
  | 'illegal_transition'
  | 'transition_conflict';

export class ThemeLifecycleError extends Error {
  constructor(
    readonly code: ThemeLifecycleErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'ThemeLifecycleError';
  }
}

const LEGAL_JOB_TRANSITIONS: Readonly<Record<ThemeJobStatus, readonly ThemeJobStatus[]>> = {
  queued: ['researching', 'waiting', 'failed', 'canceled', 'expired'],
  researching: ['retrieving', 'writing', 'waiting', 'failed', 'canceled', 'expired'],
  retrieving: ['extracting', 'waiting', 'failed', 'canceled', 'expired'],
  extracting: ['writing', 'waiting', 'failed', 'canceled', 'expired'],
  writing: ['reviewing', 'waiting', 'failed', 'canceled', 'expired'],
  reviewing: ['qa', 'waiting', 'failed', 'canceled', 'expired'],
  qa: ['semantic_check', 'waiting', 'failed', 'canceled', 'expired'],
  semantic_check: ['reserving', 'shortfall', 'waiting', 'failed', 'canceled', 'expired'],
  reserving: ['ready', 'shortfall', 'waiting', 'failed', 'canceled', 'expired'],
  ready: ['waiting', 'completed', 'failed', 'canceled', 'expired'],
  shortfall: ['reserving', 'waiting', 'failed', 'canceled', 'expired'],
  waiting: ['queued', 'researching', 'reserving', 'failed', 'canceled', 'expired'],
  completed: [],
  failed: [],
  canceled: [],
  expired: [],
};

const PUBLIC_STAGE_BY_STATUS: Readonly<Record<ThemeJobStatus, ThemePublicStage>> = {
  queued: 'waiting',
  researching: 'researching',
  retrieving: 'researching',
  extracting: 'researching',
  writing: 'generating',
  reviewing: 'verifying',
  qa: 'verifying',
  semantic_check: 'verifying',
  reserving: 'reserving',
  ready: 'ready',
  shortfall: 'paused',
  waiting: 'paused',
  completed: 'ready',
  failed: 'failed',
  canceled: 'failed',
  expired: 'failed',
};

export function isTerminalThemeJobStatus(status: ThemeJobStatus): status is ThemeTerminalJobStatus {
  return (THEME_TERMINAL_JOB_STATUSES as readonly string[]).includes(status);
}

export function canTransitionThemeJob(from: ThemeJobStatus, to: ThemeJobStatus): boolean {
  return LEGAL_JOB_TRANSITIONS[from].includes(to);
}

export function publicStageForThemeJob(status: ThemeJobStatus): ThemePublicStage {
  return PUBLIC_STAGE_BY_STATUS[status];
}

function defaultHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function assertHash(value: string, label: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${label} must produce a lowercase SHA-256 hash`);
  }
  return value;
}

function requireValidDate(value: Date, label: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new ThemeLifecycleError('invalid_time', `${label} must be a valid Date`);
  }
  return value;
}

function leaseExpiry(now: Date, leaseDurationMs: number): Date {
  requireValidDate(now, 'Current time');
  if (!Number.isSafeInteger(leaseDurationMs) || leaseDurationMs <= 0) {
    throw new RangeError('leaseDurationMs must be a positive safe integer');
  }
  const expiry = new Date(now.getTime() + leaseDurationMs);
  if (!Number.isFinite(expiry.getTime())) {
    throw new ThemeLifecycleError('invalid_time', 'Lease expiry exceeds the JavaScript Date range');
  }
  return expiry;
}

function canonicalFingerprintPayload(input: {
  request: CreateThemeGameRequest;
  roomId: string | null;
  roster: Array<ThemeRosterMemberInput & { seat: number }>;
}): string {
  return JSON.stringify({
    contractVersion: input.request.contractVersion,
    idempotencyKey: input.request.idempotencyKey,
    mode: input.request.mode,
    theme: input.request.theme,
    themeSlug: input.request.themeSlug,
    relatedCategories: [...input.request.relatedCategories].sort(),
    playerCount: input.request.playerCount,
    roomId: input.roomId,
    roster: input.roster.map(({ identityId, roomPlayerId, seat }) => ({
      identityId,
      roomPlayerId: roomPlayerId ?? null,
      seat,
    })),
  });
}

function prepareCreateInput(
  input: CreateThemeLifecycleInput,
  now: Date,
  hash: (value: string) => string
): PreparedThemeLifecycleCreate {
  const request = createThemeGameRequestSchema.parse(input.request);
  requireValidDate(now, 'Current time');
  requireValidDate(input.expiresAt, 'Game expiry');
  const ownerKey = input.ownerKey.trim();
  if (!ownerKey) {
    throw new ThemeLifecycleError('invalid_owner', 'A stable owner key is required');
  }
  if (input.expiresAt.getTime() <= now.getTime()) {
    throw new ThemeLifecycleError('invalid_expiry', 'Game expiry must be after creation time');
  }
  if (input.roster.length !== request.playerCount || ![2, 3, 4].includes(input.roster.length)) {
    throw new ThemeLifecycleError(
      'invalid_roster',
      'The locked roster must contain exactly the declared 2, 3, or 4 participants'
    );
  }
  const identityIds = input.roster.map(({ identityId }) => identityId);
  if (
    identityIds.some((identityId) => !identityId.trim()) ||
    new Set(identityIds).size !== identityIds.length
  ) {
    throw new ThemeLifecycleError(
      'invalid_roster',
      'Roster identities must be non-empty and unique'
    );
  }

  const roster = input.roster.map((member, seat) => ({ ...member, seat }));
  const roomId = input.roomId ?? null;
  return {
    request,
    roomId,
    roster,
    now,
    expiresAt: input.expiresAt,
    idempotencyOwnerHash: assertHash(hash(`theme-owner:${ownerKey}`), 'hash'),
    requestFingerprint: assertHash(
      hash(`theme-request:${canonicalFingerprintPayload({ request, roomId, roster })}`),
      'hash'
    ),
  };
}

function publicFailureFor(job: ThemeJobRecord): PublicThemeFailure | null {
  if (!job.lastFailure) return null;
  switch (job.lastFailure.code) {
    case 'unsupported_theme':
    case 'invalid_theme':
      return {
        code: 'theme_not_supported',
        retryable: false,
        message: 'This theme is not supported.',
      };
    case 'inventory_shortfall':
      return {
        code: 'related_inventory_shortfall',
        retryable: false,
        message: 'There are not enough verified related questions for this roster.',
      };
    case 'budget_unavailable':
      return {
        code: 'daily_capacity_unavailable',
        retryable: true,
        message: 'Theme preparation capacity is currently unavailable.',
      };
    case 'job_canceled':
      return {
        code: 'preparation_paused',
        retryable: true,
        message: 'Theme preparation is paused.',
      };
    default:
      return {
        code: 'preparation_failed',
        retryable: job.lastFailure.retryable,
        message: 'Theme preparation could not be completed.',
      };
  }
}

export function projectPublicThemeJob(
  game: ThemeGameRecord,
  job: ThemeJobRecord,
  now: Date
): PublicThemeJob {
  requireValidDate(now, 'Projection time');
  if (
    job.gameId !== game.id ||
    job.contractVersion !== game.contractVersion ||
    job.candidateCeiling !== game.candidateCeiling
  ) {
    throw new Error('Theme job does not match its enclosing game contract');
  }
  const openingReadyCount = Math.min(job.readyCount, game.openingQuestionTarget);
  const acceptedDecisionValid =
    game.mixConsentStatus === 'accepted' &&
    game.acceptedThemedTarget !== null &&
    game.acceptedRelatedTarget !== null &&
    Number.isInteger(game.acceptedThemedTarget) &&
    Number.isInteger(game.acceptedRelatedTarget) &&
    game.acceptedThemedTarget >= 0 &&
    game.acceptedRelatedTarget >= 0 &&
    game.acceptedThemedTarget + game.acceptedRelatedTarget === game.questionCount;
  const standardMixReady =
    job.themedReadyCount >= game.openingThemedTarget &&
    job.relatedReadyCount >= game.openingRelatedTarget;
  // Accepted fallback targets are persisted only for the full game. Until a later
  // slice persists opening-specific accepted targets, require the complete accepted
  // mix before starting rather than inferring a looser opening mix.
  const acceptedMixReady =
    acceptedDecisionValid &&
    job.readyCount >= game.questionCount &&
    job.themedReadyCount >= game.acceptedThemedTarget! &&
    job.relatedReadyCount >= game.acceptedRelatedTarget!;
  const mixReady =
    (game.mixConsentStatus === 'not_required' && standardMixReady) || acceptedMixReady;
  const rosterLocked =
    game.rosterLockedAt !== null && Number.isFinite(game.rosterLockedAt.getTime());
  const canStart =
    rosterLocked &&
    game.expiresAt.getTime() > now.getTime() &&
    game.status === 'ready' &&
    job.status === 'ready' &&
    openingReadyCount >= game.openingQuestionTarget &&
    mixReady;

  return publicThemeJobSchema.parse({
    contractVersion: game.contractVersion,
    gameId: game.id,
    jobId: job.id,
    theme: game.theme,
    relatedCategories: game.relatedCategories,
    progress: {
      contractVersion: game.contractVersion,
      gameId: game.id,
      jobId: job.id,
      status: job.status,
      stage: publicStageForThemeJob(job.status),
      readyCount: job.readyCount,
      requiredCount: game.questionCount,
      openingReadyCount,
      openingRequiredCount: game.openingQuestionTarget,
      themedReadyCount: job.themedReadyCount,
      relatedReadyCount: job.relatedReadyCount,
      candidatesUsed: job.candidatesUsed,
      candidateCeiling: job.candidateCeiling,
      canStart,
      needsHostDecision:
        game.status === 'awaiting_mix_consent' || game.mixConsentStatus === 'pending',
      failure: publicFailureFor(job),
      updatedAt: job.updatedAt.toISOString(),
    },
  });
}

export function createThemeLifecycleService(options: {
  repository: ThemeLifecycleRepository;
  now?: () => Date;
  claimToken?: () => string;
  hash?: (value: string) => string;
}) {
  const now = options.now ?? (() => new Date());
  const claimToken = options.claimToken ?? randomUUID;
  const hash = options.hash ?? defaultHash;

  return {
    async createGame(input: CreateThemeLifecycleInput): Promise<ThemeLifecycleBundle> {
      return options.repository.createGameWithRosterAndJob(prepareCreateInput(input, now(), hash));
    },

    async acquireLease(jobId: string, leaseDurationMs: number) {
      const claimedAt = now();
      leaseExpiry(claimedAt, leaseDurationMs);
      const token = claimToken();
      if (!token || token.length > 255) throw new Error('claimToken must return 1-255 characters');
      const job = await options.repository.acquireLease({
        jobId,
        claimToken: token,
        now: claimedAt,
        leaseDurationMs,
      });
      if (job) return { job, claimToken: token };
      const current = await options.repository.getJob(jobId);
      if (!current)
        throw new ThemeLifecycleError('job_not_found', 'Theme preparation job not found');
      if (isTerminalThemeJobStatus(current.status)) {
        throw new ThemeLifecycleError('terminal_job', 'Terminal jobs cannot be leased');
      }
      if (!(await options.repository.isGameAvailable(current.gameId, claimedAt))) {
        throw new ThemeLifecycleError('game_unavailable', 'Parent game is terminal or expired');
      }
      throw new ThemeLifecycleError(
        'lease_unavailable',
        'Theme preparation job already has an active lease'
      );
    },

    async renewLease(
      jobId: string,
      token: string,
      leaseDurationMs: number
    ): Promise<ThemeJobRecord> {
      const renewedAt = now();
      leaseExpiry(renewedAt, leaseDurationMs);
      const job = await options.repository.renewLease({
        jobId,
        claimToken: token,
        now: renewedAt,
        leaseDurationMs,
      });
      if (job) return job;
      throw new ThemeLifecycleError('stale_lease', 'Lease token is stale or expired');
    },

    async releaseLease(jobId: string, token: string): Promise<ThemeJobRecord> {
      const releasedAt = requireValidDate(now(), 'Current time');
      const job = await options.repository.releaseLease({
        jobId,
        claimToken: token,
        now: releasedAt,
      });
      if (job) return job;
      throw new ThemeLifecycleError('stale_lease', 'Lease token is stale or expired');
    },

    async transitionJob(
      jobId: string,
      token: string,
      status: ThemeJobStatus
    ): Promise<ThemeJobRecord> {
      const transitionAt = requireValidDate(now(), 'Current time');
      const current = await options.repository.getJob(jobId);
      if (!current)
        throw new ThemeLifecycleError('job_not_found', 'Theme preparation job not found');
      if (isTerminalThemeJobStatus(current.status)) {
        throw new ThemeLifecycleError('terminal_job', 'Terminal jobs cannot transition');
      }
      if (isTerminalThemeJobStatus(status)) {
        throw new ThemeLifecycleError(
          'illegal_transition',
          'Use terminalizeJob for an explicit terminal transition'
        );
      }
      if (!canTransitionThemeJob(current.status, status)) {
        throw new ThemeLifecycleError(
          'illegal_transition',
          `Illegal theme job transition: ${current.status} -> ${status}`
        );
      }
      const transitioned = await options.repository.transitionJob({
        jobId,
        claimToken: token,
        expectedStatus: current.status,
        status,
        publicStage: publicStageForThemeJob(status),
        now: transitionAt,
      });
      if (transitioned) return transitioned;
      const latest = await options.repository.getJob(jobId);
      if (
        !latest?.leaseOwner ||
        latest.leaseOwner !== token ||
        !latest.leaseExpiresAt ||
        latest.leaseExpiresAt <= transitionAt
      ) {
        throw new ThemeLifecycleError('stale_lease', 'Lease token is stale or expired');
      }
      const game = await options.repository.getGame(latest.gameId);
      if (
        !game ||
        (THEME_TERMINAL_GAME_STATUSES as readonly string[]).includes(game.status) ||
        game.expiresAt.getTime() <= transitionAt.getTime()
      ) {
        throw new ThemeLifecycleError('game_unavailable', 'Parent game is terminal or expired');
      }
      throw new ThemeLifecycleError('transition_conflict', 'Theme job changed before transition');
    },

    async terminalizeJob(jobId: string, status: ThemeTerminalJobStatus): Promise<ThemeJobRecord> {
      const terminalizedAt = requireValidDate(now(), 'Current time');
      const current = await options.repository.getJob(jobId);
      if (!current)
        throw new ThemeLifecycleError('job_not_found', 'Theme preparation job not found');
      if (isTerminalThemeJobStatus(current.status)) {
        if (current.status === status) return current;
        throw new ThemeLifecycleError('terminal_job', 'Terminal jobs cannot change terminal state');
      }
      if (!canTransitionThemeJob(current.status, status)) {
        throw new ThemeLifecycleError(
          'illegal_transition',
          `Illegal theme job terminalization: ${current.status} -> ${status}`
        );
      }
      const terminalized = await options.repository.terminalizeJob({
        jobId,
        expectedStatus: current.status,
        status,
        publicStage: publicStageForThemeJob(status),
        now: terminalizedAt,
      });
      if (terminalized) return terminalized;
      const latest = await options.repository.getJob(jobId);
      if (latest && isTerminalThemeJobStatus(latest.status) && latest.status === status)
        return latest;
      throw new ThemeLifecycleError(
        'transition_conflict',
        'Theme job changed before terminalization'
      );
    },
  };
}

interface GameRow extends QueryResultRow {
  id: string;
  contract_version: string;
  idempotency_key: string;
  idempotency_owner_hash: string;
  request_fingerprint: string;
  room_id: string | null;
  mode: 'multiplayer' | 'shared_device';
  status: ThemeGameStatus;
  theme: string;
  theme_slug: string;
  related_categories: string[];
  player_count: PlayerCount;
  question_count: number;
  themed_question_target: number;
  related_question_target: number;
  candidate_ceiling: number;
  opening_question_target: number;
  opening_themed_target: number;
  opening_related_target: number;
  mix_consent_status: ThemeGameRecord['mixConsentStatus'];
  accepted_themed_target: number | null;
  accepted_related_target: number | null;
  roster_locked_at: Date | null;
  expires_at: Date;
  created_at: Date;
  updated_at: Date;
}

interface JobRow extends QueryResultRow {
  id: string;
  contract_version: string;
  game_id: string;
  stable_key: string;
  status: ThemeJobStatus;
  public_stage: ThemePublicStage;
  candidate_ceiling: number;
  candidates_used: number;
  ready_count: number;
  themed_ready_count: number;
  related_ready_count: number;
  last_failure: InternalThemeFailure | null;
  lease_owner: string | null;
  lease_expires_at: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function mapGame(row: GameRow): ThemeGameRecord {
  return {
    id: row.id,
    contractVersion: row.contract_version,
    idempotencyKey: row.idempotency_key,
    idempotencyOwnerHash: row.idempotency_owner_hash,
    requestFingerprint: row.request_fingerprint,
    roomId: row.room_id,
    mode: row.mode,
    status: row.status,
    theme: row.theme,
    themeSlug: row.theme_slug,
    relatedCategories: row.related_categories,
    playerCount: row.player_count,
    questionCount: row.question_count,
    themedQuestionTarget: row.themed_question_target,
    relatedQuestionTarget: row.related_question_target,
    candidateCeiling: row.candidate_ceiling,
    openingQuestionTarget: row.opening_question_target,
    openingThemedTarget: row.opening_themed_target,
    openingRelatedTarget: row.opening_related_target,
    mixConsentStatus: row.mix_consent_status,
    acceptedThemedTarget: row.accepted_themed_target,
    acceptedRelatedTarget: row.accepted_related_target,
    rosterLockedAt: row.roster_locked_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapJob(row: JobRow): ThemeJobRecord {
  return {
    id: row.id,
    contractVersion: row.contract_version,
    gameId: row.game_id,
    stableKey: row.stable_key,
    status: row.status,
    publicStage: row.public_stage,
    candidateCeiling: row.candidate_ceiling,
    candidatesUsed: row.candidates_used,
    readyCount: row.ready_count,
    themedReadyCount: row.themed_ready_count,
    relatedReadyCount: row.related_ready_count,
    lastFailure: row.last_failure,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function selectGameByKey(client: PoolClient, key: string): Promise<ThemeGameRecord | null> {
  const result = await client.query<GameRow>(
    'SELECT * FROM theme_game_sessions WHERE idempotency_key = $1',
    [key]
  );
  return result.rows[0] ? mapGame(result.rows[0]) : null;
}

async function selectJob(client: PoolClient, jobId: string): Promise<ThemeJobRecord | null> {
  const result = await client.query<JobRow>('SELECT * FROM theme_preparation_jobs WHERE id = $1', [
    jobId,
  ]);
  return result.rows[0] ? mapJob(result.rows[0]) : null;
}

async function selectJobForGame(
  client: PoolClient,
  gameId: string
): Promise<ThemeJobRecord | null> {
  const result = await client.query<JobRow>(
    'SELECT * FROM theme_preparation_jobs WHERE game_id = $1',
    [gameId]
  );
  return result.rows[0] ? mapJob(result.rows[0]) : null;
}

export function createPostgresThemeLifecycleRepository(
  pool: Pick<Pool, 'connect'>
): ThemeLifecycleRepository {
  return {
    async createGameWithRosterAndJob(input) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const plan = themeGamePlanFor(input.request.playerCount);
        const inserted = await client.query<GameRow>(
          `INSERT INTO theme_game_sessions
             (contract_version, idempotency_key, idempotency_owner_hash, request_fingerprint,
              room_id, mode, status, theme, theme_slug, related_categories, player_count,
              question_count, themed_question_target, related_question_target, candidate_ceiling,
              opening_question_target, opening_themed_target, opening_related_target,
              roster_locked_at, expires_at, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'preflight', $7, $8, $9::jsonb, $10,
                   $11, $12, $13, $14, $15, $16, $17, $18, $19, $18, $18)
           ON CONFLICT (idempotency_key) DO NOTHING
           RETURNING *`,
          [
            input.request.contractVersion,
            input.request.idempotencyKey,
            input.idempotencyOwnerHash,
            input.requestFingerprint,
            input.roomId,
            input.request.mode,
            input.request.theme,
            input.request.themeSlug,
            JSON.stringify(input.request.relatedCategories),
            input.request.playerCount,
            plan.questionCount,
            plan.themedQuestionTarget,
            plan.relatedQuestionTarget,
            plan.candidateCeiling,
            plan.openingQuestionTarget,
            plan.openingThemedTarget,
            plan.openingRelatedTarget,
            input.now,
            input.expiresAt,
          ]
        );

        let game = inserted.rows[0] ? mapGame(inserted.rows[0]) : null;
        const created = Boolean(game);
        if (!game) {
          game = await selectGameByKey(client, input.request.idempotencyKey);
          if (!game) throw new Error('Idempotent game row was not visible after conflict');
          if (
            game.idempotencyOwnerHash !== input.idempotencyOwnerHash ||
            game.requestFingerprint !== input.requestFingerprint
          ) {
            throw new ThemeLifecycleError(
              'idempotency_conflict',
              'Idempotency key belongs to a different owner or request'
            );
          }
        }

        if (created) {
          for (const member of input.roster) {
            await client.query(
              `INSERT INTO theme_game_participants
                 (game_id, identity_id, room_player_id, seat, joined_at)
               VALUES ($1, $2, $3, $4, $5)`,
              [game.id, member.identityId, member.roomPlayerId ?? null, member.seat, input.now]
            );
          }
          await client.query(
            `INSERT INTO theme_preparation_jobs
               (contract_version, game_id, stable_key, status, public_stage,
                candidate_ceiling, created_at, updated_at)
             VALUES ($1, $2, $3, 'queued', 'waiting', $4, $5, $5)`,
            [
              game.contractVersion,
              game.id,
              `theme-game:${game.id}:prepare-v1`,
              game.candidateCeiling,
              input.now,
            ]
          );
        }

        const job = await selectJobForGame(client, game.id);
        if (!job) throw new Error('Theme preparation job missing for game');
        await client.query('COMMIT');
        return { game, job, created };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async getGame(gameId) {
      const client = await pool.connect();
      try {
        const result = await client.query<GameRow>(
          'SELECT * FROM theme_game_sessions WHERE id = $1',
          [gameId]
        );
        return result.rows[0] ? mapGame(result.rows[0]) : null;
      } finally {
        client.release();
      }
    },

    async getJob(jobId) {
      const client = await pool.connect();
      try {
        return await selectJob(client, jobId);
      } finally {
        client.release();
      }
    },

    async isGameAvailable(gameId) {
      const client = await pool.connect();
      try {
        const result = await client.query<{ available: boolean }>(
          `SELECT EXISTS (
             SELECT 1
               FROM theme_game_sessions
              WHERE id = $1
                AND status <> ALL($2::varchar[])
                AND expires_at > clock_timestamp()
           ) AS available`,
          [gameId, THEME_TERMINAL_GAME_STATUSES]
        );
        return result.rows[0]?.available ?? false;
      } finally {
        client.release();
      }
    },

    async acquireLease(input) {
      const client = await pool.connect();
      try {
        const result = await client.query<JobRow>(
          `UPDATE theme_preparation_jobs AS job
              SET lease_owner = $2,
                  lease_expires_at = clock_timestamp() + ($3::bigint * interval '1 millisecond'),
                  started_at = COALESCE(job.started_at, clock_timestamp()),
                  updated_at = clock_timestamp()
             FROM theme_game_sessions AS game
            WHERE job.id = $1
              AND game.id = job.game_id
              AND job.status <> ALL($4::varchar[])
              AND game.status <> ALL($5::varchar[])
              AND game.expires_at > clock_timestamp()
              AND (job.lease_owner IS NULL OR job.lease_expires_at <= clock_timestamp())
          RETURNING job.*`,
          [
            input.jobId,
            input.claimToken,
            input.leaseDurationMs,
            THEME_TERMINAL_JOB_STATUSES,
            THEME_TERMINAL_GAME_STATUSES,
          ]
        );
        return result.rows[0] ? mapJob(result.rows[0]) : null;
      } finally {
        client.release();
      }
    },

    async renewLease(input) {
      const client = await pool.connect();
      try {
        const result = await client.query<JobRow>(
          `UPDATE theme_preparation_jobs AS job
              SET lease_expires_at = clock_timestamp() + ($3::bigint * interval '1 millisecond'),
                  updated_at = clock_timestamp()
             FROM theme_game_sessions AS game
            WHERE job.id = $1
              AND game.id = job.game_id
              AND job.lease_owner = $2
              AND job.lease_expires_at > clock_timestamp()
              AND job.status <> ALL($4::varchar[])
              AND game.status <> ALL($5::varchar[])
              AND game.expires_at > clock_timestamp()
          RETURNING job.*`,
          [
            input.jobId,
            input.claimToken,
            input.leaseDurationMs,
            THEME_TERMINAL_JOB_STATUSES,
            THEME_TERMINAL_GAME_STATUSES,
          ]
        );
        return result.rows[0] ? mapJob(result.rows[0]) : null;
      } finally {
        client.release();
      }
    },

    async releaseLease(input) {
      const client = await pool.connect();
      try {
        const result = await client.query<JobRow>(
          `UPDATE theme_preparation_jobs AS job
              SET lease_owner = NULL, lease_expires_at = NULL, updated_at = clock_timestamp()
            WHERE job.id = $1 AND job.lease_owner = $2
              AND job.lease_expires_at > clock_timestamp()
              AND job.status <> ALL($3::varchar[])
          RETURNING job.*`,
          [input.jobId, input.claimToken, THEME_TERMINAL_JOB_STATUSES]
        );
        return result.rows[0] ? mapJob(result.rows[0]) : null;
      } finally {
        client.release();
      }
    },

    async transitionJob(input) {
      const client = await pool.connect();
      try {
        const result = await client.query<JobRow>(
          `UPDATE theme_preparation_jobs AS job
              SET status = $3, public_stage = $4, updated_at = clock_timestamp()
             FROM theme_game_sessions AS game
            WHERE job.id = $1
              AND game.id = job.game_id
              AND job.lease_owner = $2
              AND job.lease_expires_at > clock_timestamp()
              AND job.status = $5
              AND game.status <> ALL($6::varchar[])
              AND game.expires_at > clock_timestamp()
          RETURNING job.*`,
          [
            input.jobId,
            input.claimToken,
            input.status,
            input.publicStage,
            input.expectedStatus,
            THEME_TERMINAL_GAME_STATUSES,
          ]
        );
        return result.rows[0] ? mapJob(result.rows[0]) : null;
      } finally {
        client.release();
      }
    },

    async terminalizeJob(input) {
      const client = await pool.connect();
      try {
        const result = await client.query<JobRow>(
          `UPDATE theme_preparation_jobs AS job
              SET status = $2, public_stage = $3, completed_at = clock_timestamp(),
                  lease_owner = NULL, lease_expires_at = NULL, updated_at = clock_timestamp()
            WHERE job.id = $1 AND job.status = $4
              AND job.status <> ALL($5::varchar[])
          RETURNING job.*`,
          [
            input.jobId,
            input.status,
            input.publicStage,
            input.expectedStatus,
            THEME_TERMINAL_JOB_STATUSES,
          ]
        );
        return result.rows[0] ? mapJob(result.rows[0]) : null;
      } finally {
        client.release();
      }
    },
  };
}
