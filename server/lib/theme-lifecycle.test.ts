import { createHash } from 'node:crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import { THEME_RELIABILITY_CONTRACT_VERSION } from '@shared/models/theme-evidence';

import {
  ThemeLifecycleError,
  canTransitionThemeJob,
  createThemeLifecycleService,
  projectPublicThemeJob,
  publicStageForThemeJob,
  type CreateThemeLifecycleInput,
  type ThemeGameRecord,
  type ThemeJobRecord,
  type ThemeLifecycleRepository,
} from './theme-lifecycle';

const NOW = new Date('2026-09-26T12:00:00.000Z');
const GAME_ID = '10000000-0000-4000-8000-000000000001';
const JOB_ID = '20000000-0000-4000-8000-000000000001';
const IDENTITIES = [
  '30000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000003',
  '30000000-0000-4000-8000-000000000004',
];

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

function createInput(playerCount: 2 | 3 | 4 = 2): CreateThemeLifecycleInput {
  return {
    request: {
      contractVersion: THEME_RELIABILITY_CONTRACT_VERSION,
      idempotencyKey: 'theme-game-request-0001',
      mode: 'multiplayer',
      theme: 'Baseball history',
      themeSlug: 'baseball-history',
      relatedCategories: ['Sports'],
      playerCount,
    },
    ownerKey: 'browser-owner-1',
    roomId: null,
    roster: IDENTITIES.slice(0, playerCount).map((identityId) => ({ identityId })),
    expiresAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
  };
}

class MemoryRepository implements ThemeLifecycleRepository {
  game: ThemeGameRecord | null = null;
  job: ThemeJobRecord | null = null;
  participantCount = 0;
  createCalls = 0;

  async createGameWithRosterAndJob(
    input: Parameters<ThemeLifecycleRepository['createGameWithRosterAndJob']>[0]
  ) {
    this.createCalls += 1;
    if (this.game && this.job) {
      if (
        this.game.idempotencyOwnerHash !== input.idempotencyOwnerHash ||
        this.game.requestFingerprint !== input.requestFingerprint
      ) {
        throw new ThemeLifecycleError(
          'idempotency_conflict',
          'Idempotency key belongs to a different owner or request'
        );
      }
      return { game: this.game, job: this.job, created: false };
    }

    const plan = {
      2: [40, 30, 10, 50, 16, 12, 4],
      3: [60, 45, 15, 75, 24, 18, 6],
      4: [80, 60, 20, 100, 32, 24, 8],
    }[input.request.playerCount];
    this.game = {
      id: GAME_ID,
      contractVersion: input.request.contractVersion,
      idempotencyKey: input.request.idempotencyKey,
      idempotencyOwnerHash: input.idempotencyOwnerHash,
      requestFingerprint: input.requestFingerprint,
      roomId: input.roomId,
      mode: input.request.mode,
      status: 'preflight',
      theme: input.request.theme,
      themeSlug: input.request.themeSlug,
      relatedCategories: input.request.relatedCategories,
      playerCount: input.request.playerCount,
      questionCount: plan[0],
      themedQuestionTarget: plan[1],
      relatedQuestionTarget: plan[2],
      candidateCeiling: plan[3],
      openingQuestionTarget: plan[4],
      openingThemedTarget: plan[5],
      openingRelatedTarget: plan[6],
      mixConsentStatus: 'not_required',
      acceptedThemedTarget: null,
      acceptedRelatedTarget: null,
      rosterLockedAt: input.now,
      expiresAt: input.expiresAt,
      createdAt: input.now,
      updatedAt: input.now,
    };
    this.job = {
      id: JOB_ID,
      contractVersion: input.request.contractVersion,
      gameId: GAME_ID,
      stableKey: `theme-game:${GAME_ID}:prepare-v1`,
      status: 'queued',
      publicStage: 'waiting',
      candidateCeiling: plan[3],
      candidatesUsed: 0,
      readyCount: 0,
      themedReadyCount: 0,
      relatedReadyCount: 0,
      lastFailure: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      startedAt: null,
      completedAt: null,
      createdAt: input.now,
      updatedAt: input.now,
    };
    this.participantCount = input.roster.length;
    return { game: this.game, job: this.job, created: true };
  }

