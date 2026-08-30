import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import {
  ScanSearch,
  Play,
  LogIn,
  Shield,
  Check,
  Pencil,
  Trash2,
  Save,
  X,
  ChevronDown,
  ChevronUp,
  ListFilter,
} from 'lucide-react';
import { AdminLayout } from '@/components/admin-layout';
import { HiddenAnswer } from '@/components/admin/HiddenAnswer';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { useAuth } from '@/hooks/use-auth';
import { useAdmin } from '@/hooks/use-admin';
import { useGame, type Question, type QuestionPatch } from '@/lib/store';
import {
  buildStaticFindingKey,
  duplicatePairKey,
  FACT_CHECK_FINDING_KEY,
  isStaticFindingDismissed,
  type DismissFindingRequest,
  type DuplicateMatch,
  type FactCheckVerdict,
  type QualityFindingType,
  type QualitySweepReport,
  type QuestionQualityFinding,
  type QuestionQualityRule,
  type QuestionSnapshot,
} from '@shared/models/quality-sweep';

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function truncate(text: string, max = 80): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

// ---------------------------------------------------------------------------
// Small display components (no state coupling to parent)
// ---------------------------------------------------------------------------

function SeverityBadge({ severity }: { severity: string }) {
  const variant =
    severity === 'high' ? 'destructive' : severity === 'medium' ? 'secondary' : 'outline';
  return <Badge variant={variant}>{severity}</Badge>;
}

function VerdictBadge({ verdict }: { verdict: string }) {
  const variant = verdict === 'fail' ? 'destructive' : 'secondary';
  return <Badge variant={variant}>{verdict}</Badge>;
}

function MatchTypeBadge({ type }: { type: string }) {
  const label = type === 'near_duplicate' ? 'near-duplicate' : type;
  const variant =
    type === 'exact' ? 'destructive' : type === 'near_duplicate' ? 'secondary' : 'outline';
  return <Badge variant={variant}>{label}</Badge>;
}

