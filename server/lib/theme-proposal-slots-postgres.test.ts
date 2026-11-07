import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import pg from 'pg';
import { describe, expect, it } from 'vitest';

import { createThemeProposalSlotRepository } from './theme-proposal-slots';
import {
  createThemeLiveRuntimePlanWithProposalSlots,
  hashThemeRuntimePlan,
} from './theme-runtime-plan';
import {
  buildWikipediaDiscoveryRequestUrl,
  createWikipediaDiscoveryPolicy,
  createWikipediaSourceRegistry,
} from './theme-wikipedia-discovery';
import { hashThemeSourceRegistry } from './theme-source-registry';

const databaseUrl = process.env.THEME_RELIABILITY_MIGRATION_TEST_DATABASE_URL;
const sha = (value: string) => createHash('sha256').update(value).digest('hex');

const BASE_SCHEMA = `
CREATE TABLE theme_preparation_jobs (
  id uuid PRIMARY KEY,
  plan_hash varchar(64),
  plan_json jsonb
);
CREATE TABLE theme_evidence_documents (
  id uuid PRIMARY KEY,
  contract_version varchar NOT NULL,
  requested_url text NOT NULL,
  canonical_url text NOT NULL,
  final_url text NOT NULL,
  publisher_id varchar NOT NULL,
  source_class varchar NOT NULL,
  publisher varchar NOT NULL,
  origin_group varchar NOT NULL,
  source_policy_version varchar NOT NULL,
  extractor_version varchar NOT NULL,
  title text NOT NULL,
  language varchar NOT NULL,
  status varchar NOT NULL,
  content_hash varchar(64) NOT NULL,
  retrieved_at timestamptz NOT NULL,
  published_at timestamptz,
  source_updated_at timestamptz,
  valid_until timestamptz,
  http_status integer NOT NULL,
  media_type varchar NOT NULL
);
CREATE TABLE theme_evidence_passages (
  id uuid PRIMARY KEY,
  contract_version varchar NOT NULL,
  document_id uuid NOT NULL REFERENCES theme_evidence_documents(id),
  ordinal integer NOT NULL,
  locator text NOT NULL,
  passage_text text NOT NULL,
  content_hash varchar(64) NOT NULL
);
CREATE TABLE theme_source_registry_versions (
  source_policy_version varchar PRIMARY KEY,
  contract_version varchar NOT NULL,
  manifest jsonb NOT NULL,
  manifest_hash varchar(64) NOT NULL,
  UNIQUE(source_policy_version,manifest_hash)
);
CREATE TABLE theme_evidence_document_sources (
  document_id uuid PRIMARY KEY REFERENCES theme_evidence_documents(id),
  source_policy_version varchar NOT NULL,
  registry_hash varchar(64) NOT NULL,
  entry_id varchar NOT NULL,
  FOREIGN KEY(source_policy_version,registry_hash)
    REFERENCES theme_source_registry_versions(source_policy_version,manifest_hash)
);
`;

function livePlan(pinnedRegistryHash?: string) {
  const registry = createWikipediaSourceRegistry('wikipedia-source-v1');
  const policy = createWikipediaDiscoveryPolicy({
    discoveryPolicyVersion: 'wikipedia-discovery-v1',
    sourcePolicyVersion: registry.sourcePolicyVersion,
    sourceRegistryHash: pinnedRegistryHash ?? hashThemeSourceRegistry(registry),
    minimumResults: 2,
    maximumResults: 2,
  });
  const normalizedTheme = 'World Baseball Classic';
  return createThemeLiveRuntimePlanWithProposalSlots({
    discovery: {
      contractVersion: 'theme-wikipedia-discovery-v1',
      normalizedTheme,
      requestUrl: buildWikipediaDiscoveryRequestUrl(normalizedTheme, policy).href,
      discoveryPolicy: policy,
      sources: [
        {
          pageId: 10,
          rank: 1,
          title: '2006 World Baseball Classic',
          language: 'en',
          canonicalUrl: 'https://en.wikipedia.org/wiki/2006_World_Baseball_Classic',
        },
        {
          pageId: 20,
          rank: 2,
          title: 'World Baseball Classic',
          language: 'en',
          canonicalUrl: 'https://en.wikipedia.org/wiki/World_Baseball_Classic',
        },
      ],
    },
    claimEvidencePolicy: {
      contractVersion: 'theme-claim-evidence-policy-v1',
      policyVersion: 'claim-evidence-v1',
      stable: {
        allowedSourceClasses: ['secondary_reputable'],
        atLeastOneFromSourceClasses: [],
        minimumIndependentOriginGroups: 1,
      },
      timeSensitive: {
        allowedSourceClasses: ['secondary_reputable', 'primary_official'],
        atLeastOneFromSourceClasses: ['primary_official'],
        minimumIndependentOriginGroups: 2,
      },
      superlative: {
        allowedSourceClasses: ['secondary_reputable', 'primary_record'],
        atLeastOneFromSourceClasses: ['primary_record'],
        minimumIndependentOriginGroups: 2,
      },
      disputed: {
        allowedSourceClasses: ['secondary_reputable', 'primary_record'],
        atLeastOneFromSourceClasses: ['primary_record'],
        minimumIndependentOriginGroups: 2,
      },
    },
    budgetPolicyFingerprint: 'a'.repeat(64),
    totalSlots: 4,
    maximumSlotsPerSource: 2,
  });
}