  async getGame(gameId: string) {
    return this.game?.id === gameId ? this.game : null;
  }

  async getJob(jobId: string) {
    return this.job?.id === jobId ? this.job : null;
  }

  async acquireLease(input: Parameters<ThemeLifecycleRepository['acquireLease']>[0]) {
    if (!this.job || this.job.id !== input.jobId) return null;
    if (['completed', 'failed', 'canceled', 'expired'].includes(this.job.status)) return null;
    if (
      !this.game ||
      ['completed', 'failed', 'abandoned', 'expired'].includes(this.game.status) ||
      this.game.expiresAt <= input.now
    ) {
      return null;
    }
    if (this.job.leaseOwner && this.job.leaseExpiresAt && this.job.leaseExpiresAt > input.now)
      return null;
    this.job = {
      ...this.job,
      leaseOwner: input.claimToken,
      leaseExpiresAt: new Date(input.now.getTime() + input.leaseDurationMs),
      startedAt: this.job.startedAt ?? input.now,
      updatedAt: input.now,
    };
    return this.job;
  }

  async renewLease(input: Parameters<ThemeLifecycleRepository['renewLease']>[0]) {
    if (
      !this.job ||
      this.job.id !== input.jobId ||
      this.job.leaseOwner !== input.claimToken ||
      !this.job.leaseExpiresAt ||
      this.job.leaseExpiresAt <= input.now ||
      !this.game ||
      ['completed', 'failed', 'abandoned', 'expired'].includes(this.game.status) ||
      this.game.expiresAt <= input.now
    ) {
      return null;
    }
    this.job = {
      ...this.job,
      leaseExpiresAt: new Date(input.now.getTime() + input.leaseDurationMs),
      updatedAt: input.now,
    };
    return this.job;
  }

  async releaseLease(input: Parameters<ThemeLifecycleRepository['releaseLease']>[0]) {
    if (
      !this.job ||
      this.job.id !== input.jobId ||
      this.job.leaseOwner !== input.claimToken ||
      !this.job.leaseExpiresAt ||
      this.job.leaseExpiresAt <= input.now
    ) {
      return null;
    }
    this.job = { ...this.job, leaseOwner: null, leaseExpiresAt: null, updatedAt: input.now };
    return this.job;
  }

  async transitionJob(input: Parameters<ThemeLifecycleRepository['transitionJob']>[0]) {
    if (
      !this.job ||
      this.job.id !== input.jobId ||
      this.job.status !== input.expectedStatus ||
      this.job.leaseOwner !== input.claimToken ||
      !this.job.leaseExpiresAt ||
      this.job.leaseExpiresAt <= input.now ||
      !this.game ||
      ['completed', 'failed', 'abandoned', 'expired'].includes(this.game.status) ||
      this.game.expiresAt <= input.now
    ) {
      return null;
    }
    this.job = {
      ...this.job,
      status: input.status,
      publicStage: input.publicStage,
      updatedAt: input.now,
    };
    return this.job;
  }

  async terminalizeJob(input: Parameters<ThemeLifecycleRepository['terminalizeJob']>[0]) {
    if (
      !this.job ||
      this.job.id !== input.jobId ||
      this.job.status !== input.expectedStatus ||
      ['completed', 'failed', 'canceled', 'expired'].includes(this.job.status)
    ) {
      return null;
    }
    this.job = {
      ...this.job,
      status: input.status,
      publicStage: input.publicStage,
      completedAt: input.now,
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: input.now,
    };
    return this.job;
  }
}

