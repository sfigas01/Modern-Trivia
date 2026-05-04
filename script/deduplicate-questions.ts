/**
 * STE-143: Duplicate question cleanup script
 *
 * Reads server/seed-data.json, detects exact and near-duplicate questions using
 * string-similarity (Sørensen–Dice), clusters them, keeps the best version of
 * each cluster, writes the cleaned file back, and prints a findings report.
 *
 * Run: npx tsx script/deduplicate-questions.ts [--dry-run]
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import stringSimilarity from 'string-similarity';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Config ------------------------------------------------------------------

const SEED_DATA_PATH = join(__dirname, '../server/seed-data.json');
const NEAR_DUPLICATE_THRESHOLD = 0.8; // Dice coefficient on question text
// Near-dupes must also have similar answers — prevents template questions ("What is
// the capital of X?" vs "What is the capital of Y?") from being flagged as dupes.
const NEAR_DUPLICATE_ANSWER_THRESHOLD = 0.6; // answer must also be similar
const CONCEPTUAL_Q_THRESHOLD = 0.5; // question similarity to surface for review
const CONCEPTUAL_A_THRESHOLD = 0.7; // answer similarity to surface for review
const DRY_RUN = process.argv.includes('--dry-run');

// Pairs manually verified to be FALSE POSITIVES (different questions that
// coincidentally share an answer). Stored as "idA::idB" (lower id first alphabetically).
// These are kept in the game because they test different knowledge.
const MANUAL_FALSE_POSITIVES = new Set([
  // q15: "Poutine originated in which province?" vs q32: "Celine Dion is from which province?"
  // Both answer Quebec but are unrelated facts — not the same question.
  'q15::q32',
  // q17: "How many time zones does Canada have?" (Six) vs q34: "How many sides does a hexagon have?" (Six)
  // Coincidental answer — completely different subjects.
  'q17::q34',
  // q103: "Which province has the smallest population?" vs q155: "What is the smallest province by area?"
  // PEI is both — but these test different geography facts and both belong in the game.
  'q103::q155',
]);

// --- Types -------------------------------------------------------------------

interface SeedQuestion {
  id: string;
  category: string;
  difficulty: string;
  question: string;
  answer: string;
  acceptableAnswers: string[];
  explanation: string;
  pillar: string;
  tags: string[];
  sourceUrl: string | null;
  sourceName: string | null;
  status: string;
  aiAnalysis: unknown;
  createdAt: string;
  updatedAt: string;
}

type MatchType = 'exact' | 'near_duplicate' | 'conceptual';

interface DuplicatePair {
  idA: string;
  idB: string;
  matchType: MatchType;
  qSimilarity: number;
  aSimilarity: number;
}

// --- Helpers -----------------------------------------------------------------

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function qualityScore(q: SeedQuestion): number {
  let score = 0;
  if (q.explanation && q.explanation.length > 10) score += 2;
  if (q.acceptableAnswers && q.acceptableAnswers.length > 0) score += 1;
  if (q.sourceUrl) score += 1;
  if (q.status === 'approved') score += 2;
  if (q.tags && q.tags.length > 0) score += 1;
  return score;
}

// Union-Find for clustering
function buildClusters(pairs: DuplicatePair[], allIds: string[]): Map<string, string[]> {
  const parent = new Map<string, string>(allIds.map((id) => [id, id]));

  function find(id: string): string {
    while (parent.get(id) !== id) {
      const gp = parent.get(parent.get(id)!)!;
      parent.set(id, gp);
      id = gp;
    }
    return id;
  }

  function union(a: string, b: string) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  for (const pair of pairs) {
    union(pair.idA, pair.idB);
  }

  const clusters = new Map<string, string[]>();
  for (const id of allIds) {
    const root = find(id);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root)!.push(id);
  }

  // Only return clusters with 2+ members
  const result = new Map<string, string[]>();
  for (const [root, members] of clusters) {
    if (members.length > 1) result.set(root, members);
  }
  return result;
}

// --- Main --------------------------------------------------------------------

function main() {
  const raw = readFileSync(SEED_DATA_PATH, 'utf-8');
  const questions: SeedQuestion[] = JSON.parse(raw);

  console.log(`\n=== STE-143: Duplicate Question Cleanup ===\n`);
  console.log(`Total questions loaded: ${questions.length}`);
  if (DRY_RUN) console.log(`[DRY RUN — no files will be written]\n`);

  const byId = new Map<string, SeedQuestion>(questions.map((q) => [q.id, q]));

  const exactPairs: DuplicatePair[] = [];
  const nearDupePairs: DuplicatePair[] = [];
  const conceptualPairs: DuplicatePair[] = [];
  const seenPairs = new Set<string>();

  let totalPairsChecked = 0;

  for (let i = 0; i < questions.length; i++) {
    for (let j = i + 1; j < questions.length; j++) {
      const a = questions[i];
      const b = questions[j];
      totalPairsChecked++;

      const pairKey = `${a.id}::${b.id}`;
      const normA = normalize(a.question);
      const normB = normalize(b.question);

      // Exact match
      if (normA === normB) {
        seenPairs.add(pairKey);
        exactPairs.push({
          idA: a.id,
          idB: b.id,
          matchType: 'exact',
          qSimilarity: 1,
          aSimilarity: 1,
        });
        continue;
      }

      const qSim = stringSimilarity.compareTwoStrings(normA, normB);

      // Near-duplicate on question text — also require similar answers so that
      // template questions like "What is the capital of X?" don't cluster together.
      if (qSim >= NEAR_DUPLICATE_THRESHOLD) {
        const aSim = stringSimilarity.compareTwoStrings(normalize(a.answer), normalize(b.answer));
        if (aSim >= NEAR_DUPLICATE_ANSWER_THRESHOLD) {
          seenPairs.add(pairKey);
          nearDupePairs.push({
            idA: a.id,
            idB: b.id,
            matchType: 'near_duplicate',
            qSimilarity: qSim,
            aSimilarity: aSim,
          });
          continue;
        }
      }

      // Conceptual: different wording but same/similar answer + somewhat similar question.
      // Also require answers are non-trivial (length > 1 char) so that single-digit/letter
      // answers like "6" or "8" don't create false positives across unrelated questions.
      if (!seenPairs.has(pairKey) && qSim >= CONCEPTUAL_Q_THRESHOLD) {
        // Canonical key: sort IDs so the set lookup is order-independent
        const canonicalKey = [a.id, b.id].sort().join('::');
        if (!MANUAL_FALSE_POSITIVES.has(canonicalKey)) {
          const aSim = stringSimilarity.compareTwoStrings(normalize(a.answer), normalize(b.answer));
          const answerNonTrivial = normalize(a.answer).length > 1 && normalize(b.answer).length > 1;
          if (aSim >= CONCEPTUAL_A_THRESHOLD && answerNonTrivial) {
            conceptualPairs.push({
              idA: a.id,
              idB: b.id,
              matchType: 'conceptual',
              qSimilarity: qSim,
              aSimilarity: aSim,
            });
          }
        }
      }
    }
  }

  const allDuplicatePairs = [...exactPairs, ...nearDupePairs, ...conceptualPairs];

  // Build clusters across all duplicate IDs
  const duplicateIds = new Set<string>(allDuplicatePairs.flatMap((p) => [p.idA, p.idB]));
  const clusters = buildClusters(allDuplicatePairs, [...duplicateIds]);

  // Per-cluster: decide which to keep, which to remove
  const toRemove = new Set<string>();
  const clusterDetails: Array<{
    matchType: MatchType;
    keep: SeedQuestion;
    remove: SeedQuestion[];
    pairs: DuplicatePair[];
  }> = [];

  // Determine dominant match type for each cluster (exact > near_duplicate > conceptual)
  const matchTypeRank: Record<MatchType, number> = { exact: 3, near_duplicate: 2, conceptual: 1 };

  for (const members of clusters.values()) {
    const memberQuestions = members.map((id) => byId.get(id)!);
    // Sorted by quality score descending, then by earliness (createdAt asc)
    const sorted = memberQuestions.sort((a, b) => {
      const scoreDiff = qualityScore(b) - qualityScore(a);
      if (scoreDiff !== 0) return scoreDiff;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

    const keep = sorted[0];
    const remove = sorted.slice(1);
    remove.forEach((q) => toRemove.add(q.id));

    // Find pairs involving this cluster
    const clusterPairs = allDuplicatePairs.filter(
      (p) => members.includes(p.idA) && members.includes(p.idB)
    );

    const dominantType = clusterPairs.reduce<MatchType>((best, p) => {
      return matchTypeRank[p.matchType] > matchTypeRank[best] ? p.matchType : best;
    }, 'conceptual');

    clusterDetails.push({ matchType: dominantType, keep, remove, pairs: clusterPairs });
  }

  // Category breakdown of removed questions
  const removedByCategory: Record<string, number> = {};
  for (const id of toRemove) {
    const q = byId.get(id)!;
    const cat = q.category;
    removedByCategory[cat] = (removedByCategory[cat] ?? 0) + 1;
  }

  // --- Print report -----------------------------------------------------------

  console.log(`\nPairs checked: ${totalPairsChecked.toLocaleString()}`);
  console.log(`\nDuplicates found:`);
  console.log(`  Exact:        ${exactPairs.length}`);
  console.log(`  Near-dupe:    ${nearDupePairs.length}`);
  console.log(`  Conceptual:   ${conceptualPairs.length}`);
  console.log(`  Clusters:     ${clusters.size}`);
  console.log(`  To remove:    ${toRemove.size}`);
  console.log(`  After cleanup: ${questions.length - toRemove.size}`);

  if (clusterDetails.length > 0) {
    console.log(`\n--- Duplicate Clusters ---\n`);
    const sorted = clusterDetails.sort(
      (a, b) => matchTypeRank[b.matchType] - matchTypeRank[a.matchType]
    );

    for (const cluster of sorted) {
      console.log(`[${cluster.matchType.toUpperCase()}] Keep: ${cluster.keep.id}`);
      console.log(`  Q: "${cluster.keep.question}"`);
      console.log(`  A: "${cluster.keep.answer}"  (score: ${qualityScore(cluster.keep)})`);
      for (const r of cluster.remove) {
        const pair = cluster.pairs.find((p) => p.idA === r.id || p.idB === r.id);
        const sim = pair
          ? `qSim=${(pair.qSimilarity * 100).toFixed(0)}%` +
            (pair.aSimilarity ? ` aSim=${(pair.aSimilarity * 100).toFixed(0)}%` : '')
          : '';
        console.log(`  REMOVE: ${r.id}  ${sim}`);
        console.log(`    Q: "${r.question}"`);
        console.log(`    A: "${r.answer}"`);
      }
      console.log();
    }
  }

  if (Object.keys(removedByCategory).length > 0) {
    console.log(`--- Removed by Category ---\n`);
    const sorted = Object.entries(removedByCategory).sort((a, b) => b[1] - a[1]);
    for (const [cat, count] of sorted) {
      console.log(`  ${cat}: ${count}`);
    }
    console.log();
  }

  // --- Write cleaned file -----------------------------------------------------

  if (!DRY_RUN) {
    const cleaned = questions.filter((q) => !toRemove.has(q.id));
    writeFileSync(SEED_DATA_PATH, JSON.stringify(cleaned, null, 2) + '\n');
    console.log(`\nWrote ${cleaned.length} questions to ${SEED_DATA_PATH}`);
    console.log(`Removed ${toRemove.size} duplicate(s).\n`);
  } else {
    console.log(`\n[DRY RUN] Would remove ${toRemove.size} question(s) from seed-data.json\n`);
  }
}

main();
