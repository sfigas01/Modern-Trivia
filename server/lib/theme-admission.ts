import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { VALID_CATEGORIES } from '@shared/constants/categories';
import {
  THEME_RELIABILITY_CONTRACT_VERSION,
  questionContentSnapshotSchema,
} from '@shared/models/theme-evidence';
import { THEME_QUESTION_QA_POLICY_VERSION } from './theme-question-qa';
import type { PublicThemeJob } from '@shared/models/theme';
import {
  createPostgresThemeLifecycleRepository,
  createThemeLifecycleInTransaction,
  prepareThemeLifecycleCreate,
  projectPublicThemeJob,
} from './theme-lifecycle';
import { hashQuestionSnapshot } from './theme-evidence-eligibility';
import {
  createPostgresThemeQuestionEvidenceReviewRepository,
  ThemeQuestionEvidenceReviewError,
  type ThemeQuestionEvidenceReviewConfig,
} from './theme-question-evidence-review';

export class ThemeAdmissionError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}
export const themeSubjectHash = (value: string) => createHash('sha256').update(value).digest('hex');
const subject = z.string().uuid();

type SqlQuery = Pick<PoolClient, 'query'>;

/** The account ID must come from the authenticated session, never a request field. */
export async function resolveThemeIdentity(
  db: SqlQuery,
  input: { userId?: string | null; stableGuestSubjectId?: string }
): Promise<string> {
  const guestId =
    input.stableGuestSubjectId === undefined
      ? undefined
      : subject.parse(input.stableGuestSubjectId);
  if (!input.userId && !guestId)
    throw new ThemeAdmissionError(422, 'A stable browser identity is required for themed guests');
  const kind = input.userId ? 'account' : 'guest_browser';
  const hash = themeSubjectHash(input.userId ? `account:${input.userId}` : `guest:${guestId}`);
  const result = await db.query(
    `INSERT INTO theme_participant_identities (kind, stable_key_hash, account_user_id)
     VALUES ($1,$2,$3) ON CONFLICT (kind,stable_key_hash)
     DO UPDATE SET last_seen_at = clock_timestamp() RETURNING id`,
    [kind, hash, input.userId ?? null]
  );
  const identityId = String(result.rows[0].id);
  // Preserve this browser's prior guest history when it signs in. Opaque browser
  // subjects only link to the account actually authenticated by the server.
  if (input.userId && guestId) {
    const guest = await db.query(
      `INSERT INTO theme_participant_identities(kind,stable_key_hash)
       VALUES ('guest_browser',$1) ON CONFLICT (kind,stable_key_hash)
       DO UPDATE SET last_seen_at=clock_timestamp() RETURNING id`,
      [themeSubjectHash(`guest:${guestId}`)]
    );
    await db.query(
      `INSERT INTO theme_identity_links(source_identity_id,target_identity_id)
       VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [guest.rows[0].id, identityId]
    );
  }
  return identityId;
}

/** Union linked subjects in both directions; lock in a stable order before history/reservations. */
async function historySubjects(db: SqlQuery, identities: string[]): Promise<string[]> {
  const rows = await db.query(
    `WITH RECURSIVE subjects(id) AS (
       SELECT unnest($1::uuid[])
       UNION
       SELECT CASE WHEN link.source_identity_id = subjects.id THEN link.target_identity_id
                   ELSE link.source_identity_id END
       FROM subjects JOIN theme_identity_links link
         ON link.source_identity_id = subjects.id OR link.target_identity_id = subjects.id
     ) SELECT id FROM subjects ORDER BY id`,
    [identities]
  );
  const ids = rows.rows.map((row) => String(row.id));
  await db.query(
    'SELECT id FROM theme_participant_identities WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE',
    [ids]
  );
  return ids;
}

export async function loadThemeHistory(db: SqlQuery, identities: string[], at: Date) {
  const rows = await db.query(
    `WITH last_games AS (
       SELECT DISTINCT game_id FROM (
         SELECT game_id, row_number() OVER (PARTITION BY identity_id ORDER BY max(displayed_at) DESC, game_id) AS ordinal
         FROM theme_question_exposures WHERE identity_id=ANY($1::uuid[]) GROUP BY identity_id,game_id
       ) recent WHERE ordinal <= 5
     ), history AS (
       SELECT question_id,fact_id FROM theme_question_exposures
       WHERE identity_id=ANY($1::uuid[]) AND (displayed_at > $2::timestamptz - interval '30 days'
         OR game_id IN (SELECT game_id FROM last_games))
       UNION
       SELECT seen.question_id,c.fact_id FROM seen_questions seen
       JOIN theme_participant_identities identity ON identity.account_user_id=seen.user_id
       LEFT JOIN theme_question_approvals approval ON approval.library_question_id=seen.question_id
       LEFT JOIN theme_candidates c ON c.id=approval.candidate_id
       WHERE identity.id=ANY($1::uuid[]) AND seen.seen_at > $2::timestamptz - interval '30 days'
     ) SELECT question_id,fact_id FROM history`,
    [identities, at]
  );
  return {
    questionIds: new Set(rows.rows.map((row) => String(row.question_id))),
    factIds: new Set(rows.rows.filter((row) => row.fact_id).map((row) => String(row.fact_id))),
  };
}

function liveSnapshot(row: Record<string, unknown>, content: Record<string, unknown>) {
  return questionContentSnapshotSchema.parse({
    themeSlug: content.themeSlug,
    category: row.category,
    difficulty: row.difficulty,
    question: row.question,
    answer: row.answer,
    acceptableAnswers: row.acceptable_answers ?? [],
    explanation: row.explanation,
    pillar: row.pillar,
    tags: row.tags ?? [],
  });
}

export function createThemeAdmission(
  pool: Pool,
  options: { evidence?: ThemeQuestionEvidenceReviewConfig } = {}
) {
  const lifecycle = createPostgresThemeLifecycleRepository(pool);
  const evidence = options.evidence
    ? createPostgresThemeQuestionEvidenceReviewRepository(pool, options.evidence)
    : null;
  async function project(gameId: string): Promise<PublicThemeJob> {
    const game = await lifecycle.getGame(gameId);
    const row = (
      await pool.query('SELECT id FROM theme_preparation_jobs WHERE game_id=$1', [gameId])
    ).rows[0];
    const job = row ? await lifecycle.getJob(String(row.id)) : null;
    if (!game || !job) throw new ThemeAdmissionError(404, 'Theme preparation not found');
    return projectPublicThemeJob(game, job, new Date());
  }
  return {
    async start(input: {
      code: string;
      playerToken: string;
      userId: string;
    }): Promise<PublicThemeJob> {
      const db = await pool.connect();
      let gameId: string;
      try {
        await db.query('BEGIN');
        const room = (await db.query('SELECT * FROM rooms WHERE code=$1 FOR UPDATE', [input.code]))
          .rows[0];
        if (!room || new Date(room.expires_at) <= new Date())
          throw new ThemeAdmissionError(404, 'Room not found or expired');
        const actor = (
          await db.query(
            'SELECT * FROM room_players WHERE room_id=$1 AND token=$2 AND left_at IS NULL',
            [room.id, input.playerToken]
          )
        ).rows[0];
        if (!actor) throw new ThemeAdmissionError(401, 'Invalid player token');
        if (!actor.is_host || actor.id !== room.host_player_id || actor.user_id !== input.userId)
          throw new ThemeAdmissionError(403, 'Sign in as the account that hosts this room');
        if (!room.theme) throw new ThemeAdmissionError(409, 'This room is not a themed room');
        if (room.theme_preparation_game_id) {
          const prior = (
            await db.query('SELECT generation_owner_user_id FROM theme_game_sessions WHERE id=$1', [
              room.theme_preparation_game_id,
            ])
          ).rows[0];
          if (prior?.generation_owner_user_id !== input.userId)
            throw new ThemeAdmissionError(403, 'Theme preparation belongs to another account');
          gameId = room.theme_preparation_game_id;
        } else {
          if (room.status !== 'lobby' || room.phase !== 'LOBBY')
            throw new ThemeAdmissionError(409, 'Game has already started');
          if (room.num_rounds !== 5)
            throw new ThemeAdmissionError(409, 'Themed games require five rounds');
          const players = (
            await db.query(
              'SELECT * FROM room_players WHERE room_id=$1 AND left_at IS NULL ORDER BY join_order FOR UPDATE',
              [room.id]
            )
          ).rows;
          if (![2, 3, 4].includes(players.length))
            throw new ThemeAdmissionError(409, 'Themed games require two to four players');
          const identityIds: string[] = [];
          for (const player of players) {
            // Creation/join already persist the authoritative identity. Admission
            // never upserts subjects in roster order before locking the sorted union.
            const identityId = player.theme_identity_id;
            if (!identityId)
              throw new ThemeAdmissionError(
                409,
                'A participant must rejoin with a stable history identity'
              );
            identityIds.push(identityId);
          }
          if (new Set(identityIds).size !== identityIds.length)
            throw new ThemeAdmissionError(
              409,
              'Each multiplayer participant needs a distinct history identity'
            );
          const subjects = await historySubjects(db, identityIds);
          const at = new Date((await db.query('SELECT clock_timestamp() AS at')).rows[0].at);
          const categories =
            room.category === 'All'
              ? [...VALID_CATEGORIES]
              : z.array(z.enum(VALID_CATEGORIES)).parse(String(room.category).split(','));
          const bundle = await createThemeLifecycleInTransaction(
            db,
            prepareThemeLifecycleCreate(
              {
                ownerKey: `account:${input.userId}`,
                roomId: room.id,
                request: {
                  contractVersion: THEME_RELIABILITY_CONTRACT_VERSION,
                  idempotencyKey: `theme-room:${room.id}:v1`,
                  mode: 'multiplayer',
                  theme: room.theme,
                  themeSlug:
                    String(room.theme)
                      .normalize('NFKD')
                      .replace(/[\u0300-\u036f]/g, '')
                      .toLowerCase()
                      .replace(/[^a-z0-9]+/g, '-')
                      .replace(/^-|-$/g, '') || 'custom-theme',
                  relatedCategories: categories,
                  playerCount: players.length as 2 | 3 | 4,
                },
                roster: identityIds.map((identityId, seat) => ({
                  identityId,
                  roomPlayerId: players[seat].id,
                })),
                expiresAt: new Date(room.expires_at),
              },
              at,
              themeSubjectHash
            )
          );
          gameId = bundle.game.id;
          await db.query('UPDATE theme_game_sessions SET generation_owner_user_id=$2 WHERE id=$1', [
            gameId,
            input.userId,
          ]);
          await db.query(
            'UPDATE rooms SET theme_preparation_game_id=$2,version=version+1,updated_at=clock_timestamp() WHERE id=$1',
            [room.id, gameId]
          );
          // Release elapsed holds while holding all overlapping identity locks.
          await db.query(
            `UPDATE theme_reservation_participants p SET released_at=$2 FROM theme_question_reservations r
          WHERE p.reservation_id=r.id AND p.identity_id=ANY($1::uuid[]) AND p.released_at IS NULL AND r.expires_at <= $2`,
            [subjects, at]
          );
          const history = await loadThemeHistory(db, subjects, at);
          // Guest-provided lists are extra conservative exclusions. Account history
          // always comes from the server; a browser list never establishes identity.
          for (const player of players)
            if (!player.user_id) {
              for (const questionId of player.guest_seen_ids ?? [])
                history.questionIds.add(questionId);
            }
          const rows = evidence
            ? (
                await db.query(
                  `SELECT q.*,a.candidate_id,a.question_revision_id,a.question_content_hash,a.library_revision_id,
                  a.evidence_attempt_id,a.evidence_review_id,a.evidence_fingerprint,c.fact_id,c.fact_revision_id,r.content
           FROM questions q JOIN theme_question_approvals a ON a.library_question_id=q.id
           JOIN theme_candidates c ON c.id=a.candidate_id
           JOIN theme_question_revisions r ON r.id=a.library_revision_id
           WHERE q.status='approved' AND c.status='accepted' AND a.qa_policy_version=$2
             AND q.category=ANY($1::varchar[]) ORDER BY c.fact_id,q.id
           FOR SHARE OF q`,
                  [categories, THEME_QUESTION_QA_POLICY_VERSION]
                )
              ).rows
            : [];
          const chosen: typeof rows = [];
          const facts = new Set<string>();
          for (const row of rows) {
            if (
              history.questionIds.has(row.id) ||
              history.factIds.has(row.fact_id) ||
              facts.has(row.fact_id)
            )
              continue;
            await db.query('SELECT id FROM theme_facts WHERE id=$1 FOR UPDATE', [row.fact_id]);
            await db.query('SELECT id FROM theme_fact_revisions WHERE id=$1 FOR UPDATE', [
              row.fact_revision_id,
            ]);
            await db.query('SELECT id FROM theme_candidates WHERE id=$1 FOR UPDATE', [
              row.candidate_id,
            ]);
            const conflict = await db.query(
              `SELECT 1 FROM theme_reservation_participants WHERE identity_id=ANY($1::uuid[]) AND fact_id=$2 AND released_at IS NULL LIMIT 1`,
              [subjects, row.fact_id]
            );
            if (conflict.rowCount) continue;
            try {
              if (
                hashQuestionSnapshot(liveSnapshot(row, row.content)) !== row.question_content_hash
              )
                continue;
              const context = await evidence!.qaContext(
                {
                  candidateId: row.candidate_id,
                  questionRevisionId: row.question_revision_id,
                  questionContentHash: row.question_content_hash,
                },
                db,
                new Date((await db.query('SELECT clock_timestamp() AS at')).rows[0].at),
                true
              );
              if (
                context.evidenceAttemptId !== row.evidence_attempt_id ||
                context.evidenceReviewId !== row.evidence_review_id ||
                context.evidenceFingerprint !== row.evidence_fingerprint
              )
                continue;
            } catch (error) {
              if (error instanceof ThemeQuestionEvidenceReviewError && error.code === 'ineligible')
                continue;
              if (error instanceof z.ZodError) continue;
              throw error;
            }
            chosen.push(row);
            facts.add(row.fact_id);
            if (chosen.length === bundle.game.questionCount) break;
          }
          if (chosen.length < bundle.game.questionCount) {
            await db.query(`UPDATE theme_game_sessions SET status='waiting' WHERE id=$1`, [gameId]);
            await db.query(
              `UPDATE theme_preparation_jobs SET status='shortfall',public_stage='paused',last_failure=$2,updated_at=clock_timestamp() WHERE id=$1`,
              [
                bundle.job.id,
                JSON.stringify({
                  contractVersion: THEME_RELIABILITY_CONTRACT_VERSION,
                  code: 'inventory_shortfall',
                  retryable: false,
                  operation: null,
                  provider: null,
                  httpStatus: null,
                  candidateOrdinal: null,
                }),
              ]
            );
          } else {
            for (const row of chosen) {
              const reservation = (
                await db.query(
                  `INSERT INTO theme_question_reservations
              (game_id,job_id,question_id,question_revision_id,fact_id,fact_revision_id,role,corpus_revision,history_revision,expires_at)
              VALUES ($1,$2,$3,$4,$5,$6,'related_backup',1,1,$7) RETURNING id`,
                  [
                    gameId,
                    bundle.job.id,
                    row.id,
                    row.library_revision_id,
                    row.fact_id,
                    row.fact_revision_id,
                    room.expires_at,
                  ]
                )
              ).rows[0];
              for (const identityId of subjects)
                await db.query(
                  `INSERT INTO theme_reservation_participants(reservation_id,identity_id,fact_id) VALUES($1,$2,$3)`,
                  [reservation.id, identityId, row.fact_id]
                );
            }
            // Dormant until S11B: no queued job can be picked up for paid work.
            await db.query(`UPDATE theme_game_sessions SET status='waiting' WHERE id=$1`, [gameId]);
            await db.query(
              `UPDATE theme_preparation_jobs SET status='waiting',public_stage='paused' WHERE id=$1`,
              [bundle.job.id]
            );
          }
        }
        await db.query('COMMIT');
      } catch (error) {
        await db.query('ROLLBACK');
        throw error;
      } finally {
        db.release();
      }
      return project(gameId);
    },
    async progress(input: { code: string; playerToken: string }) {
      const result = await pool.query(
        `SELECT room.theme_preparation_game_id AS game_id FROM rooms room
        JOIN room_players player ON player.room_id=room.id
        JOIN theme_game_participants participant ON participant.game_id=room.theme_preparation_game_id AND participant.room_player_id=player.id
        WHERE room.code=$1 AND player.token=$2 AND player.left_at IS NULL AND room.expires_at > clock_timestamp()`,
        [input.code, input.playerToken]
      );
      if (!result.rows[0])
        throw new ThemeAdmissionError(401, 'Valid locked participant token required');
      return project(result.rows[0].game_id);
    },
  };
}

/** Call inside the same locked-room transaction before host end or abandonment. */
export async function cancelThemeAdmission(db: SqlQuery, gameId: string) {
  await db.query(
    `UPDATE theme_game_sessions SET status='abandoned',updated_at=clock_timestamp() WHERE id=$1 AND status NOT IN ('completed','failed','abandoned','expired')`,
    [gameId]
  );
  await db.query(
    `UPDATE theme_preparation_jobs SET status='canceled',public_stage='failed',lease_owner=NULL,lease_expires_at=NULL,completed_at=clock_timestamp() WHERE game_id=$1 AND status NOT IN ('completed','failed','canceled','expired')`,
    [gameId]
  );
  await db.query(
    `UPDATE theme_reservation_participants p SET released_at=clock_timestamp() FROM theme_question_reservations r WHERE p.reservation_id=r.id AND r.game_id=$1 AND p.released_at IS NULL`,
    [gameId]
  );
  await db.query(
    `UPDATE theme_question_reservations SET status='released',released_at=clock_timestamp() WHERE game_id=$1 AND status IN ('held','selected')`,
    [gameId]
  );
}

/** Call inside a transaction. Only selected/displayed questions create authoritative exposure. */
export async function recordThemeExposure(
  db: SqlQuery,
  input: { gameId: string; roomPlayerId: string; displayKey: string; questionId: string }
) {
  const parsed = z
    .object({
      gameId: z.string().uuid(),
      roomPlayerId: z.string().uuid(),
      displayKey: z.string().min(1).max(255),
      questionId: z.string().min(1).max(255),
    })
    .strict()
    .parse(input);
  const participant = (
    await db.query(
      'SELECT identity_id FROM theme_game_participants WHERE game_id=$1 AND room_player_id=$2',
      [parsed.gameId, parsed.roomPlayerId]
    )
  ).rows[0];
  if (!participant) throw new ThemeAdmissionError(409, 'Participant is not in the locked roster');
  await historySubjects(db, [participant.identity_id]);
  const row = (
    await db.query(
      `SELECT p.identity_id,r.fact_id,r.fact_revision_id FROM theme_game_sessions g
    JOIN theme_game_participants p ON p.game_id=g.id
    JOIN theme_question_reservations r ON r.game_id=g.id
    WHERE g.id=$1 AND p.room_player_id=$2 AND p.left_at IS NULL AND r.question_id=$3
      AND g.status='active' AND g.expires_at > clock_timestamp() AND r.status IN ('selected','displayed')
    FOR UPDATE OF g`,
      [parsed.gameId, parsed.roomPlayerId, parsed.questionId]
    )
  ).rows[0];
  if (!row)
    throw new ThemeAdmissionError(409, 'Question is not selected for this active participant');
  const inserted = await db.query(
    `INSERT INTO theme_question_exposures(game_id,identity_id,question_id,fact_id,fact_revision_id,display_key)
    VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (game_id,identity_id,display_key) DO NOTHING RETURNING id`,
    [
      parsed.gameId,
      row.identity_id,
      parsed.questionId,
      row.fact_id,
      row.fact_revision_id,
      parsed.displayKey,
    ]
  );
  if (!inserted.rowCount) {
    const prior = (
      await db.query(
        `SELECT question_id,fact_id FROM theme_question_exposures WHERE game_id=$1 AND identity_id=$2 AND display_key=$3`,
        [parsed.gameId, row.identity_id, parsed.displayKey]
      )
    ).rows[0];
    if (prior?.question_id !== parsed.questionId || prior?.fact_id !== row.fact_id)
      throw new ThemeAdmissionError(409, 'Display key already belongs to another question');
  }
}
