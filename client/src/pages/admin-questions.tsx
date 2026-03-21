import { useState, useEffect, useCallback } from 'react';
import { AdminLayout } from '@/components/admin-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/hooks/use-auth';
import { useAdmin } from '@/hooks/use-admin';
import { useLocation } from 'wouter';
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
} from 'lucide-react';

type QAFinding = {
  rule: string;
  message: string;
  severity: 'high' | 'medium' | 'low';
};

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

type MissingField = { field: string; label: string };

function getMissingFields(q: Question): MissingField[] {
  const missing: MissingField[] = [];
  if (!q.sourceUrl) missing.push({ field: 'sourceUrl', label: 'Source URL' });
  if (!q.sourceName) missing.push({ field: 'sourceName', label: 'Source Name' });
  if (!q.explanation) missing.push({ field: 'explanation', label: 'Explanation' });
  if (!q.tags || q.tags.length === 0) missing.push({ field: 'tags', label: 'Tags' });
  return missing;
}

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
  const colors = { high: 'bg-red-400', medium: 'bg-yellow-400', low: 'bg-blue-400' };
  return <span className={`inline-block w-2 h-2 rounded-full ${colors[severity]}`} />;
}

function ExpandedRow({ q }: { q: Question }) {
  const missing = getMissingFields(q);

  return (
    <div className="px-4 pb-4 space-y-4 text-sm">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-3">
          <div>
            <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wide">Question</p>
            <p className="text-foreground">{q.question}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wide">Answer</p>
            <p className="font-medium text-primary">{q.answer}</p>
            {q.acceptableAnswers && q.acceptableAnswers.length > 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                Also: {q.acceptableAnswers.join(', ')}
              </p>
            )}
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wide">
              Explanation
            </p>
            {q.explanation ? (
              <p className="text-muted-foreground">{q.explanation}</p>
            ) : (
              <p className="text-red-400 italic">Missing</p>
            )}
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wide">Tags</p>
            {q.tags && q.tags.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {q.tags.map((t) => (
                  <Badge key={t} variant="outline" className="text-xs">
                    {t}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-red-400 italic">Missing</p>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wide">Source</p>
            {q.sourceUrl ? (
              <a
                href={q.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300 underline flex items-center gap-1"
                data-testid={`link-source-${q.id}`}
              >
                {q.sourceName || q.sourceUrl}
                <ExternalLink className="w-3 h-3" />
              </a>
            ) : (
              <p className="text-red-400 italic">Missing source URL</p>
            )}
            {!q.sourceName && q.sourceUrl && (
              <p className="text-red-400 italic text-xs mt-1">Missing source name</p>
            )}
          </div>

          <div>
            <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wide">
              Field Completeness
            </p>
            {missing.length === 0 ? (
              <p className="text-green-400 flex items-center gap-1">
                <CheckCircle className="w-3 h-3" /> All fields present
              </p>
            ) : (
              <div className="space-y-1">
                {missing.map((m) => (
                  <p key={m.field} className="text-red-400 flex items-center gap-1 text-xs">
                    <AlertCircle className="w-3 h-3" /> {m.label} missing
                  </p>
                ))}
              </div>
            )}
          </div>

          {q.aiAnalysis && (
            <div>
              <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wide">
                AI Analysis
                {q.aiAnalysis.repaired && (
                  <span className="ml-2 text-blue-400 normal-case">
                    <Wrench className="inline w-3 h-3 mr-0.5" />
                    auto-repaired
                  </span>
                )}
              </p>
              <div className="space-y-1">
                <p className="text-xs">
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
                  <div className="space-y-1 mt-1">
                    {q.aiAnalysis.qaFindings.map((f, i) => (
                      <p key={i} className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <SeverityDot severity={f.severity} />
                        {f.message}
                      </p>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-green-400">No QA findings</p>
                )}
              </div>
            </div>
          )}

          <div>
            <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wide">Metadata</p>
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
    </div>
  );
}

function QuestionRow({ q }: { q: Question }) {
  const [expanded, setExpanded] = useState(false);
  const missing = getMissingFields(q);
  const hasHighQA =
    q.aiAnalysis?.qaFindings.some((f) => f.severity === 'high') ||
    q.aiAnalysis?.factCheck.verdict === 'fail';
  const hasMediumQA = q.aiAnalysis?.qaFindings.some((f) => f.severity === 'medium');

  return (
    <div
      className={`border rounded-lg overflow-hidden transition-colors ${
        missing.length > 0 || hasHighQA
          ? 'border-red-500/30 bg-red-500/5'
          : hasMediumQA
            ? 'border-yellow-500/20 bg-yellow-500/5'
            : 'border-white/10 bg-white/2'
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
                <AlertCircle className="w-3 h-3" />
                {missing.length} missing field{missing.length > 1 ? 's' : ''}
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
            Answer: <span className="text-primary">{q.answer}</span>
            {' · '}
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
          <ExpandedRow q={q} />
        </div>
      )}
    </div>
  );
}

export default function AdminQuestions() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { isAdmin, isLoading: adminLoading } = useAdmin();
  const [, setLocation] = useLocation();

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
      // silently retry on next action
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

  if (authLoading || adminLoading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center h-64 text-muted-foreground">
          Loading…
        </div>
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
      q.aiAnalysis?.factCheck.verdict === 'fail',
  ).length;

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Question Browser</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Review all questions across every status — spot missing fields, QA flags, and source
            issues at a glance.
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
              <SelectTrigger className="bg-white/5 border-white/10" data-testid="select-status-filter">
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
              <SelectTrigger className="bg-white/5 border-white/10" data-testid="select-category-filter">
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
              <SelectTrigger className="bg-white/5 border-white/10" data-testid="select-pillar-filter">
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
            <RefreshCw className="w-4 h-4 animate-spin mr-2" />
            Loading questions…
          </div>
        ) : questions.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-muted-foreground border border-dashed border-white/10 rounded-lg">
            No questions match your filters.
          </div>
        ) : (
          <div className="space-y-2" data-testid="list-questions">
            {questions.map((q) => (
              <QuestionRow key={q.id} q={q} />
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