describe('theme lifecycle creation', () => {
  let repository: MemoryRepository;

  beforeEach(() => {
    repository = new MemoryRepository();
  });

  it.each([2, 3, 4] as const)(
    'prepares an exact %s-player roster with one queued job for repository creation',
    async (playerCount) => {
      const service = createThemeLifecycleService({ repository, now: () => NOW, hash: sha256 });
      const result = await service.createGame(createInput(playerCount));

      expect(result.created).toBe(true);
      expect(result.game).toMatchObject({
        playerCount,
        status: 'preflight',
        rosterLockedAt: NOW,
      });
      expect(result.job).toMatchObject({ status: 'queued', publicStage: 'waiting' });
      expect(repository.participantCount).toBe(playerCount);
    }
  );

  it('returns the original game and job for an exact owner-bound retry', async () => {
    const service = createThemeLifecycleService({ repository, now: () => NOW, hash: sha256 });
    const first = await service.createGame(createInput());
    const second = await service.createGame(createInput());

    expect(second).toEqual({ ...first, created: false });
    expect(repository.participantCount).toBe(2);
  });

  it('rejects reuse by a different owner or changed roster', async () => {
    const service = createThemeLifecycleService({ repository, now: () => NOW, hash: sha256 });
    await service.createGame(createInput());

    await expect(
      service.createGame({ ...createInput(), ownerKey: 'browser-owner-2' })
    ).rejects.toMatchObject({ code: 'idempotency_conflict' });

    const changed = createInput();
    changed.roster = [changed.roster[1], changed.roster[0]];
    await expect(service.createGame(changed)).rejects.toMatchObject({
      code: 'idempotency_conflict',
    });
  });

  it('rejects a roster that does not exactly match the declared player count', async () => {
    const service = createThemeLifecycleService({ repository, now: () => NOW, hash: sha256 });
    const input = createInput(3);
    input.roster.pop();
    await expect(service.createGame(input)).rejects.toMatchObject({ code: 'invalid_roster' });
  });

  it('rejects invalid creation times and expiries', async () => {
    const badClock = createThemeLifecycleService({
      repository,
      now: () => new Date(Number.NaN),
      hash: sha256,
    });
    await expect(badClock.createGame(createInput())).rejects.toMatchObject({
      code: 'invalid_time',
    });

    const service = createThemeLifecycleService({ repository, now: () => NOW, hash: sha256 });
    await expect(
      service.createGame({ ...createInput(), expiresAt: new Date(Number.NaN) })
    ).rejects.toMatchObject({ code: 'invalid_time' });
  });
});

describe('theme job leases', () => {
  it('rejects a competing worker and lets a fresh token reclaim an expired lease', async () => {
    const repository = new MemoryRepository();
    let currentTime = NOW;
    const tokens = ['claim-a', 'claim-b', 'claim-c'];
    const service = createThemeLifecycleService({
      repository,
      now: () => currentTime,
      claimToken: () => tokens.shift()!,
      hash: sha256,
    });
    await service.createGame(createInput());

    const first = await service.acquireLease(JOB_ID, 1_000);
    expect(first.claimToken).toBe('claim-a');
    await expect(service.acquireLease(JOB_ID, 1_000)).rejects.toMatchObject({
      code: 'lease_unavailable',
    });

    currentTime = new Date(NOW.getTime() + 1_001);
    const reclaimed = await service.acquireLease(JOB_ID, 1_000);
    expect(reclaimed.claimToken).toBe('claim-c');
    await expect(service.renewLease(JOB_ID, 'claim-a', 1_000)).rejects.toMatchObject({
      code: 'stale_lease',
    });
  });

  it('renews and releases only a current unexpired token', async () => {
    const repository = new MemoryRepository();
    const service = createThemeLifecycleService({
      repository,
      now: () => NOW,
      claimToken: () => 'claim-a',
      hash: sha256,
    });
    await service.createGame(createInput());
    await service.acquireLease(JOB_ID, 1_000);

    const renewed = await service.renewLease(JOB_ID, 'claim-a', 2_000);
    expect(renewed.leaseExpiresAt).toEqual(new Date(NOW.getTime() + 2_000));
    expect((await service.releaseLease(JOB_ID, 'claim-a')).leaseOwner).toBeNull();
    await expect(service.releaseLease(JOB_ID, 'claim-a')).rejects.toMatchObject({
      code: 'stale_lease',
    });
  });

  it('rejects lease overflow and an invalid injected clock', async () => {
    const repository = new MemoryRepository();
    const service = createThemeLifecycleService({
      repository,
      now: () => NOW,
      claimToken: () => 'claim-a',
      hash: sha256,
    });
    await service.createGame(createInput());
    await expect(service.acquireLease(JOB_ID, Number.MAX_SAFE_INTEGER)).rejects.toMatchObject({
      code: 'invalid_time',
    });

    const badClock = createThemeLifecycleService({
      repository,
      now: () => new Date(Number.NaN),
      claimToken: () => 'claim-b',
    });
    await expect(badClock.acquireLease(JOB_ID, 1_000)).rejects.toMatchObject({
      code: 'invalid_time',
    });
  });

  it('blocks work on a terminal parent but retains explicit job terminalization', async () => {
    const repository = new MemoryRepository();
    const service = createThemeLifecycleService({
      repository,
      now: () => NOW,
      claimToken: () => 'claim-a',
      hash: sha256,
    });
    await service.createGame(createInput());
    await service.acquireLease(JOB_ID, 10_000);
    repository.game = { ...repository.game!, status: 'expired' };

    await expect(service.renewLease(JOB_ID, 'claim-a', 1_000)).rejects.toMatchObject({
      code: 'stale_lease',
    });
    await expect(service.transitionJob(JOB_ID, 'claim-a', 'researching')).rejects.toMatchObject({
      code: 'game_unavailable',
    });
    expect((await service.terminalizeJob(JOB_ID, 'expired')).status).toBe('expired');
    expect((await service.terminalizeJob(JOB_ID, 'expired')).status).toBe('expired');
  });
});