function ProposedFixDisplay({ rule, fix }: { rule: string; fix: Record<string, unknown> }) {
  if (rule === 'missing_required_tags') {
    const currentTags = (fix.currentTags as string[]) ?? [];
    const missingRegion = fix.missingRegion as boolean;
    const missingPillar = fix.missingPillar as boolean;
    const validRegionTags = (fix.validRegionTags as string[]) ?? [];
    const validPillarTags = (fix.validPillarTags as string[]) ?? [];
    return (
      <div className="space-y-2 text-xs">
        <div>
          <p className="text-[10px] uppercase text-muted-foreground mb-1">Current tags</p>
          <div className="flex gap-1 flex-wrap">
            {currentTags.length > 0 ? (
              currentTags.map((t) => (
                <span key={t} className="px-1.5 py-0.5 rounded bg-white/10 font-mono">
                  {t}
                </span>
              ))
            ) : (
              <span className="text-muted-foreground italic">none</span>
            )}
          </div>
        </div>
        <div>
          <p className="text-[10px] uppercase text-muted-foreground mb-1">Needs to add</p>
          <div className="space-y-1">
            {missingRegion && (
              <div className="flex items-center gap-1 flex-wrap">
                <span className="text-muted-foreground w-12 shrink-0">Region:</span>
                {validRegionTags.map((t) => (
                  <span
                    key={t}
                    className="px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-300 font-mono"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
            {missingPillar && (
              <div className="flex items-center gap-1 flex-wrap">
                <span className="text-muted-foreground w-12 shrink-0">Pillar:</span>
                {validPillarTags.map((t) => (
                  <span
                    key={t}
                    className="px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 font-mono"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (rule === 'category_tag_mismatch') {
    const currentTags = (fix.currentTags as string[]) ?? [];
    const addTag = fix.addTag as string;
    return (
      <div className="space-y-2 text-xs">
        <div>
          <p className="text-[10px] uppercase text-muted-foreground mb-1">Current tags</p>
          <div className="flex gap-1 flex-wrap">
            {currentTags.map((t) => (
              <span key={t} className="px-1.5 py-0.5 rounded bg-white/10 font-mono">
                {t}
              </span>
            ))}
            {currentTags.length === 0 && <span className="text-muted-foreground italic">none</span>}
          </div>
        </div>
        <div>
          <p className="text-[10px] uppercase text-muted-foreground mb-1">Proposed fix</p>
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">Add:</span>
            <span className="px-1.5 py-0.5 rounded bg-green-500/20 text-green-300 font-mono">
              {addTag}
            </span>
          </div>
        </div>
      </div>
    );
  }

  if (rule === 'subjective_prompt') {
    const subjectivePart = fix.subjectivePart as string | undefined;
    const proposedQuestion = fix.proposedQuestion as string | undefined;
    if (!subjectivePart && !proposedQuestion) return null;
    return (
      <div className="space-y-2 text-xs">
        {subjectivePart && (
          <div>
            <p className="text-[10px] uppercase text-muted-foreground mb-1">Subjective phrase</p>
            <span className="px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-300 font-medium">
              &ldquo;{subjectivePart}&rdquo;
            </span>
          </div>
        )}
        {proposedQuestion && (
          <div>
            <p className="text-[10px] uppercase text-muted-foreground mb-1">Proposed rewrite</p>
            <p className="text-sm text-white/90 leading-snug">{proposedQuestion}</p>
          </div>
        )}
      </div>
    );
  }

  if (rule === 'missing_source_metadata') {
    const missingFields = (fix.missingFields as string[]) ?? [];
    return (
      <div className="text-xs">
        <p className="text-[10px] uppercase text-muted-foreground mb-1">Missing fields</p>
        <div className="flex gap-1 flex-wrap">
          {missingFields.map((f) => (
            <span
              key={f}
              className="px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-300 font-mono"
            >
              {f}
            </span>
          ))}
        </div>
      </div>
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// extractApplicableFix — returns a question-transform fn when a proposed fix
// can be auto-applied, or null when manual editing is required.
// ---------------------------------------------------------------------------

type ApplyFixFn = (q: Question) => QuestionPatch;

function extractApplicableFix(
  rule: string,
  fix: Record<string, unknown> | undefined
): ApplyFixFn | null {
  if (!fix) return null;

  if (rule === 'subjective_prompt') {
    const proposedQuestion = fix.proposedQuestion as string | undefined;
    if (!proposedQuestion?.trim()) return null;
    return () => ({ question: proposedQuestion.trim() });
  }

  if (rule === 'category_tag_mismatch') {
    const addTag = fix.addTag as string | undefined;
    if (!addTag) return null;
    return (q) => ({
      tags: q.tags.includes(addTag) ? q.tags : [...q.tags, addTag],
    });
  }

  return null;
}

function ExpandableDetails({
  finding,
  snapshot,
}: {
  finding: QuestionQualityFinding;
  snapshot?: QuestionSnapshot;
}) {
  const [open, setOpen] = useState(false);
  const hasDetails = snapshot && (finding.proposedFix || snapshot.answer);
  if (!hasDetails) return null;
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-white transition-colors mt-1"
        data-testid={`button-expand-finding-${finding.questionId}-${finding.rule}`}
      >
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        {open ? 'Hide details' : 'Show details'}
      </button>
      {open && (
        <div className="mt-2 pt-2 border-t border-white/10 space-y-3">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="text-xs border-white/20">
              {snapshot.category}
            </Badge>
            {snapshot.difficulty && (
              <Badge variant="outline" className="text-xs border-white/20">
                {snapshot.difficulty}
              </Badge>
            )}
            {snapshot.sourceDomain && (
              <Badge variant="outline" className="text-xs border-white/20">
                Source: {snapshot.sourceDomain}
              </Badge>
            )}
            {!snapshot.hasSource && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-300">
                no source
              </span>
            )}
          </div>
          <div>
            <p className="text-[10px] uppercase text-muted-foreground mb-1">Answer</p>
            <HiddenAnswer answer={snapshot.answer} />
          </div>
          {finding.proposedFix && (
            <div>
              <p className="text-[10px] uppercase text-muted-foreground mb-1">Proposed fix</p>
              <ProposedFixDisplay rule={finding.rule} fix={finding.proposedFix} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit state types
// ---------------------------------------------------------------------------

type EditField = 'question' | 'answer' | 'explanation';

interface EditDraft {
  question: string;
  answer: string;
  explanation: string;
  touched: Record<EditField, boolean>;
}

function buildDraft(q: Question): EditDraft {
  return {
    question: q.question,
    answer: q.answer,
    explanation: q.explanation ?? '',
    touched: { question: false, answer: false, explanation: false },
  };
}

// ---------------------------------------------------------------------------
// Shared edit-action props (passed down to every section)
// ---------------------------------------------------------------------------

interface EditActions {
  editingKey: string | null;
  editDrafts: Record<string, EditDraft>;
  busyKey: string | null;
  onAccept: (
    findingType: QualityFindingType,
    questionId: string,
    findingKey: string,
    editKey: string
  ) => void;
  onAcceptFix: (
    findingType: QualityFindingType,
    questionId: string,
    findingKey: string,
    editKey: string,
    applyFn: ApplyFixFn
  ) => void;
  onStartEdit: (editKey: string, questionId: string) => void;
  onDraftChange: (editKey: string, field: EditField, value: string) => void;
  onSaveEdit: (editKey: string, questionId: string) => void;
  onCancelEdit: (editKey: string) => void;
  onDelete: (editKey: string, questionId: string) => void;
}

// ---------------------------------------------------------------------------
// ActionRow
// ---------------------------------------------------------------------------

interface ActionRowProps {
  questionId: string;
  onAccept: () => void;
  onAcceptFix?: () => void;
  onEdit: () => void;
  onDelete: () => void;
  busy: boolean;
  isEditing: boolean;
}

function ActionRow({
  questionId,
  onAccept,
  onAcceptFix,
  onEdit,
  onDelete,
  busy,
  isEditing,
}: ActionRowProps) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        size="sm"
        variant="outline"
        className="border-green-500/30 hover:bg-green-500/10 hover:text-green-500"
        onClick={onAccept}
        disabled={busy}
        data-testid={`button-accept-${questionId}`}
      >
        <Check className="w-3 h-3 mr-1" /> {onAcceptFix ? 'Accept as-is' : 'Accept'}
      </Button>
      {onAcceptFix && (
        <Button
          size="sm"
          className="bg-green-600 hover:bg-green-700 text-white"
          onClick={onAcceptFix}
          disabled={busy}
          data-testid={`button-accept-fix-${questionId}`}
        >
          <Check className="w-3 h-3 mr-1" /> Accept Fix
        </Button>
      )}
      <Button
        size="sm"
        variant="outline"
        className="border-amber-500/30 hover:bg-amber-500/10 hover:text-amber-500"
        onClick={onEdit}
        disabled={busy || isEditing}
        data-testid={`button-edit-${questionId}`}
      >
        <Pencil className="w-3 h-3 mr-1" /> Edit
      </Button>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            className="border-red-500/30 hover:bg-red-500/10 hover:text-red-500"
            disabled={busy}
            data-testid={`button-delete-${questionId}`}
          >
            <Trash2 className="w-3 h-3 mr-1" /> Delete
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this question?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the question from the database. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={onDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// InlineEditor
// ---------------------------------------------------------------------------

interface InlineEditorProps {
  draft: EditDraft;
  onChange: (field: EditField, value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
  questionId: string;
}

function InlineEditor({ draft, onChange, onSave, onCancel, busy, questionId }: InlineEditorProps) {
  return (
    <div className="mt-3 p-3 rounded-md border border-amber-500/20 bg-amber-500/5 space-y-3">
      <p className="text-[10px] uppercase tracking-wide text-amber-500 font-semibold">
        Editing question
      </p>
      <div className="space-y-1">
        <p className="text-[10px] uppercase text-muted-foreground">Question</p>
        <Textarea
          value={draft.question}
          onChange={(e) => onChange('question', e.target.value)}
          className="min-h-[60px] text-xs"
          data-testid={`edit-question-${questionId}`}
        />
      </div>
      <div className="space-y-1">
        <p className="text-[10px] uppercase text-muted-foreground">Answer</p>
        <Input
          value={draft.answer}
          onChange={(e) => onChange('answer', e.target.value)}
          className="text-xs"
          data-testid={`edit-answer-${questionId}`}
        />
      </div>
      <div className="space-y-1">
        <p className="text-[10px] uppercase text-muted-foreground">Explanation</p>
        <Textarea
          value={draft.explanation}
          onChange={(e) => onChange('explanation', e.target.value)}
          className="min-h-[60px] text-xs"
          data-testid={`edit-explanation-${questionId}`}
        />
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={onSave} disabled={busy} data-testid={`save-${questionId}`}>
          <Save className="w-3 h-3 mr-1" />
          {busy ? 'Saving...' : 'Save'}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onCancel}
          disabled={busy}
          data-testid={`cancel-${questionId}`}
        >
          <X className="w-3 h-3 mr-1" /> Cancel
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FindingRow — wraps any finding with edit/delete/accept actions
// ---------------------------------------------------------------------------

interface FindingRowProps {
  editKey: string;
  questionId: string;
  findingType: QualityFindingType;
  findingKey: string;
  children: React.ReactNode;
  actions: EditActions;
  proposedFix?: Record<string, unknown>;
  rule?: string;
}

function FindingRow({
  editKey,
  questionId,
  findingType,
  findingKey,
  children,
  actions,
  proposedFix,
  rule,
}: FindingRowProps) {
  const isEditing = actions.editingKey === editKey;
  const draft = actions.editDrafts[editKey];
  const busy = actions.busyKey === editKey;
  const applyFn = rule ? extractApplicableFix(rule, proposedFix) : null;
  return (
    <div className="border border-white/10 rounded-md p-3 space-y-3 bg-white/[0.02]">
      {children}
      <ActionRow
        questionId={questionId}
        onAccept={() => actions.onAccept(findingType, questionId, findingKey, editKey)}
        onAcceptFix={
          applyFn
            ? () => actions.onAcceptFix(findingType, questionId, findingKey, editKey, applyFn)
            : undefined
        }
        onEdit={() => actions.onStartEdit(editKey, questionId)}
        onDelete={() => actions.onDelete(editKey, questionId)}
        busy={busy}
        isEditing={isEditing}
      />
      {isEditing && draft && (
        <InlineEditor
          draft={draft}
          questionId={questionId}
          busy={busy}
          onChange={(field, value) => actions.onDraftChange(editKey, field, value)}
          onSave={() => actions.onSaveEdit(editKey, questionId)}
          onCancel={() => actions.onCancelEdit(editKey)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Removed-findings state type
// ---------------------------------------------------------------------------

interface RemovedFindings {
  static: Set<string>;
  duplicate: Set<string>;
  factCheck: Set<string>;
  deletedQuestionIds: Set<string>;
}

// ---------------------------------------------------------------------------
// Issue-type filter state
// ---------------------------------------------------------------------------

interface IssueTypeFilter {
  showAudit: boolean;
  showDuplicates: boolean;
  showFactCheck: boolean;
  auditRules: Set<QuestionQualityRule>;
}

const RULE_LABELS: Record<QuestionQualityRule, string> = {
  missing_required_field: 'Missing Required Field',
  duplicate_question_id: 'Duplicate Question ID',
  invalid_difficulty: 'Invalid Difficulty',
  missing_required_tags: 'Missing Required Tags',
  category_tag_mismatch: 'Category/Tag Mismatch',
  answer_leakage: 'Answer Leakage',
  subjective_prompt: 'Subjective Prompt',
  ambiguous_prompt_format: 'Ambiguous Prompt',
  multi_answer_mismatch: 'Multi-Answer Mismatch',
  answer_type_mismatch: 'Answer Type Mismatch',
  potentially_incorrect_or_unverifiable: 'Potentially Incorrect',
  missing_source_metadata: 'Missing Source Metadata',
};

function buildDefaultFilter(report: QualitySweepReport): IssueTypeFilter {
  const auditRules = new Set<QuestionQualityRule>(report.audit.findings.map((f) => f.rule));
  return {
    showAudit: true,
    showDuplicates: true,
    showFactCheck: true,
    auditRules,
  };
}

// ---------------------------------------------------------------------------
// Visibility filter helpers (pure — no hooks)
// ---------------------------------------------------------------------------

function filterStaticFindings(findings: QuestionQualityFinding[], removed: RemovedFindings) {
  return findings.filter(
    (f) =>
      !removed.deletedQuestionIds.has(f.questionId) && !isStaticFindingDismissed(removed.static, f)
  );
}

function filterDuplicates(matches: DuplicateMatch[], removed: RemovedFindings) {
  return matches.filter((m) => {
    if (
      removed.deletedQuestionIds.has(m.questionIdA) ||
      removed.deletedQuestionIds.has(m.questionIdB)
    ) {
      return false;
    }
    return !removed.duplicate.has(duplicatePairKey(m.questionIdA, m.questionIdB));
  });
}

function filterFactCheck(results: FactCheckVerdict[], removed: RemovedFindings) {
  return results.filter(
    (r) => !removed.deletedQuestionIds.has(r.questionId) && !removed.factCheck.has(r.questionId)
  );
}

// ---------------------------------------------------------------------------
// FilterBar
// ---------------------------------------------------------------------------

function FilterBar({
  report,
  removed,
  filter,
  setFilter,
}: {
  report: QualitySweepReport;
  removed: RemovedFindings;
  filter: IssueTypeFilter;
  setFilter: (fn: (prev: IssueTypeFilter) => IssueTypeFilter) => void;
}) {
  const [rulesExpanded, setRulesExpanded] = useState(false);

  const visibleAudit = filterStaticFindings(report.audit.findings, removed);
  const visibleDups = report.duplicates
    ? filterDuplicates(report.duplicates.duplicatesFound, removed)
    : [];
  const visibleFc = report.factCheck ? filterFactCheck(report.factCheck.results, removed) : [];

  const auditCount = visibleAudit.length;
  const dupCount = visibleDups.length;
  const fcCount = visibleFc.length;

  // Count findings per audit rule (post-removal, pre-filter)
  const ruleCounts = new Map<QuestionQualityRule, number>();
  for (const f of visibleAudit) {
    ruleCounts.set(f.rule, (ruleCounts.get(f.rule) ?? 0) + 1);
  }
  const presentRules = Array.from(ruleCounts.keys()).sort((a, b) =>
    RULE_LABELS[a].localeCompare(RULE_LABELS[b])
  );

  const toggleCategory = (key: 'showAudit' | 'showDuplicates' | 'showFactCheck') => {
    setFilter((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleRule = (rule: QuestionQualityRule) => {
    setFilter((prev) => {
      const next = new Set(prev.auditRules);
      if (next.has(rule)) {
        next.delete(rule);
      } else {
        next.add(rule);
      }
      return { ...prev, auditRules: next };
    });
  };

  const selectAllRules = () => {
    setFilter((prev) => ({ ...prev, auditRules: new Set(presentRules) }));
  };

  const clearAllRules = () => {
    setFilter((prev) => ({ ...prev, auditRules: new Set() }));
  };

  return (
    <Card className="bg-white/5 border-white/10">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <ListFilter className="w-5 h-5" />
          Filter Findings
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {auditCount > 0 && (
            <Button
              size="sm"
              variant={filter.showAudit ? 'default' : 'outline'}
              onClick={() => toggleCategory('showAudit')}
              data-testid="filter-toggle-audit"
            >
              Audit Findings
              <Badge variant="secondary" className="ml-1.5 text-[10px]">
                {auditCount}
              </Badge>
            </Button>
          )}
          {dupCount > 0 && (
            <Button
              size="sm"
              variant={filter.showDuplicates ? 'default' : 'outline'}
              onClick={() => toggleCategory('showDuplicates')}
              data-testid="filter-toggle-duplicates"
            >
              Duplicates
              <Badge variant="secondary" className="ml-1.5 text-[10px]">
                {dupCount}
              </Badge>
            </Button>
          )}
          {fcCount > 0 && (
            <Button
              size="sm"
              variant={filter.showFactCheck ? 'default' : 'outline'}
              onClick={() => toggleCategory('showFactCheck')}
              data-testid="filter-toggle-factcheck"
            >
              Fact-Check
              <Badge variant="secondary" className="ml-1.5 text-[10px]">
                {fcCount}
              </Badge>
            </Button>
          )}
        </div>

        {filter.showAudit && presentRules.length >= 2 && (
          <div>
            <button
              type="button"
              onClick={() => setRulesExpanded((v) => !v)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-white transition-colors"
              data-testid="filter-expand-rules"
            >
              {rulesExpanded ? (
                <ChevronUp className="w-3 h-3" />
              ) : (
                <ChevronDown className="w-3 h-3" />
              )}
              {rulesExpanded ? 'Hide' : 'Show'} audit rule filters
            </button>
            {rulesExpanded && (
              <div className="mt-2 pt-2 border-t border-white/10 space-y-2">
                <div className="flex gap-3 text-[11px]">
                  <button
                    type="button"
                    onClick={selectAllRules}
                    className="text-muted-foreground hover:text-white transition-colors underline"
                    data-testid="filter-select-all"
                  >
                    Select All
                  </button>
                  <button
                    type="button"
                    onClick={clearAllRules}
                    className="text-muted-foreground hover:text-white transition-colors underline"
                    data-testid="filter-clear-all"
                  >
                    Clear
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {presentRules.map((rule) => (
                    <div key={rule} className="flex items-center gap-2">
                      <Checkbox
                        id={`filter-rule-${rule}`}
                        checked={filter.auditRules.has(rule)}
                        onCheckedChange={() => toggleRule(rule)}
                      />
                      <Label
                        htmlFor={`filter-rule-${rule}`}
                        className="text-xs cursor-pointer flex items-center gap-1.5"
                      >
                        {RULE_LABELS[rule]}
                        <span className="text-muted-foreground">({ruleCounts.get(rule)})</span>
                      </Label>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// SummarySection
// ---------------------------------------------------------------------------

function SummarySection({
  report,
  removed,
  filter,
}: {
  report: QualitySweepReport;
  removed: RemovedFindings;
  filter: IssueTypeFilter;
}) {
  const allVisible = filterStaticFindings(report.audit.findings, removed);
  const visible = filter.showAudit ? allVisible.filter((f) => filter.auditRules.has(f.rule)) : [];
  const visibleHigh = visible.filter((f) => f.severity === 'high').length;
  const visibleMedium = visible.filter((f) => f.severity === 'medium').length;
  const visibleDupClusters =
    filter.showDuplicates && report.duplicates
      ? buildClusters(filterDuplicates(report.duplicates.duplicatesFound, removed)).length
      : null;
  return (
    <Card className="bg-white/5 border-white/10">
      <CardHeader>
        <CardTitle className="text-lg">Summary</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Questions scanned</p>
            <p className="text-2xl font-bold">{report.totalQuestions}</p>
          </div>
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Open findings</p>
            <p className="text-2xl font-bold">{visible.length}</p>
          </div>
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">High</p>
            <p className="text-2xl font-bold text-red-400">{visibleHigh}</p>
          </div>
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Medium</p>
            <p className="text-2xl font-bold text-yellow-400">{visibleMedium}</p>
          </div>
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Dup clusters</p>
            <p className="text-2xl font-bold">{visibleDupClusters ?? '—'}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// AuditFindingsSection
// ---------------------------------------------------------------------------

function AuditFindingsSection({
  findings,
  removed,
  questionsById,
  actions,
  filter,
}: {
  findings: QuestionQualityFinding[];
  removed: RemovedFindings;
  questionsById: Record<string, QuestionSnapshot> | undefined;
  actions: EditActions;
  filter?: IssueTypeFilter;
}) {
  const visible = filterStaticFindings(findings, removed).filter(
    (f) => !filter || filter.auditRules.has(f.rule)
  );
  const grouped = {
    high: visible.filter((f) => f.severity === 'high'),
    medium: visible.filter((f) => f.severity === 'medium'),
    low: visible.filter((f) => f.severity === 'low'),
  };

  if (visible.length === 0) {
    return (
      <Card className="bg-white/5 border-white/10">
        <CardHeader>
          <CardTitle className="text-lg">Static Audit Findings</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No static audit findings.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-white/5 border-white/10">
      <CardHeader>
        <CardTitle className="text-lg">Static Audit Findings ({visible.length})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {(['high', 'medium', 'low'] as const).map((severity) => {
          const group = grouped[severity];
          if (group.length === 0) return null;
          return (
            <div key={severity} className="space-y-3">
              <h4 className="text-sm font-semibold flex items-center gap-2">
                <SeverityBadge severity={severity} />
                {group.length} finding{group.length !== 1 ? 's' : ''}
              </h4>
              <div className="space-y-2">
                {group.map((finding) => {
                  const findingKey = buildStaticFindingKey(finding);
                  const editKey = `static::${finding.questionId}::${findingKey}`;
                  const snapshot = questionsById?.[finding.questionId];
                  return (
                    <FindingRow
                      key={editKey}
                      editKey={editKey}
                      questionId={finding.questionId}
                      findingType="static"
                      findingKey={findingKey}
                      actions={actions}
                      proposedFix={finding.proposedFix}
                      rule={finding.rule}
                    >
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline">{finding.rule}</Badge>
                          <span className="font-mono text-xs text-muted-foreground">
                            {finding.questionId}
                          </span>
                        </div>
                        {snapshot && (
                          <p className="text-sm font-medium text-white/90 leading-snug">
                            {snapshot.question}
                          </p>
                        )}
                        <p className="text-sm text-muted-foreground">{finding.message}</p>
                        <ExpandableDetails finding={finding} snapshot={snapshot} />
                      </div>
                    </FindingRow>
                  );
                })}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Duplicate clustering — groups related pairs into clusters
// ---------------------------------------------------------------------------

interface DuplicateCluster {
  id: string;
  questionIds: string[];
  questions: Map<string, { question: string; answer: string }>;
  matches: DuplicateMatch[];
  worstMatchType: 'exact' | 'near_duplicate' | 'conceptual';
  highestScore: number;
}

const MATCH_SEVERITY: Record<string, number> = { exact: 3, near_duplicate: 2, conceptual: 1 };

function buildClusters(matches: DuplicateMatch[]): DuplicateCluster[] {
  const parent = new Map<string, string>();

  function find(x: string): string {
    if (!parent.has(x)) parent.set(x, x);
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cur = x;
    while (cur !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  function union(a: string, b: string) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  for (const m of matches) {
    union(m.questionIdA, m.questionIdB);
  }

  const groups = new Map<string, DuplicateMatch[]>();
  for (const m of matches) {
    const root = find(m.questionIdA);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(m);
  }

  const clusters: DuplicateCluster[] = [];
  groups.forEach((clusterMatches, root) => {
    const qMap = new Map<string, { question: string; answer: string }>();
    let worstType = 'conceptual' as DuplicateMatch['matchType'];
    let highestScore = 0;

    for (const m of clusterMatches) {
      qMap.set(m.questionIdA, { question: m.questionTextA, answer: m.answerA });
      qMap.set(m.questionIdB, { question: m.questionTextB, answer: m.answerB });
      if (MATCH_SEVERITY[m.matchType] > MATCH_SEVERITY[worstType]) worstType = m.matchType;
      if (m.similarityScore > highestScore) highestScore = m.similarityScore;
    }

    clusters.push({
      id: root,
      questionIds: Array.from(qMap.keys()),
      questions: qMap,
      matches: clusterMatches,
      worstMatchType: worstType,
      highestScore,
    });
  });

  clusters.sort(
    (a, b) =>
      MATCH_SEVERITY[b.worstMatchType] - MATCH_SEVERITY[a.worstMatchType] ||
      b.highestScore - a.highestScore
  );
  return clusters;
}

// ---------------------------------------------------------------------------
// DuplicatesSection — cluster view
// ---------------------------------------------------------------------------

function DuplicatesSection({
  duplicates,
  removed,
  questionsById,
  actions,
}: {
  duplicates: DuplicateMatch[];
  removed: RemovedFindings;
  questionsById: Record<string, QuestionSnapshot> | undefined;
  actions: EditActions;
}) {
  const visible = filterDuplicates(duplicates, removed);
  const clusters = buildClusters(visible);

  if (clusters.length === 0) {
    return (
      <Card className="bg-white/5 border-white/10">
        <CardHeader>
          <CardTitle className="text-lg">Duplicates</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No duplicates found.</p>
        </CardContent>
      </Card>
    );
  }

  const totalQuestions = clusters.reduce((sum, c) => sum + c.questionIds.length, 0);

  return (
    <Card className="bg-white/5 border-white/10">
      <CardHeader>
        <CardTitle className="text-lg">
          Duplicates ({clusters.length} cluster{clusters.length !== 1 ? 's' : ''}, {totalQuestions}{' '}
          questions)
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Related questions are grouped together. Review each cluster and delete the extras.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {clusters.map((cluster) => {
          const clusterKey = `cluster::${cluster.id}`;

          return (
            <div
              key={clusterKey}
              className="border border-white/10 rounded-lg p-4 space-y-4 bg-white/[0.02]"
              data-testid={`duplicate-cluster-${cluster.id}`}
            >
              <div className="flex items-center gap-2 flex-wrap">
                <MatchTypeBadge type={cluster.worstMatchType} />
                <span className="text-xs font-mono">
                  top score {cluster.highestScore.toFixed(2)}
                </span>
                <Badge variant="outline" className="text-xs">
                  {cluster.questionIds.length} questions
                </Badge>
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto border-green-500/30 hover:bg-green-500/10 hover:text-green-500"
                  onClick={async () => {
                    for (const m of cluster.matches) {
                      const pk = duplicatePairKey(m.questionIdA, m.questionIdB);
                      await actions.onAccept('duplicate', m.questionIdA, pk, `dup::${pk}`);
                    }
                  }}
                  disabled={!!actions.busyKey}
                  data-testid={`button-dismiss-cluster-${cluster.id}`}
                >
                  <Check className="w-3 h-3 mr-1" /> Dismiss cluster
                </Button>
              </div>

              {cluster.matches.some((m) => m.aiReasoning) && (
                <div className="space-y-1">
                  {cluster.matches
                    .filter((m) => m.aiReasoning)
                    .map((m) => (
                      <p
                        key={`${m.questionIdA}-${m.questionIdB}`}
                        className="text-xs text-muted-foreground italic"
                      >
                        AI: {truncate(m.aiReasoning!, 200)}
                      </p>
                    ))}
                </div>
              )}

              <div className="space-y-3">
                {cluster.questionIds.map((qId) => {
                  const qData = cluster.questions.get(qId)!;
                  const snapshot = questionsById?.[qId];
                  const editKey = `dup::${cluster.id}::${qId}`;
                  const isEditing = actions.editingKey === editKey;
                  const busy = actions.busyKey === editKey;
                  const relatedPairKeys = cluster.matches
                    .filter((m) => m.questionIdA === qId || m.questionIdB === qId)
                    .map((m) => duplicatePairKey(m.questionIdA, m.questionIdB));

                  return (
                    <div
                      key={qId}
                      className="border border-white/10 rounded p-3 space-y-2"
                      data-testid={`duplicate-question-${qId}`}
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-[10px] text-muted-foreground">{qId}</span>
                        {snapshot && (
                          <>
                            <Badge variant="outline" className="text-xs border-white/20">
                              {snapshot.category}
                            </Badge>
                            {snapshot.difficulty && (
                              <Badge variant="outline" className="text-xs border-white/20">
                                {snapshot.difficulty}
                              </Badge>
                            )}
                            {snapshot.sourceDomain && (
                              <Badge variant="outline" className="text-xs border-white/20">
                                Source: {snapshot.sourceDomain}
                              </Badge>
                            )}
                            {!snapshot.hasSource && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-300">
                                no source
                              </span>
                            )}
                          </>
                        )}
                      </div>
                      <p className="text-sm font-medium text-white/90 leading-snug">
                        {qData.question}
                      </p>
                      <HiddenAnswer answer={qData.answer} />
                      <div className="flex flex-wrap gap-2 pt-1">
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-green-500/30 hover:bg-green-500/10 hover:text-green-500"
                          onClick={() => {
                            for (const pk of relatedPairKeys) {
                              actions.onAccept('duplicate', qId, pk, `dup::${pk}`);
                            }
                          }}
                          disabled={busy}
                          data-testid={`button-accept-${qId}`}
                        >
                          <Check className="w-3 h-3 mr-1" /> Accept
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-amber-500/30 hover:bg-amber-500/10 hover:text-amber-500"
                          onClick={() => actions.onStartEdit(editKey, qId)}
                          disabled={busy || isEditing}
                          data-testid={`button-edit-${qId}`}
                        >
                          <Pencil className="w-3 h-3 mr-1" /> Edit
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-red-500/30 hover:bg-red-500/10 hover:text-red-500"
                              disabled={busy}
                              data-testid={`button-delete-${qId}`}
                            >
                              <Trash2 className="w-3 h-3 mr-1" /> Delete
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete this question?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This permanently removes the question from the database and seed
                                data. It will not come back on restart.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                className="bg-red-600 hover:bg-red-700"
                                onClick={() => actions.onDelete(editKey, qId)}
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                      {isEditing && actions.editDrafts[editKey] && (
                        <InlineEditor
                          draft={actions.editDrafts[editKey]}
                          questionId={qId}
                          busy={busy}
                          onChange={(field, value) => actions.onDraftChange(editKey, field, value)}
                          onSave={() => actions.onSaveEdit(editKey, qId)}
                          onCancel={() => actions.onCancelEdit(editKey)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// FactCheckSection
// ---------------------------------------------------------------------------

function FactCheckSection({
  results,
  removed,
  questionsById,
  actions,
}: {
  results: FactCheckVerdict[];
  removed: RemovedFindings;
  questionsById: Record<string, QuestionSnapshot> | undefined;
  actions: EditActions;
}) {
  const actionable = filterFactCheck(
    results.filter((r) => {
      if (r.verdict === 'pass') return false;
      if (r.verdict === 'fail') return true;
      const snapshot = questionsById?.[r.questionId];
      return r.confidence > 95 || (snapshot ? !snapshot.hasSource : true);
    }),
    removed
  );

  if (actionable.length === 0) {
    return (
      <Card className="bg-white/5 border-white/10">
        <CardHeader>
          <CardTitle className="text-lg">Fact-Check Results</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">All questions passed fact-check.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-white/5 border-white/10">
      <CardHeader>
        <CardTitle className="text-lg">
          Fact-Check Results ({actionable.length} need attention)
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Showing fails and high-confidence flags (&gt;95%) or questions without a source.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {actionable.map((result) => {
          const editKey = `fc::${result.questionId}`;
          const snapshot = questionsById?.[result.questionId];
          return (
            <FindingRow
              key={editKey}
              editKey={editKey}
              questionId={result.questionId}
              findingType="fact_check"
              findingKey={FACT_CHECK_FINDING_KEY}
              actions={actions}
            >
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <VerdictBadge verdict={result.verdict} />
                  {result.coherence === 'fail' && (
                    <Badge variant="destructive" className="text-xs">
                      coherence
                    </Badge>
                  )}
                  <span className="text-xs font-mono">{result.confidence}%</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {result.questionId}
                  </span>
                  {snapshot && (
                    <>
                      <Badge variant="outline" className="text-xs border-white/20">
                        {snapshot.category}
                      </Badge>
                      {snapshot.difficulty && (
                        <Badge variant="outline" className="text-xs border-white/20">
                          {snapshot.difficulty}
                        </Badge>
                      )}
                      {snapshot.sourceDomain && (
                        <Badge variant="outline" className="text-xs border-white/20">
                          Source: {snapshot.sourceDomain}
                        </Badge>
                      )}
                      {!snapshot.hasSource && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-300">
                          no source
                        </span>
                      )}
                    </>
                  )}
                </div>
                {snapshot && (
                  <p className="text-sm font-medium text-white/90 leading-snug">
                    {snapshot.question}
                  </p>
                )}
                <p className="text-sm text-muted-foreground">{result.reason}</p>
                {result.suggestedQuestion && (
                  <div className="mt-1 rounded border border-emerald-500/30 bg-emerald-500/10 p-2">
                    <p className="text-[10px] uppercase tracking-wide text-emerald-300">
                      Suggested rewrite (keeps the answer, fixes the premise)
                    </p>
                    <p className="text-sm text-white/90 leading-snug">{result.suggestedQuestion}</p>
                  </div>
                )}
                {snapshot && (
                  <div className="pt-1">
                    <HiddenAnswer answer={snapshot.answer} />
                  </div>
                )}
              </div>
            </FindingRow>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AdminQualitySweep() {
  const [_, setLocation] = useLocation();
  const { toast } = useToast();
  const { user, isLoading: authLoading, isAuthenticated } = useAuth();
  const { isAdmin, isLoading: adminLoading } = useAdmin();
  const { state, updateQuestion, deleteQuestion } = useGame();

  const [skipFactCheck, setSkipFactCheck] = useState(false);
  const [skipDuplicates, setSkipDuplicates] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [report, setReport] = useState<QualitySweepReport | null>(null);
  const [filter, setFilter] = useState<IssueTypeFilter | null>(null);

  const [removed, setRemoved] = useState<RemovedFindings>({
    static: new Set(),
    duplicate: new Set(),
    factCheck: new Set(),
    deletedQuestionIds: new Set(),
  });

  const [editDrafts, setEditDrafts] = useState<Record<string, EditDraft>>({});
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  // Local question cache — ensures edit/save works regardless of game state phase.
  // state.questions only loads during SETUP; this fetches independently on mount.
  const [allQuestions, setAllQuestions] = useState<Question[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/questions', { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setAllQuestions(Array.isArray(data) ? data : (data.questions ?? []));
      } catch {
        // Silently fall back to state.questions if fetch fails
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const findQuestion = (questionId: string): Question | undefined =>
    state.questions.find((q) => q.id === questionId) ??
    allQuestions.find((q) => q.id === questionId);

  const handleRunSweep = async () => {
    setIsRunning(true);
    setReport(null);
    setFilter(null);
    setRemoved({
      static: new Set(),
      duplicate: new Set(),
      factCheck: new Set(),
      deletedQuestionIds: new Set(),
    });
    setEditDrafts({});
    setEditingKey(null);
    const keepAlive = setInterval(() => {
      fetch('/api/auth/user', { credentials: 'include' }).catch(() => {});
    }, 60_000);
    try {
      const controller = new AbortController();
      const abortTimer = setTimeout(() => controller.abort(), 10 * 60 * 1000);
      const response = await fetch('/api/admin/quality-sweep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ skipFactCheck, skipDuplicates }),
        signal: controller.signal,
      });
      clearTimeout(abortTimer);
      if (!response.ok) {
        const text = (await response.text()) || response.statusText;
        throw new Error(`${response.status}: ${text}`);
      }
      const data = (await response.json()) as QualitySweepReport;
      setReport(data);
      setFilter(buildDefaultFilter(data));
      toast({
        title: 'Sweep Complete',
        description: `Scanned ${data.totalQuestions} question(s). ${data.recommendations.length} recommendation(s).`,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Quality sweep could not be completed.';
      const isRateLimited = message.startsWith('429');
      toast({
        title: isRateLimited ? 'Rate Limit Reached' : 'Sweep Failed',
        description: isRateLimited ? 'Please wait before running another sweep.' : message,
        variant: 'destructive',
      });
    } finally {
      clearInterval(keepAlive);
      setIsRunning(false);
    }
  };

  const dismissOnServer = async (req: DismissFindingRequest) => {
    await apiRequest('POST', '/api/admin/quality-sweep/dismiss', req);
  };

  const handleAccept = async (
    findingType: QualityFindingType,
    questionId: string,
    findingKey: string,
    editKey: string
  ) => {
    setBusyKey(editKey);
    try {
      await dismissOnServer({ questionId, findingType, findingKey });
      setRemoved((prev) => {
        const next = { ...prev };
        if (findingType === 'static') {
          next.static = new Set(prev.static).add(`${questionId}::${findingKey}`);
        } else if (findingType === 'duplicate') {
          next.duplicate = new Set(prev.duplicate).add(findingKey);
        } else {
          next.factCheck = new Set(prev.factCheck).add(questionId);
        }
        return next;
      });
      toast({ title: 'Finding dismissed', description: 'It will not appear in future sweeps.' });
    } catch (error) {
      toast({
        title: 'Dismiss failed',
        description: error instanceof Error ? error.message : 'Could not dismiss finding.',
        variant: 'destructive',
      });
    } finally {
      setBusyKey(null);
    }
  };

  const handleAcceptFix = async (
    findingType: QualityFindingType,
    questionId: string,
    findingKey: string,
    editKey: string,
    applyFn: ApplyFixFn
  ) => {
    const sourceQ = findQuestion(questionId);
    if (!sourceQ) {
      toast({
        title: 'Question not loaded',
        description: 'The question is not in the local catalog. Reload the app and retry.',
        variant: 'destructive',
      });
      return;
    }
    setBusyKey(editKey);
    try {
      const patch = applyFn(sourceQ);
      const persisted = await updateQuestion(questionId, patch);
      setAllQuestions((prev) => prev.map((q) => (q.id === questionId ? persisted : q)));
    } catch (error) {
      toast({
        title: 'Apply fix failed',
        description: error instanceof Error ? error.message : 'Could not update the question.',
        variant: 'destructive',
      });
      setBusyKey(null);
      return;
    }

    // Question is updated — always remove from UI so admin doesn't retry a stale finding.
    const markRemoved = () =>
      setRemoved((prev) => {
        const next = { ...prev };
        if (findingType === 'static') {
          next.static = new Set(prev.static).add(`${questionId}::${findingKey}`);
        } else if (findingType === 'duplicate') {
          next.duplicate = new Set(prev.duplicate).add(findingKey);
        } else {
          next.factCheck = new Set(prev.factCheck).add(questionId);
        }
        return next;
      });

    try {
      await dismissOnServer({ questionId, findingType, findingKey });
      markRemoved();
      toast({ title: 'Fix applied', description: 'Question updated and finding dismissed.' });
    } catch {
      // Update succeeded but dismiss failed — still remove from UI to prevent duplicate writes.
      markRemoved();
      toast({
        title: 'Fix applied — dismiss failed',
        description:
          'Question was updated but the finding could not be dismissed. It may reappear on the next sweep.',
        variant: 'destructive',
      });
    } finally {
      setBusyKey(null);
    }
  };

  const handleStartEdit = (editKey: string, questionId: string) => {
    const sourceQ = findQuestion(questionId);
    if (!sourceQ) {
      toast({
        title: 'Question not loaded',
        description: 'The question is not in the local catalog. Reload the app and retry.',
        variant: 'destructive',
      });
      return;
    }
    setEditDrafts((prev) => ({ ...prev, [editKey]: buildDraft(sourceQ) }));
    setEditingKey(editKey);
  };

  const handleDraftChange = (editKey: string, field: EditField, value: string) => {
    setEditDrafts((prev) => {
      const existing = prev[editKey];
      if (!existing) return prev;
      return {
        ...prev,
        [editKey]: {
          ...existing,
          [field]: value,
          touched: { ...existing.touched, [field]: true },
        },
      };
    });
  };

  const handleSaveEdit = async (editKey: string, questionId: string) => {
    const draft = editDrafts[editKey];
    if (!draft) return;
    const sourceQ = findQuestion(questionId);
    if (!sourceQ) {
      toast({
        title: 'Question not loaded',
        description: 'Could not find the question data. Please reload the page.',
        variant: 'destructive',
      });
      return;
    }

    if (!draft.question.trim() || !draft.answer.trim()) {
      toast({
        title: 'Missing required fields',
        description: 'Question and answer are required.',
        variant: 'destructive',
      });
      return;
    }

    setBusyKey(editKey);
    try {
      const persisted = await updateQuestion(questionId, {
        question: draft.question.trim(),
        answer: draft.answer.trim(),
        explanation: draft.explanation.trim() || sourceQ.explanation,
      });
      setAllQuestions((prev) => prev.map((q) => (q.id === questionId ? persisted : q)));
      setEditingKey(null);
      setEditDrafts((prev) => {
        const next = { ...prev };
        delete next[editKey];
        return next;
      });
      toast({ title: 'Question updated', description: 'The fix has been saved.' });
    } catch (error) {
      toast({
        title: 'Update failed',
        description: error instanceof Error ? error.message : 'Could not update question.',
        variant: 'destructive',
      });
    } finally {
      setBusyKey(null);
    }
  };

  const handleCancelEdit = (editKey: string) => {
    setEditingKey(null);
    setEditDrafts((prev) => {
      const next = { ...prev };
      delete next[editKey];
      return next;
    });
  };

  const handleDelete = async (editKey: string, questionId: string) => {
    setBusyKey(editKey);
    try {
      await deleteQuestion(questionId);
      setRemoved((prev) => ({
        ...prev,
        deletedQuestionIds: new Set(prev.deletedQuestionIds).add(questionId),
      }));
      toast({ title: 'Question deleted' });
    } catch (error) {
      toast({
        title: 'Delete failed',
        description: error instanceof Error ? error.message : 'Could not delete question.',
        variant: 'destructive',
      });
    } finally {
      setBusyKey(null);
    }
  };

  const editActions: EditActions = {
    editingKey,
    editDrafts,
    busyKey,
    onAccept: handleAccept,
    onAcceptFix: handleAcceptFix,
    onStartEdit: handleStartEdit,
    onDraftChange: handleDraftChange,
    onSaveEdit: handleSaveEdit,
    onCancelEdit: handleCancelEdit,
    onDelete: handleDelete,
  };

  // Auth guards
  if (authLoading || adminLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto" />
          <p className="text-muted-foreground">Checking permissions...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <Card className="max-w-md w-full bg-white/5 border-white/10">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center">
              <Shield className="w-8 h-8 text-primary" />
            </div>
            <CardTitle className="text-2xl">Admin Access Required</CardTitle>
            <CardDescription>Please sign in to access the admin panel</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button
              className="w-full"
              size="lg"
              onClick={() => (window.location.href = '/api/login')}
            >
              <LogIn className="w-4 h-4 mr-2" />
              Sign In with Replit
            </Button>
            <Button variant="outline" className="w-full" onClick={() => setLocation('/')}>
              Back to Home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <Card className="max-w-md w-full bg-white/5 border-white/10 border-red-500/30">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center">
              <Shield className="w-8 h-8 text-red-500" />
            </div>
            <CardTitle className="text-2xl">Access Denied</CardTitle>
            <CardDescription>
              You don't have admin permissions. Contact an administrator to get access.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-3 bg-muted/50 rounded-lg text-sm">
              <p className="text-muted-foreground">Signed in as:</p>
              <p className="font-medium">{user?.email || 'Unknown user'}</p>
            </div>
            <Button variant="outline" className="w-full" onClick={() => setLocation('/')}>
              Back to Home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <ScanSearch className="w-8 h-8" />
            Quality Sweep
          </h2>
          <p className="text-muted-foreground">
            Scan all approved questions for duplicates, quality issues, and factual accuracy.
          </p>
        </div>

        <Card className="bg-white/5 border-white/10">
          <CardHeader>
            <CardTitle>Sweep Options</CardTitle>
            <CardDescription>
              Configure which checks to run. Fact-checking and conceptual duplicate detection use
              GPT-4o and may take a few minutes.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="skip-fact-check"
                  checked={skipFactCheck}
                  onCheckedChange={(checked) => setSkipFactCheck(checked === true)}
                  disabled={isRunning}
                />
                <Label htmlFor="skip-fact-check" className="text-sm cursor-pointer">
                  Skip fact-checking (faster, no GPT-4o API cost)
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="skip-duplicates"
                  checked={skipDuplicates}
                  onCheckedChange={(checked) => setSkipDuplicates(checked === true)}
                  disabled={isRunning}
                />
                <Label htmlFor="skip-duplicates" className="text-sm cursor-pointer">
                  Skip duplicate detection
                </Label>
              </div>
            </div>

            <Button onClick={handleRunSweep} disabled={isRunning} size="lg">
              <Play className="w-4 h-4 mr-2" />
              {isRunning ? 'Running Sweep...' : 'Run Quality Sweep'}
            </Button>

            {isRunning && (
              <p className="text-sm text-muted-foreground animate-pulse">
                Scanning questions... This may take a few minutes if fact-checking is enabled.
              </p>
            )}
          </CardContent>
        </Card>

        {report && filter && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-semibold">Report</h3>
              <p className="text-xs text-muted-foreground">
                Generated: {new Date(report.generatedAt).toLocaleString()}
              </p>
            </div>

            <SummarySection report={report} removed={removed} filter={filter} />

            <FilterBar
              report={report}
              removed={removed}
              filter={filter}
              setFilter={(fn) => setFilter((prev) => (prev ? fn(prev) : prev))}
            />

            {report.recommendations.length > 0 && (
              <Card className="bg-white/5 border-white/10">
                <CardHeader>
                  <CardTitle className="text-lg">Recommendations</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="list-disc list-inside space-y-1 text-sm">
                    {report.recommendations.map((rec, i) => (
                      <li key={i}>{rec}</li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {filter.showDuplicates && report.duplicates && (
              <DuplicatesSection
                duplicates={report.duplicates.duplicatesFound}
                removed={removed}
                questionsById={report.questionsById}
                actions={editActions}
              />
            )}

            {filter.showAudit && (
              <AuditFindingsSection
                findings={report.audit.findings}
                removed={removed}
                questionsById={report.questionsById}
                actions={editActions}
                filter={filter}
              />
            )}

            {filter.showFactCheck && report.factCheck && (
              <FactCheckSection
                results={report.factCheck.results}
                removed={removed}
                questionsById={report.questionsById}
                actions={editActions}
              />
            )}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
