import { insertQuestionSchema, type InsertQuestion } from '@shared/models/questions';
import { createSourceReview } from '../lib/source-review';

// Original, source-reviewed terminology questions. Sources were read on 2026-09-19.
// Keep wording and evidence together; substantive changes require another source review.
// This pack is a release candidate, not a claim of limitless repeat-free inventory.
const entries: Array<[string, string, string, string, string[]?]> = [
  [
    'standard-stats/complete-game',
    'Which pitching statistic counts outings finished without a reliever?',
    'Complete game',
    'pitches the entire game',
  ],
  [
    'standard-stats/shutout',
    'What is a team victory allowing zero opposing runs called?',
    'Shutout',
    'held scoreless',
  ],
  [
    'standard-stats/walk',
    'How many called balls normally award a batter first base?',
    'Four',
    'four pitches out',
    ['4'],
  ],
  [
    'standard-stats/hit-by-pitch',
    'When a nonswinging batter is hit outside the strike zone, which base is awarded?',
    'First base',
    'awarded first base',
    ['First', '1st base'],
  ],
  [
    'standard-stats/grand-slam',
    'What is a home run with every base occupied called?',
    'Grand slam',
    'Four runs score',
  ],
  [
    'standard-stats/triple',
    'Which hit is nicknamed baseball’s “most exciting play”?',
    'Triple',
    'the most exciting play',
  ],
  [
    'standard-stats/single',
    'What is baseball’s most common type of hit?',
    'Single',
    'most common type of hit',
  ],
  [
    'standard-stats/double',
    'What hit credits a batter with second base without an error?',
    'Double',
    'reaches second base',
  ],
  [
    'standard-stats/home-run',
    'What can a fair drive striking an outfield foul pole be scored?',
    'Home run',
    'hits the foul pole',
    ['Homer'],
  ],
  [
    'standard-stats/strikeout',
    'What batting result follows three swinging misses in one plate appearance?',
    'Strikeout',
    'three swinging or looking strikes',
  ],
  [
    'standard-stats/triple-play',
    'How many outs does a TP record on one defensive play?',
    'Three',
    'three outs',
    ['3'],
  ],
  [
    'standard-stats/double-play',
    'What defensive achievement is nicknamed “a pitcher’s best friend”?',
    'Double play',
    "a pitcher's best friend",
  ],
  [
    'standard-stats/stolen-base',
    'What statistic credits a runner’s successful theft of the next bag?',
    'Stolen base',
    'a baserunner advances',
  ],
  [
    'standard-stats/caught-stealing',
    'What baserunning statistic is abbreviated CS?',
    'Caught stealing',
    'Caught Stealing',
  ],
  [
    'standard-stats/wild-pitch',
    'An uncatchable delivery lets a runner advance. What is charged to the pitcher?',
    'Wild pitch',
    'so errant',
  ],
  [
    'standard-stats/passed-ball',
    'A catchable delivery escapes the catcher and a runner advances. What is charged?',
    'Passed ball',
    "catcher's fault",
  ],
  [
    'standard-stats/sacrifice-bunt',
    'What is a bunt intended to score a runner from third called?',
    'Squeeze play',
    'called a squeeze play',
    ['Squeeze'],
  ],
  [
    'standard-stats/sacrifice-fly',
    'What is a caught outfield ball that lets a runner score called?',
    'Sacrifice fly',
    'allows a runner to score',
  ],
  [
    'standard-stats/batting-average',
    'Which batting statistic divides hits by official at-bats?',
    'Batting average',
    'hits by his total at-bats',
    ['Average'],
  ],
  [
    'standard-stats/earned-run-average',
    'ERA expresses pitching performance over how many innings?',
    'Nine',
    'per nine innings',
    ['9'],
  ],
  [
    'standard-stats/slugging-percentage',
    'Which batting statistic divides total bases by at-bats?',
    'Slugging percentage',
    'bases a player records per at-bat',
    ['Slugging'],
  ],
  [
    'standard-stats/on-base-percentage',
    'Which rate statistic abbreviates to OBP?',
    'On-base percentage',
    'OBP refers to how frequently',
    ['On base percentage'],
  ],
  [
    'standard-stats/on-base-plus-slugging',
    'Which statistic adds OBP and SLG?',
    'OPS',
    'OPS adds on-base percentage',
    ['On-base plus slugging'],
  ],
  [
    'standard-stats/walks-and-hits-per-inning-pitched',
    'Which pitching statistic divides walks plus hits by innings pitched?',
    'WHIP',
    "sum of a pitcher's walks and hits",
  ],
  [
    'standard-stats/runs-batted-in',
    'What does RBI stand for in baseball?',
    'Runs batted in',
    'Runs Batted In',
    ['Run batted in'],
  ],
  [
    'standard-stats/total-bases',
    'How many total bases does a home run contribute?',
    'Four',
    'four total bases',
    ['4'],
  ],
  [
    'standard-stats/save',
    'In which year did saves become an official MLB statistic?',
    '1969',
    'official stat until 1969',
  ],
  [
    'standard-stats/blown-save',
    'What is charged when a reliever surrenders the tying run in a save situation?',
    'Blown save',
    'allows the tying run to score',
  ],
  [
    'standard-stats/hold',
    'Which statistic credits a qualifying reliever who preserves the lead for another pitcher?',
    'Hold',
    "maintains his team's lead",
  ],
  [
    'standard-stats/innings-pitched',
    'How many outs does one full inning pitched represent?',
    'Three',
    'three outs in an inning',
    ['3'],
  ],
  [
    'standard-stats/games-started',
    'What is the modern term for a deliberately short-stint starting pitcher?',
    'Opener',
    'using an "opener."',
  ],
  [
    'standard-stats/extra-base-hit',
    'Which ordinary hit type is excluded from extra-base hits?',
    'Single',
    'any hit that is not a single',
  ],
  [
    'rules/balk',
    'What is an illegal pitching motion penalized by advancing baserunners called?',
    'Balk',
    'illegal motion on the mound',
  ],
  [
    'rules/infield-fly',
    'Which rule prevents defenders deliberately dropping routine popups for easy force outs?',
    'Infield fly rule',
    'An infield fly',
    ['Infield fly'],
  ],
  [
    'rules/force-play',
    'What play requires a runner to vacate a base for an advancing teammate?',
    'Force play',
    'must attempt to advance',
    ['Force'],
  ],
  [
    'pitch-types/four-seam-fastball',
    'Which fastball variety is typically a pitcher’s fastest and straightest?',
    'Four-seam fastball',
    'fastest and straightest pitch',
    ['Four-seamer', 'Four seam fastball'],
  ],
  [
    'pitch-types/curveball',
    'Which breaking pitch is generally slower with more movement than a slider?',
    'Curveball',
    'slower and with more overall break',
    ['Curve'],
  ],
  [
    'pitch-types/slider',
    'What nickname describes a pitch between a slider and a curveball?',
    'Slurve',
    'referred to in slang as a "slurve."',
  ],
  [
    'pitch-types/changeup',
    'Which common off-speed pitch mimics a fastball’s trajectory at lower velocity?',
    'Changeup',
    'at a significantly slower velocity',
    ['Change-up', 'Change up'],
  ],
  [
    'pitch-types/knuckleball',
    'Which fluttering pitch relies on almost no spin?',
    'Knuckleball',
    'eliminate almost all of the spin',
  ],
];

export function reviewedBaseballQuestions(): InsertQuestion[] {
  return entries.map(([path, question, answer, quote, acceptableAnswers = []], index) => {
    const q = insertQuestionSchema.parse({
      id: `reviewed-baseball-v1-${String(index + 1).padStart(2, '0')}`,
      question,
      answer,
      acceptableAnswers,
      explanation: 'See the MLB glossary definition.',
      category: 'Sports',
      difficulty: [16, 18, 19, 20, 21, 22, 23, 26, 28, 30, 33, 34, 35, 36, 37, 38].includes(index)
        ? 'Medium'
        : 'Easy',
      pillar: 'GlobalEh',
      tags: ['Global', 'Sports', 'GlobalEh', 'theme:baseball', 'reviewed-pack:baseball-v1'],
      sourceUrl: `https://www.mlb.com/glossary/${path}`,
      sourceName: 'MLB Glossary',
      status: 'approved',
      origin: 'curated',
    });
    return {
      ...q,
      aiAnalysis: {
        sourceReview: createSourceReview(q, [quote], 'editorial', '2026-09-19T15:00:00.000Z'),
      },
    };
  });
}
