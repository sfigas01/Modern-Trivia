import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { createThemeAdmission, loadThemeHistory, resolveThemeIdentity } from './theme-admission';
import {
  createPostgresThemeLifecycleRepository,
  createThemeLifecycleService,
} from './theme-lifecycle';

const databaseUrl = process.env.THEME_RELIABILITY_MIGRATION_TEST_DATABASE_URL;
// Explicitly opt in only to a disposable database, never the application DATABASE_URL.
describe.runIf(Boolean(databaseUrl))('S11A PostgreSQL admission and history', () => {
  it('serializes competing starts, binds the owner, freezes once, and applies strict history', async () => {
    const schema = `theme_admission_${randomUUID().replaceAll('-', '')}`;
    const admin = new pg.Client({ connectionString: databaseUrl });
    let pool: pg.Pool | undefined;
    let created = false;
    try {
      await admin.connect();
      await admin.query(`CREATE SCHEMA ${schema}`);
      created = true;
      await admin.query(`SET search_path TO ${schema}`);
      await admin.query('CREATE TABLE users(id varchar PRIMARY KEY)');
      await admin.query('CREATE TABLE questions(id varchar PRIMARY KEY,status varchar)');
      await admin.query(
        `CREATE TABLE rooms(id uuid PRIMARY KEY,code varchar,host_player_id uuid,status varchar,phase varchar,theme varchar,category varchar,num_rounds integer,version integer DEFAULT 1,updated_at timestamptz DEFAULT now(),expires_at timestamptz)`
      );
      await admin.query(
        `CREATE TABLE room_players(id uuid PRIMARY KEY,room_id uuid,user_id varchar,token varchar,is_host boolean,left_at timestamptz,join_order integer,guest_seen_ids jsonb)`
      );
      await admin.query(
        `CREATE TABLE seen_questions(user_id varchar,question_id varchar,seen_at timestamp)`
      );
      for (const file of [
        '0009_theme_reliability_foundation.sql',
        '0010_theme_source_registry.sql',
        '0011_theme_fact_derivation_provenance.sql',
        '0012_theme_fact_reviews.sql',
        '0013_theme_question_candidates.sql',
        '0014_theme_question_evidence_reviews.sql',
        '0015_theme_question_repairs.sql',
        '0016_theme_question_approvals.sql',
        '0017_theme_runtime_admission.sql',
      ])
        await admin.query(
          await readFile(new URL(`../../migrations/${file}`, import.meta.url), 'utf8')
        );
      await admin.query(
        await readFile(
          new URL('../../migrations/0017_theme_runtime_admission.sql', import.meta.url),
          'utf8'
        )
      );
      pool = new pg.Pool({
        connectionString: databaseUrl,
        max: 2,
        connectionTimeoutMillis: 2_000,
        statement_timeout: 3_000,
        options: `-c search_path=${schema}`,
      });
      await pool.query("INSERT INTO users VALUES ('host-account'),('other-account')");
      const guestSubject = randomUUID(),
        guestIdentity = await resolveThemeIdentity(pool, { stableGuestSubjectId: guestSubject });
      const secondIdentity = await resolveThemeIdentity(pool, {
        stableGuestSubjectId: guestSubject,
      });
      expect(secondIdentity).toBe(guestIdentity);
      const hostIdentity = await resolveThemeIdentity(pool, { userId: 'host-account' });
      const roomId = randomUUID(),
        hostPlayer = randomUUID(),
        guestPlayer = randomUUID();
      await pool.query(
        `INSERT INTO rooms(id,code,host_player_id,status,phase,theme,category,num_rounds,expires_at) VALUES($1,'ABCD2',$2,'lobby','LOBBY','Planets','Science & Nature',5,clock_timestamp()+interval '1 hour')`,
        [roomId, hostPlayer]
      );
      await pool.query(
        `INSERT INTO room_players(id,room_id,user_id,token,is_host,join_order,theme_identity_id) VALUES($1,$2,'host-account','host-token',true,0,$5),($3,$2,NULL,'guest-token',false,1,$4)`,
        [hostPlayer, roomId, guestPlayer, guestIdentity, hostIdentity]
      );
      const admission = createThemeAdmission(pool);
      const starts = await Promise.all([
        admission.start({ code: 'ABCD2', playerToken: 'host-token', userId: 'host-account' }),
        admission.start({ code: 'ABCD2', playerToken: 'host-token', userId: 'host-account' }),
      ]);
      expect(starts[0].gameId).toBe(starts[1].gameId);
      expect(starts[0].jobId).toBe(starts[1].jobId);
      expect(starts[0].progress).toMatchObject({
        status: 'shortfall',
        canStart: false,
        failure: { code: 'related_inventory_shortfall' },
      });
      // A retry must release its room-lock transaction client before projection.
      // With the original early-return branch, this one-connection pool timed out.
      const retryPool = new pg.Pool({
        connectionString: databaseUrl,
        max: 1,
        connectionTimeoutMillis: 1_000,
        statement_timeout: 2_000,
        options: `-c search_path=${schema}`,
      });
      try {
        const retry = await createThemeAdmission(retryPool).start({
          code: 'ABCD2',
          playerToken: 'host-token',
          userId: 'host-account',
        });
        expect(retry.gameId).toBe(starts[0].gameId);
        expect(retry.jobId).toBe(starts[0].jobId);
      } finally {
        await retryPool.end();
      }
      const counts = (
        await pool.query(
          `SELECT (SELECT count(*)::int FROM theme_game_sessions) AS games,(SELECT count(*)::int FROM theme_preparation_jobs) AS jobs,(SELECT count(*)::int FROM theme_game_participants) AS participants,(SELECT count(*)::int FROM theme_question_reservations) AS reservations,(SELECT count(*)::int FROM theme_question_exposures) AS exposures`
        )
      ).rows[0];
      expect(counts).toEqual({ games: 1, jobs: 1, participants: 2, reservations: 0, exposures: 0 });
      expect(
        (await pool.query('SELECT generation_owner_user_id FROM theme_game_sessions')).rows[0]
          .generation_owner_user_id
      ).toBe('host-account');
      expect(
        (await pool.query('SELECT theme_preparation_game_id FROM rooms')).rows[0]
          .theme_preparation_game_id
      ).toBe(starts[0].gameId);
      await expect(
        admission.start({ code: 'ABCD2', playerToken: 'host-token', userId: 'other-account' })
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        admission.progress({ code: 'ABCD2', playerToken: 'invalid-token' })
      ).rejects.toMatchObject({ status: 401 });
      expect((await admission.progress({ code: 'ABCD2', playerToken: 'guest-token' })).gameId).toBe(
        starts[0].gameId
      );
      await expect(
        pool.query("UPDATE theme_game_sessions SET generation_owner_user_id='other-account'")
      ).rejects.toMatchObject({ code: '55000' });
      const identities = (
        await pool.query('SELECT identity_id FROM theme_game_participants ORDER BY seat')
      ).rows.map((row) => row.identity_id);
      const service = createThemeLifecycleService({
        repository: createPostgresThemeLifecycleRepository(pool),
      });
      await expect(
        service.createGame({
          request: {
            contractVersion: 'theme-reliability-v1',
            idempotencyKey: `different-key:${randomUUID()}`,
            mode: 'multiplayer',
            theme: 'Planets',
            themeSlug: 'planets',
            relatedCategories: ['Science & Nature'],
            playerCount: 2,
          },
          ownerKey: 'host-account',
          roomId,
          roster: identities.map((identityId) => ({ identityId })),
          expiresAt: new Date(Date.now() + 3600000),
        })
      ).rejects.toMatchObject({ code: '23505' });
      // Shared signed-in participants join two different rooms in opposite seat
      // orders. Admission must lock persisted identity IDs in the same order.
      const otherIdentity = await resolveThemeIdentity(pool, { userId: 'other-account' });
      const reversedRooms = [
        {
          code: 'ABCD3',
          owner: 'host-account',
          identities: [hostIdentity, otherIdentity],
          users: ['host-account', 'other-account'],
        },
        {
          code: 'ABCD4',
          owner: 'other-account',
          identities: [otherIdentity, hostIdentity],
          users: ['other-account', 'host-account'],
        },
      ];
      for (const room of reversedRooms) {
        const id = randomUUID(),
          host = randomUUID(),
          joiner = randomUUID();
        await pool.query(
          `INSERT INTO rooms(id,code,host_player_id,status,phase,theme,category,num_rounds,expires_at) VALUES($1,$2,$3,'lobby','LOBBY','Planets','Science & Nature',5,clock_timestamp()+interval '1 hour')`,
          [id, room.code, host]
        );
        await pool.query(
          `INSERT INTO room_players(id,room_id,user_id,token,is_host,join_order,theme_identity_id) VALUES($1,$2,$3,$4,true,0,$5),($6,$2,$7,$8,false,1,$9)`,
          [
            host,
            id,
            room.users[0],
            `${room.code}-host-token`,
            room.identities[0],
            joiner,
            room.users[1],
            `${room.code}-guest-token`,
            room.identities[1],
          ]
        );
      }
      const reversed = await Promise.all(
        reversedRooms.map((room) =>
          admission.start({
            code: room.code,
            playerToken: `${room.code}-host-token`,
            userId: room.owner,
          })
        )
      );
      expect(new Set(reversed.map((game) => game.gameId)).size).toBe(2);
      expect(reversed.every((game) => game.progress.status === 'shortfall')).toBe(true);
      const retries = await Promise.all(
        reversedRooms.map((room) =>
          admission.start({
            code: room.code,
            playerToken: `${room.code}-host-token`,
            userId: room.owner,
          })
        )
      );
      expect(retries.map((game) => game.gameId)).toEqual(reversed.map((game) => game.gameId));
      // Last-five means games with actual exposure; admission/reservation never counts.
      for (let index = 0; index < 6; index++) {
        const game = await service.createGame({
          request: {
            contractVersion: 'theme-reliability-v1',
            idempotencyKey: `history-game:${randomUUID()}`,
            mode: 'multiplayer',
            theme: 'Planets',
            themeSlug: 'planets',
            relatedCategories: ['Science & Nature'],
            playerCount: 2,
          },
          ownerKey: 'host-account',
          roster: identities.map((identityId) => ({ identityId })),
          expiresAt: new Date(Date.now() + 3600000),
        });
        await pool.query("INSERT INTO questions(id,status) VALUES($1,'approved')", [
          `history-${index}`,
        ]);
        await pool.query(
          `INSERT INTO theme_question_exposures(game_id,identity_id,question_id,display_key,displayed_at) VALUES($1,$2,$3,'question-1',clock_timestamp()-($4::integer * interval '1 day'))`,
          [game.game.id, guestIdentity, `history-${index}`, 40 + index]
        );
      }
      await pool.query(
        "INSERT INTO questions(id,status) VALUES('recent','approved'),('legacy','approved')"
      );
      await pool.query(
        `INSERT INTO theme_question_exposures(game_id,identity_id,question_id,display_key,displayed_at) VALUES($1,$2,'recent','question-recent',clock_timestamp()-interval '1 day')`,
        [starts[0].gameId, guestIdentity]
      );
      await pool.query(
        `INSERT INTO seen_questions VALUES('host-account','legacy',clock_timestamp()-interval '2 days')`
      );
      const history = await loadThemeHistory(pool, identities, new Date());
      expect(history.questionIds).toEqual(
        new Set(['recent', 'legacy', 'history-0', 'history-1', 'history-2', 'history-3'])
      );
      // One newly displayed admission + four older games are the latest five.
    } finally {
      if (pool) await pool.end();
      if (created) {
        await admin.query('SET search_path TO public');
        await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      }
      await admin.end();
    }
  });
});
