import { useState } from 'react';
import { useLocation } from 'wouter';
import { ScanSearch, Play, LogIn, Shield, Check, Pencil, Trash2, Save, X, Eye, EyeOff, ChevronDown, ChevronUp } from 'lucide-react';
import { AdminLayout } from '@/components/admin-layout';
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
import { useGame, type Question } from '@/lib/store';
import {
  duplicatePairKey,
  FACT_CHECK_FINDING_KEY,
  type DismissFindingRequest,
  type DuplicateMatch,
  type FactCheckVerdict,
  type QualityFindingType,
  type QualitySweepReport,
  type QuestionQualityFinding,
  type QuestionSnapshot,
} from '@shared/models/quality-sweep';

function truncate(text: string, max = 80): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

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

function HiddenAnswer({ answer }: { answer: string }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <span className="font-medium">A:</span>{' '}
      {revealed ? (
        <span>{answer}</span>
      ) : (
        <span className="tracking-widest select-none">{'•'.repeat(Math.min(answer.length, 12))}</span>
      )}
      <button
        type="button"
        onClick={() => setRevealed((v) => !v)}
        className="ml-1 opacity-50 hover:opacity-100 transition-opacity"
        title={revealed ? 'Hide answer' : 'Reveal answer'}
        data-testid={`button-toggle-answer-${answer.slice(0, 8)}`}
      >
        {revealed ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
      </button>
    </span>
  );
}

// --- Proposed fix display ---

function ProposedFixDisplay({
  rule,
  fix,
}: {
  rule: string;
  fix: Record<string, unknown>;
}) {
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
                <span key={t} className="px-1.5 py-0.5 rounded bg-white/10 font-mono">{t}</span>
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
                  <span key={t} className="px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-300 font-mono">{t}</span>
                ))}
              </div>
            )}
            {missingPillar && (
              <div className="flex items-center gap-1 flex-wrap">
                <span className="text-muted-foreground w-12 shrink-0">Pillar:</span>
                {validPillarTags.map((t) => (
                  <span key={t} className="px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 font-mono">{t}</span>
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
              <span key={t} className="px-1.5 py-0.5 rounded bg-white/10 font-mono">{t}</span>
            ))}
            {currentTags.length === 0 && <span className="text-muted-foreground italic">none</span>}
          </div>
        </div>
        <div>
          <p className="text-[10px] uppercase text-muted-foreground mb-1">Proposed fix</p>
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">Add:</span>
            <span className="px-1.5 py-0.5 rounded bg-green-500/20 text-green-300 font-mono">{addTag}</span>
          </div>
        </div>
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
            <span key={f} className="px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-300 font-mono">{f}</span>
          ))}
        </div>
      </div>
    );
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

// --- Edit draft state ---

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

// --- Action button group (used by every finding row) ---

interface ActionRowProps {
  questionId: string;
  onAccept: () => void;
  onEdit: () => void;
  onDelete: () => void;
  busy: boolean;
  isEditing: boolean;
}