describe('theme job state policy and public projection', () => {
  it('allows explicit forward transitions and protects terminal jobs', async () => {
    const repository = new MemoryRepository();
    const service = createThemeLifecycleService({
      repository,
      now: () => NOW,
      claimToken: () => 'claim-a',
      hash: sha256,
    });
    await service.createGame(createInput());
    await service.acquireLease(JOB_ID, 10_000);

    expect(canTransitionThemeJob('queued', 'researching')).toBe(true);
    expect(publicStageForThemeJob('researching')).toBe('researching');
    expect((await service.transitionJob(JOB_ID, 'claim-a', 'researching')).status).toBe(
      'researching'
    );
    await expect(service.transitionJob(JOB_ID, 'claim-a', 'ready')).rejects.toMatchObject({
      code: 'illegal_transition',
    });

    repository.job = { ...repository.job!, status: 'failed' };
    await expect(service.transitionJob(JOB_ID, 'claim-a', 'waiting')).rejects.toMatchObject({
      code: 'terminal_job',
    });
  });

  it('rejects a stale worker during transition', async () => {
    const repository = new MemoryRepository();
    const service = createThemeLifecycleService({
      repository,
      now: () => NOW,
      claimToken: () => 'claim-a',
      hash: sha256,
    });
    await service.createGame(createInput());
    await service.acquireLease(JOB_ID, 10_000);

    await expect(service.transitionJob(JOB_ID, 'claim-b', 'researching')).rejects.toMatchObject({
      code: 'stale_lease',
    });
  });

  it('keeps canStart false until both lifecycle and opening mix are ready', async () => {
    const repository = new MemoryRepository();
    const service = createThemeLifecycleService({ repository, now: () => NOW, hash: sha256 });
    const { game, job } = await service.createGame(createInput());

    expect(projectPublicThemeJob(game, job, NOW).progress.canStart).toBe(false);
    const readyGame = { ...game, status: 'ready' as const };
    const shortJob = {
      ...job,
      status: 'ready' as const,
      publicStage: 'ready' as const,
      readyCount: 16,
      themedReadyCount: 13,
      relatedReadyCount: 3,
    };
    expect(projectPublicThemeJob(readyGame, shortJob, NOW).progress.canStart).toBe(false);

    const readyJob = { ...shortJob, themedReadyCount: 12, relatedReadyCount: 4 };
    expect(projectPublicThemeJob(readyGame, readyJob, NOW).progress.canStart).toBe(true);
  });

  it('keeps canStart false without a locked roster or after game expiry', async () => {
    const repository = new MemoryRepository();
    const service = createThemeLifecycleService({ repository, now: () => NOW, hash: sha256 });
    const { game, job } = await service.createGame(createInput());
    const readyGame = { ...game, status: 'ready' as const };
    const readyJob = {
      ...job,
      status: 'ready' as const,
      publicStage: 'ready' as const,
      readyCount: 16,
      themedReadyCount: 12,
      relatedReadyCount: 4,
    };

    expect(
      projectPublicThemeJob({ ...readyGame, rosterLockedAt: null }, readyJob, NOW).progress.canStart
    ).toBe(false);
    expect(
      projectPublicThemeJob({ ...readyGame, expiresAt: new Date(NOW.getTime() - 1) }, readyJob, NOW)
        .progress.canStart
    ).toBe(false);
  });

  it('uses complete persisted accepted targets and fails closed on an incomplete decision', async () => {
    const repository = new MemoryRepository();
    const service = createThemeLifecycleService({ repository, now: () => NOW, hash: sha256 });
    const { game, job } = await service.createGame(createInput());
    const acceptedGame = {
      ...game,
      status: 'ready' as const,
      mixConsentStatus: 'accepted' as const,
      acceptedThemedTarget: 20,
      acceptedRelatedTarget: 20,
    };
    const fullAcceptedJob = {
      ...job,
      status: 'ready' as const,
      publicStage: 'ready' as const,
      readyCount: 40,
      themedReadyCount: 20,
      relatedReadyCount: 20,
    };

    expect(projectPublicThemeJob(acceptedGame, fullAcceptedJob, NOW).progress.canStart).toBe(true);
    expect(
      projectPublicThemeJob({ ...acceptedGame, acceptedRelatedTarget: null }, fullAcceptedJob, NOW)
        .progress.canStart
    ).toBe(false);
    expect(
      projectPublicThemeJob(
        acceptedGame,
        { ...fullAcceptedJob, readyCount: 39, themedReadyCount: 19 },
        NOW
      ).progress.canStart
    ).toBe(false);
  });

  it('rejects an invalid explicit projection time', async () => {
    const repository = new MemoryRepository();
    const service = createThemeLifecycleService({ repository, now: () => NOW, hash: sha256 });
    const { game, job } = await service.createGame(createInput());
    expect(() => projectPublicThemeJob(game, job, new Date(Number.NaN))).toThrow(
      'Projection time must be a valid Date'
    );
  });

  it('rejects a progress projection from a job belonging to another game', async () => {
    const repository = new MemoryRepository();
    const service = createThemeLifecycleService({ repository, now: () => NOW, hash: sha256 });
    const { game, job } = await service.createGame(createInput());

    expect(() =>
      projectPublicThemeJob(
        game,
        {
          ...job,
          gameId: '10000000-0000-4000-8000-000000000099',
        },
        NOW
      )
    ).toThrow('Theme job does not match its enclosing game contract');
  });

  it('projects failures without exposing internal provider details', async () => {
    const repository = new MemoryRepository();
    const service = createThemeLifecycleService({ repository, now: () => NOW, hash: sha256 });
    const { game, job } = await service.createGame(createInput());
    const failed: ThemeJobRecord = {
      ...job,
      status: 'failed',
      publicStage: 'failed',
      lastFailure: {
        contractVersion: THEME_RELIABILITY_CONTRACT_VERSION,
        code: 'provider_timeout',
        retryable: true,
        operation: 'generate',
        provider: 'secret-provider',
        httpStatus: 504,
        candidateOrdinal: 1,
      },
    };

    const projected = projectPublicThemeJob(game, failed, NOW);
    expect(projected.progress.failure).toEqual({
      code: 'preparation_failed',
      retryable: true,
      message: 'Theme preparation could not be completed.',
    });
    expect(JSON.stringify(projected)).not.toContain('secret-provider');
  });
});
