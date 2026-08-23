import { useState, useEffect, useCallback, useRef } from 'react';
import { VALID_CATEGORIES } from '@shared/constants/categories';
import { AdminLayout } from '@/components/admin-layout';
import { HiddenAnswer } from '@/components/admin/HiddenAnswer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useAuth } from '@/hooks/use-auth';
import { useAdmin } from '@/hooks/use-admin';
import { useToast } from '@/hooks/use-toast';
import {
  ChevronDown,
  ChevronUp,
  Search,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  ExternalLink,
  AlertCircle,
  Wrench,
  Pencil,
  X,
  Check,
  Sparkles,
  History,
  Bot,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type QAFinding = { rule: string; message: string; severity: 'high' | 'medium' | 'low' };
type AiAnalysis = {
  qaFindings: QAFinding[];
  factCheck: { verdict: string; confidence: number; reason: string };
  repaired?: boolean;
};
type Question = {
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
  aiAnalysis: AiAnalysis | null;
  createdAt: string;
  updatedAt: string;
};
type EditRecord = {
  id: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  aiSuggested: boolean;
  changedAt: string;
  changedBy: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

type MissingField = { field: string; label: string };
function getMissingFields(q: Question): MissingField[] {
  const m: MissingField[] = [];
  if (!q.sourceUrl) m.push({ field: 'sourceUrl', label: 'Source URL' });
  if (!q.sourceName) m.push({ field: 'sourceName', label: 'Source Name' });
  if (!q.explanation) m.push({ field: 'explanation', label: 'Explanation' });
  if (!q.tags || q.tags.length === 0) m.push({ field: 'tags', label: 'Tags' });
  return m;
}

function getQaErrorsForField(field: string, q: Question): string[] {
  const errors: string[] = [];
  if (field === 'sourceUrl' && !q.sourceUrl) errors.push('Source URL is missing');
  if (field === 'sourceName' && !q.sourceName) errors.push('Source name is missing');
  if (field === 'explanation' && !q.explanation) errors.push('Explanation is missing');
  if (field === 'tags' && (!q.tags || q.tags.length === 0)) errors.push('Tags are missing');
  if (q.aiAnalysis?.qaFindings) {
    const FIELD_RULES: Record<string, string[]> = {
      sourceUrl: ['missing_source_metadata', 'potentially_incorrect_or_unverifiable'],
      sourceName: ['missing_source_metadata'],
      explanation: ['potentially_incorrect_or_unverifiable'],
      tags: ['missing_required_tags', 'category_tag_mismatch'],
      answer: ['answer_leakage', 'answer_type_mismatch', 'potentially_incorrect_or_unverifiable'],
      question: [
        'subjective_prompt',
        'ambiguous_prompt_format',
        'multi_answer_mismatch',
        'answer_leakage',
      ],
    };
    for (const finding of q.aiAnalysis.qaFindings) {
      if ((FIELD_RULES[field] ?? []).includes(finding.rule)) {
        if (!errors.includes(finding.message)) errors.push(finding.message);
      }
    }
    if (field === 'answer' && q.aiAnalysis.factCheck.verdict === 'fail') {
      errors.push(`Fact-check FAIL: ${q.aiAnalysis.factCheck.reason}`);
    }
  }
  return errors;
}

const FIXABLE_FIELDS = new Set([
  'sourceUrl',
  'sourceName',
  'explanation',
  'tags',
  'answer',
  'question',
  'acceptableAnswers',
]);

// Fields whose values are (or contain) the answer, so must stay spoiler-free.
const ANSWER_FIELDS = new Set(['answer', 'acceptableAnswers']);
function isAnswerField(field: string): boolean {
  return ANSWER_FIELDS.has(field);
}

function displayValue(field: string, q: Question): string {
  if (field === 'tags') return (q.tags ?? []).join(', ');
  if (field === 'acceptableAnswers') return (q.acceptableAnswers ?? []).join(', ');
  return (q[field as keyof Question] as string) ?? '';
}

function parseValueForSave(field: string, raw: string): unknown {
  if (field === 'tags' || field === 'acceptableAnswers') {
    // Check if it's already JSON array (from AI response)
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return raw;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  if (status === 'approved')
    return (
      <Badge className="bg-green-500/15 text-green-400 border-green-500/30 gap-1">
        <CheckCircle className="w-3 h-3" /> Approved
      </Badge>
    );
  if (status === 'pending')
    return (
      <Badge className="bg-yellow-500/15 text-yellow-400 border-yellow-500/30 gap-1">
        <Clock className="w-3 h-3" /> Pending
      </Badge>
    );
  if (status === 'rejected')
    return (
      <Badge className="bg-red-500/15 text-red-400 border-red-500/30 gap-1">
        <XCircle className="w-3 h-3" /> Rejected
      </Badge>
    );
  return <Badge variant="outline">{status}</Badge>;
}

function SeverityDot({ severity }: { severity: 'high' | 'medium' | 'low' }) {
  const c = { high: 'bg-red-400', medium: 'bg-yellow-400', low: 'bg-blue-400' };
  return <span className={`inline-block w-2 h-2 rounded-full ${c[severity]}`} />;
}

// ─── EditableField ────────────────────────────────────────────────────────────

interface EditableFieldProps {
  label: string;
  fieldKey: string;
  question: Question;
  inputType?: 'text' | 'textarea' | 'url';
  selectOptions?: readonly string[];
  onSaved: (updated: Question) => void;
}

function EditableField({
  label,
  fieldKey,
  question,
  inputType = 'text',
  selectOptions,
  onSaved,
}: EditableFieldProps) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSuggested, setAiSuggested] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  const errors = getQaErrorsForField(fieldKey, question);
  const hasErrors = errors.length > 0;
  const canAiFix = FIXABLE_FIELDS.has(fieldKey);
  const rawDisplay = displayValue(fieldKey, question);

  function startEdit() {
    setDraft(rawDisplay);
    setAiSuggested(false);
    setEditing(true);
    setTimeout(() => (inputRef.current as HTMLElement | null)?.focus(), 50);
  }

  function cancel() {
    setEditing(false);
    setAiSuggested(false);
  }

  async function save() {
    if (draft === rawDisplay) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const value = parseValueForSave(fieldKey, draft);
      const res = await fetch(`/api/admin/questions/${question.id}/field`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field: fieldKey, value, aiSuggested }),
      });
      if (!res.ok) throw new Error('Save failed');
      const updated: Question = await res.json();
      onSaved(updated);
      setEditing(false);
      toast({ title: 'Saved', description: `${label} updated.` });
    } catch {
      toast({ title: 'Error', description: 'Failed to save. Try again.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  async function fixWithAi() {
    setAiLoading(true);
    if (!editing) startEdit();
    try {
      const res = await fetch(`/api/admin/questions/${question.id}/ai-fix`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field: fieldKey }),
      });
      if (!res.ok) throw new Error('AI fix failed');
      const { suggestion } = await res.json();
      // For array fields, normalize JSON to display format
      if (fieldKey === 'tags' || fieldKey === 'acceptableAnswers') {
        try {
          const arr = JSON.parse(suggestion);
          if (Array.isArray(arr)) {
            setDraft(arr.join(', '));
          } else setDraft(suggestion);
        } catch {
          setDraft(suggestion);
        }
      } else {
        setDraft(suggestion);
      }
      setAiSuggested(true);
      setEditing(true);
      setTimeout(() => (inputRef.current as HTMLElement | null)?.focus(), 50);
    } catch {
      toast({
        title: 'AI fix failed',
        description: 'Could not get a suggestion.',
        variant: 'destructive',
      });
    } finally {
      setAiLoading(false);
    }
  }

  const isEmpty = !rawDisplay;

  return (
    <div className="group/field">
      {/* Label row */}
      <div className="flex items-center gap-1.5 mb-1">
        <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
        {hasErrors && (
          <TooltipProvider delayDuration={100}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={canAiFix ? fixWithAi : undefined}
                  disabled={aiLoading}
                  className="flex items-center gap-0.5 text-red-400 hover:text-orange-300 transition-colors disabled:opacity-50"
                  data-testid={`tooltip-error-${fieldKey}-${question.id}`}
                >
                  <AlertCircle className="w-3 h-3" />
                  {canAiFix && <Sparkles className="w-3 h-3" />}
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs space-y-1 text-xs" side="top">
                {errors.map((e, i) => (
                  <p key={i}>{e}</p>
                ))}
                {canAiFix && (
                  <p className="text-orange-300 font-medium mt-1">
                    {aiLoading ? 'Getting AI suggestion…' : '✦ Click to Fix with AI'}
                  </p>
                )}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        {/* Pencil — always present, fades in on hover */}
        {!editing && (
          <button
            onClick={startEdit}
            className="opacity-0 group-hover/field:opacity-100 transition-opacity text-muted-foreground hover:text-foreground ml-auto"
            data-testid={`btn-edit-${fieldKey}-${question.id}`}
          >
            <Pencil className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Content */}
      {editing ? (
        <div className="space-y-2">
          {selectOptions ? (
            <Select
              value={draft}
              onValueChange={(v) => {
                setDraft(v);
                setAiSuggested(false);
              }}
            >
              <SelectTrigger
                className="bg-white/5 border-white/20 text-sm"
                data-testid={`input-field-${fieldKey}-${question.id}`}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {selectOptions.map((opt) => (
                  <SelectItem key={opt} value={opt}>
                    {opt}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : inputType === 'textarea' ? (
            <Textarea
              ref={inputRef as React.RefObject<HTMLTextAreaElement>}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setAiSuggested(false);
              }}
              className="bg-white/5 border-white/20 text-sm min-h-[80px] resize-none"
              data-testid={`input-field-${fieldKey}-${question.id}`}
            />
          ) : (
            <Input
              ref={inputRef as React.RefObject<HTMLInputElement>}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setAiSuggested(false);
              }}
              className="bg-white/5 border-white/20 text-sm"
              data-testid={`input-field-${fieldKey}-${question.id}`}
            />
          )}
          {aiSuggested && (
            <p className="text-xs text-orange-300 flex items-center gap-1">
              <Bot className="w-3 h-3" /> AI suggestion — review before saving
            </p>
          )}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={save}
              disabled={saving}
              className="h-7 text-xs"
              data-testid={`btn-save-${fieldKey}-${question.id}`}
            >
              {saving ? (
                <RefreshCw className="w-3 h-3 animate-spin mr-1" />
              ) : (
                <Check className="w-3 h-3 mr-1" />
              )}
              Save
            </Button>
            {canAiFix && (
              <Button
                size="sm"
                variant="outline"
                onClick={fixWithAi}
                disabled={aiLoading || saving}
                className="h-7 text-xs border-orange-500/30 text-orange-400 hover:bg-orange-500/10"
                data-testid={`btn-ai-fix-${fieldKey}-${question.id}`}
              >
                {aiLoading ? (
                  <RefreshCw className="w-3 h-3 animate-spin mr-1" />
                ) : (
                  <Sparkles className="w-3 h-3 mr-1" />
                )}
                Fix with AI
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={cancel}
              disabled={saving}
              className="h-7 text-xs"
            >
              <X className="w-3 h-3 mr-1" /> Cancel
            </Button>
          </div>
        </div>
      ) : /* Display value */
      fieldKey === 'tags' ? (
        <div className="flex flex-wrap gap-1 min-h-[1.5rem]">
          {(question.tags ?? []).length > 0 ? (
            (question.tags ?? []).map((t) => (
              <Badge key={t} variant="outline" className="text-xs">
                {t}
              </Badge>
            ))
          ) : (
            <span className="text-red-400 italic text-xs">Missing — hover to fix</span>
          )}
        </div>
      ) : fieldKey === 'acceptableAnswers' ? (
        (question.acceptableAnswers ?? []).length > 0 ? (
          <HiddenAnswer
            answer={(question.acceptableAnswers ?? []).join(', ')}
            label={null}
            testId={`acceptable-${question.id}`}
          />
        ) : (
          <p className="text-xs text-muted-foreground italic">None</p>
        )
      ) : fieldKey === 'answer' ? (
        isEmpty ? (
          <p className="text-sm text-red-400 italic">Missing — hover to fix</p>
        ) : (
          <HiddenAnswer
            answer={rawDisplay}
            label={null}
            valueClassName="text-sm text-primary font-medium"
            testId={`answer-${question.id}`}
          />
        )
      ) : fieldKey === 'sourceUrl' ? (
        rawDisplay ? (
          <a
            href={rawDisplay}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300 underline flex items-center gap-1 text-sm"
            data-testid={`link-source-${question.id}`}
          >
            {question.sourceName || rawDisplay} <ExternalLink className="w-3 h-3" />
          </a>
        ) : (
          <span className="text-red-400 italic text-xs">Missing — hover to fix</span>
        )
      ) : (
        <p className={`text-sm ${isEmpty ? 'text-red-400 italic' : 'text-muted-foreground'}`}>
          {rawDisplay || 'Missing — hover to fix'}
        </p>
      )}
    </div>
  );
}

// ─── ChangeLog ────────────────────────────────────────────────────────────────

function ChangeLog({ questionId }: { questionId: string }) {
  const [edits, setEdits] = useState<EditRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/questions/${questionId}/edits`);
      if (res.ok) setEdits(await res.json());
    } finally {
      setLoading(false);
    }
  }

  function toggle() {
    if (!open) load();
    setOpen((v) => !v);
  }

  function formatValue(val: string | null): string {
    if (val == null) return '(empty)';
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed.join(', ');
      if (typeof parsed === 'string') return parsed;
    } catch {}
    return val;
  }

  return (
    <div className="border-t border-white/10 mt-3 pt-3">
      <button
        onClick={toggle}
        className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
        data-testid={`btn-changelog-${questionId}`}
      >
        <History className="w-3.5 h-3.5" />
        {open ? 'Hide change history' : 'Show change history'}
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>
      {open && (
        <div className="mt-2 space-y-1.5">
          {loading && (
            <p className="text-xs text-muted-foreground">
              <RefreshCw className="inline w-3 h-3 animate-spin mr-1" />
              Loading…
            </p>
          )}
          {!loading && edits.length === 0 && (
            <p className="text-xs text-muted-foreground italic">No edits recorded yet.</p>
          )}
          {edits.map((e) => (
            <div key={e.id} className="text-xs rounded bg-white/5 px-3 py-1.5 space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="font-medium text-foreground">{e.field}</span>
                {e.aiSuggested && (
                  <Badge className="bg-orange-500/15 text-orange-400 border-orange-500/30 text-xs gap-1 h-4">
                    <Bot className="w-2.5 h-2.5" /> AI
                  </Badge>
                )}
                <span className="text-muted-foreground ml-auto">
                  {new Date(e.changedAt).toLocaleString()}
                </span>
              </div>
              <div className="flex items-start gap-1.5 text-muted-foreground">
                {isAnswerField(e.field) ? (
                  <>
                    <HiddenAnswer
                      answer={formatValue(e.oldValue)}
                      label={null}
                      className="line-through opacity-60"
                      testId={`changelog-old-${e.id}`}
                    />
                    <span className="text-white/30">→</span>
                    <HiddenAnswer
                      answer={formatValue(e.newValue)}
                      label={null}
                      valueClassName="text-foreground"
                      testId={`changelog-new-${e.id}`}
                    />
                  </>
                ) : (
                  <>
                    <span className="line-through opacity-60 max-w-[40%] truncate">
                      {formatValue(e.oldValue)}
                    </span>
                    <span className="text-white/30">→</span>
                    <span className="text-foreground max-w-[50%] truncate">
                      {formatValue(e.newValue)}
                    </span>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── ExpandedRow ──────────────────────────────────────────────────────────────

function ExpandedRow({ q, onUpdated }: { q: Question; onUpdated: (updated: Question) => void }) {
  return (
    <div className="px-4 pb-4 space-y-4 text-sm">
      <div className="grid grid-cols-2 gap-6">
        {/* Left column */}
        <div className="space-y-4">
          <EditableField
            label="Question"
            fieldKey="question"
            question={q}
            inputType="textarea"
            onSaved={onUpdated}
          />
          <EditableField label="Answer" fieldKey="answer" question={q} onSaved={onUpdated} />
          <EditableField
            label="Acceptable Answers (comma-separated)"
            fieldKey="acceptableAnswers"
            question={q}
            onSaved={onUpdated}
          />
          <EditableField
            label="Explanation"
            fieldKey="explanation"
            question={q}
            inputType="textarea"
            onSaved={onUpdated}
          />
          <EditableField
            label="Tags (comma-separated)"
            fieldKey="tags"
            question={q}
            onSaved={onUpdated}
          />
        </div>

        {/* Right column */}
        <div className="space-y-4">
          <EditableField
            label="Source URL"
            fieldKey="sourceUrl"
            question={q}
            inputType="url"
            onSaved={onUpdated}
          />
          <EditableField
            label="Source Name"
            fieldKey="sourceName"
            question={q}
            onSaved={onUpdated}
          />
          <EditableField
            label="Category"
            fieldKey="category"
            question={q}
            selectOptions={VALID_CATEGORIES}
            onSaved={onUpdated}
          />

          {/* Read-only fields */}
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Difficulty</p>
            <p className="text-sm">{q.difficulty}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Pillar</p>
            <p className="text-sm">{q.pillar}</p>
          </div>

          {/* AI Analysis */}
          {q.aiAnalysis && (
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                AI Analysis
                {q.aiAnalysis.repaired && (
                  <span className="ml-2 text-blue-400 normal-case">
                    <Wrench className="inline w-3 h-3 mr-0.5" />
                    auto-repaired
                  </span>
                )}
              </p>
              <p className="text-xs mb-1">
                Fact-check:{' '}
                <span
                  className={
                    q.aiAnalysis.factCheck.verdict === 'pass'
                      ? 'text-green-400'
                      : q.aiAnalysis.factCheck.verdict === 'fail'
                        ? 'text-red-400'
                        : 'text-yellow-400'
                  }
                >
                  {q.aiAnalysis.factCheck.verdict}
                </span>{' '}
                <span className="text-muted-foreground">
                  ({q.aiAnalysis.factCheck.confidence}%) — {q.aiAnalysis.factCheck.reason}
                </span>
              </p>
              {q.aiAnalysis.qaFindings.length > 0 ? (
                <div className="space-y-1">
                  {q.aiAnalysis.qaFindings.map((f, i) => (
                    <p key={i} className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <SeverityDot severity={f.severity} /> {f.message}
                    </p>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-green-400">No QA findings</p>
              )}
            </div>
          )}

          {/* Metadata */}
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Metadata</p>
            <p className="text-xs text-muted-foreground">ID: {q.id}</p>
            <p className="text-xs text-muted-foreground">
              Added: {new Date(q.createdAt).toLocaleString()}
            </p>
            <p className="text-xs text-muted-foreground">
              Updated: {new Date(q.updatedAt).toLocaleString()}
            </p>
          </div>
        </div>
      </div>

      {/* Change log */}
      <ChangeLog questionId={q.id} />
    </div>
  );
}

// ─── QuestionRow ──────────────────────────────────────────────────────────────

function QuestionRow({
  q: initialQ,
  onUpdated,
}: {
  q: Question;
  onUpdated: (updated: Question) => void;
}) {
  const [q, setQ] = useState(initialQ);
  const [expanded, setExpanded] = useState(false);
  const missing = getMissingFields(q);
  const hasHighQA =
    q.aiAnalysis?.qaFindings.some((f) => f.severity === 'high') ||
    q.aiAnalysis?.factCheck.verdict === 'fail';
  const hasMediumQA = q.aiAnalysis?.qaFindings.some((f) => f.severity === 'medium');

  function handleUpdated(updated: Question) {
    setQ(updated);
    onUpdated(updated);
  }

  // Sync if parent updates (e.g., full refresh)
  useEffect(() => {
    setQ(initialQ);
  }, [initialQ]);

  return (
    <div
      className={`border rounded-lg overflow-hidden transition-colors ${
        getMissingFields(q).length > 0 || hasHighQA
          ? 'border-red-500/30 bg-red-500/5'
          : hasMediumQA
            ? 'border-yellow-500/20 bg-yellow-500/5'
            : 'border-white/10'
      }`}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-white/5 transition-colors"
        data-testid={`row-question-${q.id}`}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <StatusBadge status={q.status} />
            <Badge variant="outline" className="text-xs">
              {q.pillar}
            </Badge>
            <Badge variant="outline" className="text-xs">
              {q.category}
            </Badge>
            <Badge variant="outline" className="text-xs">
              {q.difficulty}
            </Badge>
            {q.aiAnalysis?.repaired && (
              <Badge className="bg-blue-500/15 text-blue-400 border-blue-500/30 text-xs gap-1">
                <Wrench className="w-3 h-3" /> repaired
              </Badge>
            )}
            {missing.length > 0 && (
              <Badge className="bg-red-500/15 text-red-400 border-red-500/30 text-xs gap-1">
                <AlertCircle className="w-3 h-3" /> {missing.length} missing field
                {missing.length > 1 ? 's' : ''}
              </Badge>
            )}
            {hasHighQA && (
              <Badge className="bg-red-500/15 text-red-400 border-red-500/30 text-xs gap-1">
                <AlertTriangle className="w-3 h-3" /> QA fail
              </Badge>
            )}
          </div>
          <p className="text-sm text-foreground truncate">{q.question}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {new Date(q.createdAt).toLocaleDateString()}
            {q.sourceUrl ? (
              <span className="text-green-400 ml-2">✓ source</span>
            ) : (
              <span className="text-red-400 ml-2">✗ no source</span>
            )}
          </p>
        </div>
        <div className="shrink-0 text-muted-foreground mt-0.5">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-white/10">
          <ExpandedRow q={q} onUpdated={handleUpdated} />
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminQuestions() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { isAdmin, isLoading: adminLoading } = useAdmin();

  const [questions, setQuestions] = useState<Question[]>([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState<string[]>([]);
  const [pillars, setPillars] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [pillarFilter, setPillarFilter] = useState('all');
  const [offset, setOffset] = useState(0);
  const limit = 50;

  const fetchQuestions = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      if (search) params.set('search', search);
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (categoryFilter !== 'all') params.set('category', categoryFilter);
      if (pillarFilter !== 'all') params.set('pillar', pillarFilter);
      const res = await fetch(`/api/admin/questions?${params}`);
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setQuestions(data.questions ?? []);
      setTotal(data.total ?? 0);
      setCategories(data.categories ?? []);
      setPillars(data.pillars ?? []);
    } catch {
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, categoryFilter, pillarFilter, offset]);

  useEffect(() => {
    if (isAuthenticated && isAdmin) fetchQuestions();
  }, [isAuthenticated, isAdmin, fetchQuestions]);
  useEffect(() => {
    setOffset(0);
  }, [search, statusFilter, categoryFilter, pillarFilter]);

  function handleQuestionUpdated(updated: Question) {
    setQuestions((prev) => prev.map((q) => (q.id === updated.id ? updated : q)));
  }

  if (authLoading || adminLoading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center h-64 text-muted-foreground">Loading…</div>
      </AdminLayout>
    );
  }
  if (!isAuthenticated || !isAdmin) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center h-64 text-muted-foreground">
          Admin access required.
        </div>
      </AdminLayout>
    );
  }

  const missingCount = questions.filter((q) => getMissingFields(q).length > 0).length;
  const qaIssueCount = questions.filter(
    (q) =>
      q.aiAnalysis?.qaFindings.some((f) => f.severity === 'high') ||
      q.aiAnalysis?.factCheck.verdict === 'fail'
  ).length;

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Question Browser</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Review and edit all questions. Hover any field to edit it — fields with errors show a{' '}
            <Sparkles className="inline w-3 h-3 text-orange-400" /> icon you can click to fix with
            AI.
          </p>
        </div>

        {/* Summary strip */}
        <div className="flex gap-4 flex-wrap text-sm">
          <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-2">
            <span className="text-muted-foreground">Showing </span>
            <span className="font-semibold">{questions.length}</span>
            <span className="text-muted-foreground"> of </span>
            <span className="font-semibold">{total}</span>
          </div>
          {missingCount > 0 && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-red-400">
              <AlertCircle className="inline w-3.5 h-3.5 mr-1" />
              <span className="font-semibold">{missingCount}</span> with missing fields
            </div>
          )}
          {qaIssueCount > 0 && (
            <div className="rounded-lg border border-orange-500/30 bg-orange-500/10 px-4 py-2 text-orange-400">
              <AlertTriangle className="inline w-3.5 h-3.5 mr-1" />
              <span className="font-semibold">{qaIssueCount}</span> with QA failures
            </div>
          )}
        </div>

        {/* Filter bar */}
        <div className="flex gap-3 flex-wrap items-end">
          <div className="flex-1 min-w-48 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search question, answer, category…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-white/5 border-white/10"
              data-testid="input-search-questions"
            />
          </div>
          <div className="w-36">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger
                className="bg-white/5 border-white/10"
                data-testid="select-status-filter"
              >
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="w-44">
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger
                className="bg-white/5 border-white/10"
                data-testid="select-category-filter"
              >
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-44">
            <Select value={pillarFilter} onValueChange={setPillarFilter}>
              <SelectTrigger
                className="bg-white/5 border-white/10"
                data-testid="select-pillar-filter"
              >
                <SelectValue placeholder="Pillar" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All pillars</SelectItem>
                {pillars.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={fetchQuestions}
            disabled={loading}
            data-testid="button-refresh-questions"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        {/* Question list */}
        {loading ? (
          <div className="flex items-center justify-center h-48 text-muted-foreground">
            <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Loading questions…
          </div>
        ) : questions.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-muted-foreground border border-dashed border-white/10 rounded-lg">
            No questions match your filters.
          </div>
        ) : (
          <div className="space-y-2" data-testid="list-questions">
            {questions.map((q) => (
              <QuestionRow key={q.id} q={q} onUpdated={handleQuestionUpdated} />
            ))}
          </div>
        )}

        {/* Pagination */}
        {total > limit && (
          <div className="flex items-center justify-between pt-2">
            <Button
              variant="outline"
              size="sm"
              disabled={offset === 0 || loading}
              onClick={() => setOffset((o) => Math.max(0, o - limit))}
              data-testid="button-prev-page"
            >
              Previous
            </Button>
            <span className="text-xs text-muted-foreground">
              {offset + 1}–{Math.min(offset + limit, total)} of {total}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={offset + limit >= total || loading}
              onClick={() => setOffset((o) => o + limit)}
              data-testid="button-next-page"
            >
              Next
            </Button>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