function ActionRow({ questionId, onAccept, onEdit, onDelete, busy, isEditing }: ActionRowProps) {
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
        <Check className="w-3 h-3 mr-1" /> Accept
      </Button>
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

// --- Inline editor (3 fields) ---

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

// --- Main page ---

interface RemovedFindings {
  static: Set<string>; // `${questionId}::${rule}`
  duplicate: Set<string>; // pair key
  factCheck: Set<string>; // questionId
  deletedQuestionIds: Set<string>;
}

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

  const [removed, setRemoved] = useState<RemovedFindings>({
    static: new Set(),
    duplicate: new Set(),
    factCheck: new Set(),
    deletedQuestionIds: new Set(),
  });

  // Edit drafts keyed by `${editKey}` (unique per finding row)
  const [editDrafts, setEditDrafts] = useState<Record<string, EditDraft>>({});
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const handleRunSweep = async () => {
    setIsRunning(true);
    setReport(null);
    setRemoved({
      static: new Set(),
      duplicate: new Set(),
      factCheck: new Set(),
      deletedQuestionIds: new Set(),
    });
    setEditDrafts({});
    setEditingKey(null);
    try {
      const response = await apiRequest('POST', '/api/admin/quality-sweep', {
        skipFactCheck,
        skipDuplicates,
      });
      const data = (await response.json()) as QualitySweepReport;
      setReport(data);
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
      setIsRunning(false);
    }
  };

  // --- Action handlers ---

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

  const handleStartEdit = (editKey: string, questionId: string) => {
    const sourceQ = state.questions.find((q) => q.id === questionId);
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
    const sourceQ = state.questions.find((q) => q.id === questionId);
    if (!sourceQ) return;

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
      await updateQuestion({
        ...sourceQ,
        question: draft.question.trim(),
        answer: draft.answer.trim(),
        explanation: draft.explanation.trim() || sourceQ.explanation,
      });
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

  // --- Filtering helpers (apply local removals on top of server report) ---

  const visibleStaticFindings = (findings: QuestionQualityFinding[]) =>
    findings.filter(
      (f) =>
        !removed.deletedQuestionIds.has(f.questionId) &&
        !removed.static.has(`${f.questionId}::${f.rule}`)
    );

  const visibleDuplicates = (matches: DuplicateMatch[]) =>
    matches.filter((m) => {
      if (
        removed.deletedQuestionIds.has(m.questionIdA) ||
        removed.deletedQuestionIds.has(m.questionIdB)
      ) {
        return false;
      }
      return !removed.duplicate.has(duplicatePairKey(m.questionIdA, m.questionIdB));
    });

  const visibleFactCheck = (results: FactCheckVerdict[]) =>
    results.filter(
      (r) => !removed.deletedQuestionIds.has(r.questionId) && !removed.factCheck.has(r.questionId)
    );

  // --- Section renderers ---

  function SummarySection({ report }: { report: QualitySweepReport }) {
    const visibleAuditCount = visibleStaticFindings(report.audit.findings).length;
    const visibleHigh = visibleStaticFindings(report.audit.findings).filter(
      (f) => f.severity === 'high'
    ).length;
    const visibleMedium = visibleStaticFindings(report.audit.findings).filter(
      (f) => f.severity === 'medium'
    ).length;
    const visibleDupCount = report.duplicates
      ? visibleDuplicates(report.duplicates.duplicatesFound).length
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
              <p className="text-2xl font-bold">{visibleAuditCount}</p>
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
              <p className="text-sm text-muted-foreground">Duplicates</p>
              <p className="text-2xl font-bold">{visibleDupCount ?? '—'}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  function FindingRow({
    editKey,
    questionId,
    findingType,
    findingKey,
    children,
  }: {
    editKey: string;
    questionId: string;
    findingType: QualityFindingType;
    findingKey: string;
    children: React.ReactNode;
  }) {
    const isEditing = editingKey === editKey;
    const draft = editDrafts[editKey];
    const busy = busyKey === editKey;
    return (
      <div className="border border-white/10 rounded-md p-3 space-y-3 bg-white/[0.02]">
        {children}
        <ActionRow
          questionId={questionId}
          onAccept={() => handleAccept(findingType, questionId, findingKey, editKey)}
          onEdit={() => handleStartEdit(editKey, questionId)}
          onDelete={() => handleDelete(editKey, questionId)}
          busy={busy}
          isEditing={isEditing}
        />
        {isEditing && draft && (
          <InlineEditor
            draft={draft}
            questionId={questionId}
            busy={busy}
            onChange={(field, value) => handleDraftChange(editKey, field, value)}
            onSave={() => handleSaveEdit(editKey, questionId)}
            onCancel={() => handleCancelEdit(editKey)}
          />
        )}
      </div>
    );
  }

  function AuditFindingsSection({ findings }: { findings: QuestionQualityFinding[] }) {
    const visible = visibleStaticFindings(findings);
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
                    const editKey = `static::${finding.questionId}::${finding.rule}`;
                    const snapshot = report?.questionsById?.[finding.questionId];
                    return (
                      <FindingRow
                        key={editKey}
                        editKey={editKey}
                        questionId={finding.questionId}
                        findingType="static"
                        findingKey={finding.rule}
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

  function DuplicatesSection({ duplicates }: { duplicates: DuplicateMatch[] }) {
    const visible = visibleDuplicates(duplicates);
    if (visible.length === 0) {
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

    return (
      <Card className="bg-white/5 border-white/10">
        <CardHeader>
          <CardTitle className="text-lg">
            Duplicates ({visible.length} pair{visible.length !== 1 ? 's' : ''})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {visible.map((match) => {
            const pairKey = duplicatePairKey(match.questionIdA, match.questionIdB);
            const editKeyA = `dup::${pairKey}::A`;
            const editKeyB = `dup::${pairKey}::B`;
            const isAEditing = editingKey === editKeyA;
            const isBEditing = editingKey === editKeyB;
            const busyA = busyKey === editKeyA;
            const busyB = busyKey === editKeyB;

            return (
              <div
                key={pairKey}
                className="border border-white/10 rounded-md p-3 space-y-3 bg-white/[0.02]"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <MatchTypeBadge type={match.matchType} />
                  <span className="text-xs font-mono">
                    score {match.similarityScore.toFixed(2)}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="ml-auto border-green-500/30 hover:bg-green-500/10 hover:text-green-500"
                    onClick={() =>
                      handleAccept('duplicate', match.questionIdA, pairKey, `dup::${pairKey}`)
                    }
                    disabled={busyKey === `dup::${pairKey}`}
                    data-testid={`button-accept-pair-${pairKey}`}
                  >
                    <Check className="w-3 h-3 mr-1" /> Accept pair
                  </Button>
                </div>
                {match.aiReasoning && (
                  <p className="text-xs text-muted-foreground italic">
                    AI: {truncate(match.aiReasoning, 200)}
                  </p>
                )}
                <div className="grid md:grid-cols-2 gap-3">
                  {/* Side A */}
                  <div className="border border-white/10 rounded p-2 space-y-2">
                    <p className="font-mono text-[10px] text-muted-foreground">
                      {match.questionIdA}
                    </p>
                    <p className="text-sm">{match.questionTextA}</p>
                    <HiddenAnswer answer={match.answerA} />
                    <ActionRow
                      questionId={match.questionIdA}
                      onAccept={() =>
                        handleAccept('duplicate', match.questionIdA, pairKey, `dup::${pairKey}`)
                      }
                      onEdit={() => handleStartEdit(editKeyA, match.questionIdA)}
                      onDelete={() => handleDelete(editKeyA, match.questionIdA)}
                      busy={busyA}
                      isEditing={isAEditing}
                    />
                    {isAEditing && editDrafts[editKeyA] && (
                      <InlineEditor
                        draft={editDrafts[editKeyA]}
                        questionId={match.questionIdA}
                        busy={busyA}
                        onChange={(field, value) => handleDraftChange(editKeyA, field, value)}
                        onSave={() => handleSaveEdit(editKeyA, match.questionIdA)}
                        onCancel={() => handleCancelEdit(editKeyA)}
                      />
                    )}
                  </div>
                  {/* Side B */}
                  <div className="border border-white/10 rounded p-2 space-y-2">
                    <p className="font-mono text-[10px] text-muted-foreground">
                      {match.questionIdB}
                    </p>
                    <p className="text-sm">{match.questionTextB}</p>
                    <HiddenAnswer answer={match.answerB} />
                    <ActionRow
                      questionId={match.questionIdB}
                      onAccept={() =>
                        handleAccept('duplicate', match.questionIdB, pairKey, `dup::${pairKey}`)
                      }
                      onEdit={() => handleStartEdit(editKeyB, match.questionIdB)}
                      onDelete={() => handleDelete(editKeyB, match.questionIdB)}
                      busy={busyB}
                      isEditing={isBEditing}
                    />
                    {isBEditing && editDrafts[editKeyB] && (
                      <InlineEditor
                        draft={editDrafts[editKeyB]}
                        questionId={match.questionIdB}
                        busy={busyB}
                        onChange={(field, value) => handleDraftChange(editKeyB, field, value)}
                        onSave={() => handleSaveEdit(editKeyB, match.questionIdB)}
                        onCancel={() => handleCancelEdit(editKeyB)}
                      />
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    );
  }

  function FactCheckSection({ results }: { results: FactCheckVerdict[] }) {
    const actionable = visibleFactCheck(
      results.filter((r) => r.verdict === 'fail' || r.verdict === 'flag')
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
        </CardHeader>
        <CardContent className="space-y-2">
          {actionable.map((result) => {
            const editKey = `fc::${result.questionId}`;
            return (
              <FindingRow
                key={editKey}
                editKey={editKey}
                questionId={result.questionId}
                findingType="fact_check"
                findingKey={FACT_CHECK_FINDING_KEY}
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <VerdictBadge verdict={result.verdict} />
                    <span className="text-xs font-mono">{result.confidence}%</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {result.questionId}
                    </span>
                  </div>
                  <p className="text-sm">{result.reason}</p>
                </div>
              </FindingRow>
            );
          })}
        </CardContent>
      </Card>
    );
  }

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

        {/* Controls */}
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

        {/* Report */}
        {report && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-semibold">Report</h3>
              <p className="text-xs text-muted-foreground">
                Generated: {new Date(report.generatedAt).toLocaleString()}
              </p>
            </div>

            <SummarySection report={report} />

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

            {report.duplicates && (
              <DuplicatesSection duplicates={report.duplicates.duplicatesFound} />
            )}

            <AuditFindingsSection findings={report.audit.findings} />

            {report.factCheck && <FactCheckSection results={report.factCheck.results} />}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