describe.runIf(Boolean(databaseUrl))('theme proposal slots PostgreSQL recovery', () => {
  it('replays immutable allocations and evidence-bound outcomes without changing fact identity', async () => {
    const admin = new pg.Client({ connectionString: databaseUrl });
    const schema = `theme_slots_${randomUUID().replaceAll('-', '')}`;
    let pool: pg.Pool | null = null;
    try {
      await admin.connect();
      await admin.query(`CREATE SCHEMA ${schema}`);
      await admin.query(`SET search_path TO ${schema}`);
      await admin.query(BASE_SCHEMA);
      const migration = await readFile(
        new URL('../../migrations/0022_theme_fact_proposal_slots.sql', import.meta.url),
        'utf8'
      );
      await admin.query(migration);
      await admin.query(migration);
      pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });

      const plan = livePlan();
      const holdUntil = new Date('2026-11-01T04:00:00.000Z');
      const planHash = hashThemeRuntimePlan({ planVersion: 'live-v2', plan, holdUntil });
      const jobId = randomUUID();
      await pool.query(
        'INSERT INTO theme_preparation_jobs(id,plan_hash,plan_json) VALUES($1,$2,$3::jsonb)',
        [jobId, planHash, JSON.stringify(plan)]
      );
      const repository = createThemeProposalSlotRepository(pool, {
        now: () => new Date('2026-11-01T00:00:00.000Z'),
      });
      const concurrent = await Promise.all([
        repository.allocate({ jobId, planHash, plan }),
        repository.allocate({ jobId, planHash, plan }),
      ]);
      expect(concurrent).toEqual(
        expect.arrayContaining([
          { replay: false, allocated: 4 },
          { replay: true, allocated: 4 },
        ])
      );
      expect(
        (await pool.query('SELECT source_key FROM theme_proposal_slots ORDER BY slot_ordinal')).rows
      ).toEqual([
        { source_key: 'wikipedia:10' },
        { source_key: 'wikipedia:20' },
        { source_key: 'wikipedia:10' },
        { source_key: 'wikipedia:20' },
      ]);

      const passageId = randomUUID();
      const documentId = randomUUID();
      const passageHash = sha('The first final was played in San Diego.');
      const registry = createWikipediaSourceRegistry('wikipedia-source-v1');
      const registryHash = hashThemeSourceRegistry(registry);
      await pool.query(
        `INSERT INTO theme_source_registry_versions
         (source_policy_version,contract_version,manifest,manifest_hash)
         VALUES($1,$2,$3::jsonb,$4)`,
        [
          registry.sourcePolicyVersion,
          registry.contractVersion,
          JSON.stringify(registry),
          registryHash,
        ]
      );
      await pool.query(
        `INSERT INTO theme_evidence_documents
         (id,contract_version,requested_url,canonical_url,final_url,publisher_id,source_class,
          publisher,origin_group,source_policy_version,extractor_version,title,language,status,
          content_hash,retrieved_at,valid_until,http_status,media_type)
         VALUES($1,'theme-reliability-v1',$2,$2,$2,'wikimedia-foundation','secondary_reputable',
                'Wikipedia','wikimedia-foundation','wikipedia-source-v1','test-extractor-v1','WBC','en',
                'retrieved',$3,'2026-10-31T00:00:00Z','2026-11-02T00:00:00Z',200,'text/html')`,
        [documentId, plan.sources[0].canonicalUrl, sha('source body')]
      );
      await pool.query(
        `INSERT INTO theme_evidence_document_sources
         (document_id,source_policy_version,registry_hash,entry_id)
         VALUES($1,'wikipedia-source-v1',$2,'wikipedia-en')`,
        [documentId, registryHash]
      );
      await pool.query(
        `INSERT INTO theme_evidence_passages
         (id,contract_version,document_id,ordinal,locator,passage_text,content_hash)
         VALUES($1,'theme-reliability-v1',$2,0,'text:1',$3,$4)`,
        [passageId, documentId, 'The first final was played in San Diego.', passageHash]
      );
      const outcome = {
        status: 'proposed' as const,
        statement: 'The first final was played in San Diego.',
        scope: {
          entity: 'World Baseball Classic',
          relation: 'first final venue',
          time: '2006',
          geography: 'United States',
          competitionOrDomain: 'baseball',
          qualifiers: [],
          asOf: null,
        },
        canonicalAnswer: 'San Diego',
        supportedAliases: ['San Diego, California'],
        timeSensitive: false,
        citations: [
          { passageId, passageContentHash: passageHash, supportKind: 'supports' as const },
        ],
      };
      const provenance = {
        proposalPolicyVersion: 'proposal-v1',
        promptVersion: 'prompt-v1',
        promptHash: sha('fixture prompt'),
        producerKind: 'human' as const,
        producerId: 'fixture',
        provider: null,
        model: null,
        claimRisks: ['stable' as const],
        derivationPolicy: {
          sourcePolicyVersion: 'wikipedia-source-v1',
          extractorVersion: 'test-extractor-v1',
          allowedSourceClasses: ['secondary_reputable' as const],
          maxSourceAgeMs: 10 * 24 * 60 * 60 * 1000,
          minimumOriginGroups: 1,
          timeSensitiveTtlMs: 3 * 24 * 60 * 60 * 1000,
        },
      };
      const first = await repository.recordOutcome({
        jobId,
        slotKey: 'proposal:001',
        outcome,
        provenance,
      });
      expect(first).toMatchObject({ replay: false, status: 'proposed' });
      await expect(
        repository.recordOutcome({ jobId, slotKey: 'proposal:001', outcome, provenance })
      ).resolves.toEqual({ ...first, replay: true });
      const restartedRepository = createThemeProposalSlotRepository(pool, {
        now: () => new Date('2026-11-01T00:00:00.000Z'),
      });
      await expect(
        restartedRepository.loadOutcome({ jobId, slotKey: 'proposal:001' })
      ).resolves.toMatchObject({
        replay: true,
        outcome: { status: 'proposed', canonicalAnswer: 'San Diego' },
        provenance,
        canonicalFactKey: first.canonicalFactKey,
      });
      const equivalent = await repository.recordOutcome({
        jobId,
        slotKey: 'proposal:003',
        outcome: {
          ...outcome,
          scope: {
            ...outcome.scope,
            entity: ' world   baseball classic ',
            qualifiers: [],
          },
          canonicalAnswer: 'SAN DIEGO',
        },
        provenance,
      });
      expect(equivalent.canonicalFactKey).toBe(first.canonicalFactKey);
      await expect(
        repository.recordOutcome({
          jobId,
          slotKey: 'proposal:001',
          outcome: { ...outcome, scope: { ...outcome.scope, time: '2009' } },
          provenance,
        })
      ).rejects.toMatchObject({ code: 'slot_conflict' });
      await expect(
        repository.recordOutcome({
          jobId,
          slotKey: 'proposal:002',
          outcome: {
            ...outcome,
            citations: [{ ...outcome.citations[0], passageContentHash: 'b'.repeat(64) }],
          },
          provenance,
        })
      ).rejects.toMatchObject({ code: 'evidence_conflict' });
      await expect(
        repository.recordOutcome({
          jobId,
          slotKey: 'proposal:002',
          outcome: { ...outcome, timeSensitive: true },
          provenance,
        })
      ).rejects.toMatchObject({ code: 'evidence_conflict' });
      await expect(
        repository.recordOutcome({
          jobId,
          slotKey: 'proposal:002',
          outcome: {
            ...outcome,
            timeSensitive: true,
            scope: { ...outcome.scope, asOf: '2026-10-30T00:00:00.000Z' },
          },
          provenance,
        })
      ).rejects.toMatchObject({ code: 'evidence_conflict' });
      await expect(
        repository.recordOutcome({
          jobId,
          slotKey: 'proposal:002',
          outcome,
          provenance: { ...provenance, claimRisks: ['superlative'] },
        })
      ).rejects.toMatchObject({ code: 'evidence_conflict' });
      const mismatchedPlan = livePlan('b'.repeat(64));
      const mismatchedJobId = randomUUID();
      const mismatchedPlanHash = hashThemeRuntimePlan({
        planVersion: 'live-v2',
        plan: mismatchedPlan,
        holdUntil,
      });
      await pool.query(
        'INSERT INTO theme_preparation_jobs(id,plan_hash,plan_json) VALUES($1,$2,$3::jsonb)',
        [mismatchedJobId, mismatchedPlanHash, JSON.stringify(mismatchedPlan)]
      );
      await repository.allocate({
        jobId: mismatchedJobId,
        planHash: mismatchedPlanHash,
        plan: mismatchedPlan,
      });
      await expect(
        repository.recordOutcome({
          jobId: mismatchedJobId,
          slotKey: 'proposal:001',
          outcome,
          provenance,
        })
      ).rejects.toMatchObject({ code: 'evidence_conflict' });
      await expect(
        pool.query(
          `INSERT INTO theme_proposal_slot_outcomes
           (job_id,slot_key,status,outcome_snapshot,evidence_fingerprint,provenance_snapshot,
            provenance_fingerprint,canonical_fact_key,result_hash)
           VALUES($1,'proposal:002','proposed','{}'::jsonb,$2,'{}'::jsonb,$2,NULL,$2)`,
          [jobId, 'a'.repeat(64)]
        )
      ).rejects.toThrow();
      const foreignPassageId = randomUUID();
      const foreignDocumentId = randomUUID();
      await pool.query(
        `INSERT INTO theme_evidence_documents
         (id,contract_version,requested_url,canonical_url,final_url,publisher_id,source_class,
          publisher,origin_group,source_policy_version,extractor_version,title,language,status,
          content_hash,retrieved_at,valid_until,http_status,media_type)
         VALUES($1,'theme-reliability-v1',$2,$2,$2,'wikimedia-foundation','secondary_reputable',
                'Wikipedia','wikimedia-foundation','wikipedia-source-v1','test-extractor-v1','Unpinned','en',
                'retrieved',$3,'2026-10-31T00:00:00Z','2026-11-02T00:00:00Z',200,'text/html')`,
        [foreignDocumentId, 'https://en.wikipedia.org/wiki/Unpinned', sha('foreign body')]
      );
      await pool.query(
        `INSERT INTO theme_evidence_document_sources
         (document_id,source_policy_version,registry_hash,entry_id)
         VALUES($1,'wikipedia-source-v1',$2,'wikipedia-en')`,
        [foreignDocumentId, registryHash]
      );
      await pool.query(
        `INSERT INTO theme_evidence_passages
         (id,contract_version,document_id,ordinal,locator,passage_text,content_hash)
         VALUES($1,'theme-reliability-v1',$2,0,'text:1',$3,$4)`,
        [
          foreignPassageId,
          foreignDocumentId,
          'The first final was played in San Diego.',
          passageHash,
        ]
      );
      await expect(
        repository.recordOutcome({
          jobId,
          slotKey: 'proposal:004',
          outcome: {
            ...outcome,
            citations: [
              {
                passageId: foreignPassageId,
                passageContentHash: passageHash,
                supportKind: 'supports',
              },
            ],
          },
          provenance,
        })
      ).rejects.toMatchObject({ code: 'evidence_conflict' });
      await expect(
        pool.query("UPDATE theme_proposal_slots SET source_key='wikipedia:30' WHERE job_id=$1", [
          jobId,
        ])
      ).rejects.toThrow(/immutable/);
    } finally {
      await pool?.end();
      if (admin.connectionParameters.database) {
        await admin.query('RESET search_path').catch(() => undefined);
        await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => undefined);
      }
      await admin.end().catch(() => undefined);
    }
  });
});
