import { useState } from 'react';
import { AdminLayout } from '@/components/admin-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  Sparkles,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  ThumbsUp,
  ThumbsDown,
  Eye,
  EyeOff,
  Zap,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { motion, AnimatePresence } from 'framer-motion';

const SINGLE_PILLARS = ['GlobalEh', 'FreshPrints', 'TimeCapsule', 'GreatOutdoors'] as const;
type SinglePillar = (typeof SINGLE_PILLARS)[number];
type Pillar = SinglePillar | 'Mixed';

const PILLAR_MIX: { pillar: SinglePillar; pct: number; label: string }[] = [
  { pillar: 'TimeCapsule', pct: 0.30, label: 'TimeCapsule' },
  { pillar: 'GlobalEh', pct: 0.30, label: 'GlobalEh' },
  { pillar: 'FreshPrints', pct: 0.25, label: 'FreshPrints' },
  { pillar: 'GreatOutdoors', pct: 0.15, label: 'GreatOutdoors' },
];

function allocateMixed(count: number): { pillar: SinglePillar; count: number }[] {
  const items = PILLAR_MIX.map((t) => ({
    pillar: t.pillar,
    floored: Math.floor(t.pct * count),
    remainder: (t.pct * count) % 1,
    pct: t.pct,
  }));
  let remaining = count - items.reduce((s, t) => s + t.floored, 0);
  items.sort((a, b) => b.remainder - a.remainder || b.pct - a.pct);
  for (let i = 0; i < remaining; i++) items[i].floored++;
  return items.filter((t) => t.floored > 0).map((t) => ({ pillar: t.pillar, count: t.floored }));
}

type FactCheckVerdict = 'pass' | 'flag' | 'fail';
type QASeverity = 'high' | 'medium' | 'low';

interface QAFinding {
  questionId: string;
  questionIndex: number;
  severity: QASeverity;
  rule: string;
  message: string;
}

interface FactCheck {
  verdict: FactCheckVerdict;
  confidence: number;
  reason: string;
}

interface AIAnalysis {
  qaFindings: QAFinding[];
  factCheck: FactCheck;
}

interface StagingQuestion {
  id: string;
  category: string;
  difficulty: string;
  question: string;
  answer: string;
  explanation: string;
  pillar: string;
  tags: string[];
  sourceUrl?: string;
  sourceName?: string;
  status: string;
  aiAnalysis?: AIAnalysis;
  createdAt: string;
}

function verdictIcon(verdict: FactCheckVerdict) {
  if (verdict === 'pass') return <CheckCircle className="w-4 h-4 text-green-400" />;
  if (verdict === 'fail') return <XCircle className="w-4 h-4 text-red-400" />;
  return <AlertTriangle className="w-4 h-4 text-yellow-400" />;
}

function verdictBadgeClass(verdict: FactCheckVerdict) {
  if (verdict === 'pass') return 'bg-green-500/15 text-green-300 border-green-500/30';
  if (verdict === 'fail') return 'bg-red-500/15 text-red-300 border-red-500/30';
  return 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30';
}

function severityBadgeClass(severity: QASeverity) {
  if (severity === 'high') return 'bg-red-500/15 text-red-300 border-red-500/30';
  if (severity === 'medium') return 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30';
  return 'bg-blue-500/15 text-blue-300 border-blue-500/30';
}

function overallHealth(q: StagingQuestion): 'clean' | 'warn' | 'fail' {
  if (!q.aiAnalysis) return 'warn';
  const { qaFindings, factCheck } = q.aiAnalysis;
  if (factCheck.verdict === 'fail' || qaFindings.some((f) => f.severity === 'high')) return 'fail';
  if (factCheck.verdict === 'flag' || qaFindings.some((f) => f.severity === 'medium')) return 'warn';
  return 'clean';
}

function QuestionCard({
  question,
  onPromote,
  onReject,
}: {
  question: StagingQuestion;
  onPromote: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [answerVisible, setAnswerVisible] = useState(false);
  const [acting, setActing] = useState(false);
  const analysis = question.aiAnalysis;
  const health = overallHealth(question);

  const handlePromote = async () => {
    setActing(true);
    onPromote(question.id);
  };
  const handleReject = async () => {
    setActing(true);
    onReject(question.id);
  };

  return (
    <Card
      className={`border bg-white/5 ${
        health === 'fail'
          ? 'border-red-500/40'
          : health === 'warn'
            ? 'border-yellow-500/30'
            : 'border-green-500/30'
      }`}
      data-testid={`card-staging-${question.id}`}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap gap-2 mb-2">
              <Badge variant="outline" className="text-xs border-white/20">
                {question.category}
              </Badge>
              <Badge variant="outline" className="text-xs border-white/20">
                {question.difficulty}
              </Badge>
              <Badge variant="outline" className="text-xs border-white/20">
                {question.pillar}
              </Badge>
              {analysis && (
                <span
                  className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${verdictBadgeClass(analysis.factCheck.verdict)}`}
                  data-testid={`fact-check-verdict-${question.id}`}
                >
                  {verdictIcon(analysis.factCheck.verdict)}
                  AI: {analysis.factCheck.verdict}
                  {' '}({analysis.factCheck.confidence}%)
                </span>
              )}
              {analysis && analysis.qaFindings.length > 0 && (
                <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border bg-white/5 border-white/20 text-muted-foreground">
                  <AlertTriangle className="w-3 h-3" />
                  {analysis.qaFindings.length} QA issue{analysis.qaFindings.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            <p className="font-medium text-sm leading-snug" data-testid={`text-question-${question.id}`}>
              {question.question}
            </p>
            {/* Answer — hidden by default, reveal on demand */}
            <div className="mt-1.5 flex items-center gap-2">
              {answerVisible ? (
                <>
                  <p className="text-sm text-primary font-semibold" data-testid={`text-answer-${question.id}`}>
                    {question.answer}
                  </p>
                  <button
                    onClick={() => setAnswerVisible(false)}
                    className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5 transition-colors"
                    data-testid={`button-hide-answer-${question.id}`}
                  >
                    <EyeOff className="w-3 h-3" /> Hide
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setAnswerVisible(true)}
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors border border-white/10 rounded px-2 py-0.5"
                  data-testid={`button-reveal-answer-${question.id}`}
                >
                  <Eye className="w-3 h-3" /> Reveal answer
                </button>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 text-muted-foreground hover:text-foreground"
            onClick={() => setExpanded((v) => !v)}
            title="Show QA details"
            data-testid={`button-expand-${question.id}`}
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </Button>
        </div>
      </CardHeader>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <CardContent className="pt-0 space-y-4 border-t border-white/10">
              <div className="pt-4">
                <p className="text-xs text-muted-foreground mb-1">Explanation</p>
                <p className="text-sm">{question.explanation}</p>
              </div>

              {analysis && (
                <>
                  <div className="p-3 rounded-lg bg-white/5 border border-white/10">
                    <p className="text-xs font-semibold text-muted-foreground mb-1 flex items-center gap-1">
                      {verdictIcon(analysis.factCheck.verdict)}
                      AI Fact-Check ({analysis.factCheck.confidence}% confidence)
                    </p>
                    <p className="text-sm">{analysis.factCheck.reason}</p>
                  </div>

                  {analysis.qaFindings.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground">QA Findings</p>
                      {analysis.qaFindings.map((finding, i) => (
                        <div
                          key={i}
                          className={`flex items-start gap-2 text-xs p-2 rounded-md border ${severityBadgeClass(finding.severity)}`}
                          data-testid={`qa-finding-${question.id}-${i}`}
                        >
                          <span className="font-semibold uppercase shrink-0">{finding.severity}</span>
                          <span>{finding.message}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {!analysis && (
                <div className="text-xs text-muted-foreground italic">
                  No QA analysis available for this question.
                </div>
              )}
            </CardContent>
          </motion.div>
        )}
      </AnimatePresence>

      <CardContent className={`pt-0 ${expanded ? '' : 'pt-0'}`}>
        <div className="flex gap-2 justify-end pt-2">
          <Button
            variant="outline"
            size="sm"
            className="border-red-500/40 text-red-300 hover:bg-red-500/10"
            onClick={handleReject}
            disabled={acting}
            data-testid={`button-reject-${question.id}`}
          >
            <ThumbsDown className="w-3 h-3 mr-1" />
            Reject
          </Button>
          <Button
            size="sm"
            className="bg-green-600/80 hover:bg-green-600 text-white"
            onClick={handlePromote}
            disabled={acting}
            data-testid={`button-promote-${question.id}`}
          >
            <ThumbsUp className="w-3 h-3 mr-1" />
            Promote
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminStaging() {
  const { toast } = useToast();

  const [stagingQuestions, setStagingQuestions] = useState<StagingQuestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const [genForm, setGenForm] = useState({
    topic: '',
    count: 10,
    pillar: 'Mixed' as Pillar,
    autoAccept: false,
  });

  const mixedBreakdown = genForm.pillar === 'Mixed' ? allocateMixed(genForm.count) : null;

  const fetchStaging = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/staging', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch staging queue');
      const data = (await res.json()) as StagingQuestion[];
      setStagingQuestions(data.filter((q) => q.status === 'pending'));
      setLoaded(true);
    } catch {
      toast({ title: 'Error', description: 'Could not load staging queue.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!genForm.topic.trim()) return;
    setGenerating(true);
    try {
      const res = await fetch('/api/staging/generate', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(genForm),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { message?: string };
        throw new Error(err.message || 'Generation failed');
      }
      const data = await res.json() as { count: number; autoAccepted?: number };
      if (genForm.autoAccept) {
        toast({
          title: 'Questions generated & approved',
          description: `${data.count} question${data.count !== 1 ? 's' : ''} went live automatically — no spoilers!`,
        });
      } else {
        toast({
          title: 'Questions generated',
          description: `${data.count} question${data.count !== 1 ? 's' : ''} added to staging with QA analysis.`,
        });
      }
      setGenForm((f) => ({ ...f, topic: '' }));
      if (!genForm.autoAccept) await fetchStaging();
    } catch (err) {
      toast({
        title: 'Generation failed',
        description: err instanceof Error ? err.message : 'Something went wrong.',
        variant: 'destructive',
      });
    } finally {
      setGenerating(false);
    }
  };

  const handlePromote = async (id: string) => {
    try {
      const res = await fetch(`/api/staging/${id}/promote`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Promote failed');
      setStagingQuestions((prev) => prev.filter((q) => q.id !== id));
      toast({ title: 'Promoted', description: 'Question is now live for all users.' });
    } catch {
      toast({ title: 'Error', description: 'Failed to promote question.', variant: 'destructive' });
    }
  };

  const handleReject = async (id: string) => {
    try {
      const res = await fetch(`/api/staging/${id}/reject`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Reject failed');
      setStagingQuestions((prev) => prev.filter((q) => q.id !== id));
      toast({ title: 'Rejected', description: 'Question removed from staging.' });
    } catch {
      toast({ title: 'Error', description: 'Failed to reject question.', variant: 'destructive' });
    }
  };

  const healthCounts = {
    clean: stagingQuestions.filter((q) => overallHealth(q) === 'clean').length,
    warn: stagingQuestions.filter((q) => overallHealth(q) === 'warn').length,
    fail: stagingQuestions.filter((q) => overallHealth(q) === 'fail').length,
  };

  return (
    <AdminLayout>
      <div className="space-y-8">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Question Staging</h2>
          <p className="text-muted-foreground">
            Generate AI questions, review QA findings, then promote or reject.
          </p>
        </div>

        {/* Generate Form */}
        <Card className="bg-white/5 border-white/10">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              Generate Questions
            </CardTitle>
            <CardDescription>
              Questions are automatically audited for quality and fact-checked before staging.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleGenerate} className="flex flex-wrap gap-3 items-end">
              <div className="flex-1 min-w-[200px] space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Topic</label>
                <Input
                  placeholder="e.g. Canadian Hockey, Space Exploration..."
                  value={genForm.topic}
                  onChange={(e) => setGenForm((f) => ({ ...f, topic: e.target.value }))}
                  className="bg-white/5 border-white/10"
                  data-testid="input-generate-topic"
                  disabled={generating}
                />
              </div>
              <div className="w-24 space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Count</label>
                <Select
                  value={String(genForm.count)}
                  onValueChange={(v) => setGenForm((f) => ({ ...f, count: Number(v) }))}
                  disabled={generating}
                >
                  <SelectTrigger className="bg-white/5 border-white/10" data-testid="select-generate-count">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[3, 5, 10, 15, 20].map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-48 space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Pillar</label>
                <Select
                  value={genForm.pillar}
                  onValueChange={(v) => setGenForm((f) => ({ ...f, pillar: v as Pillar }))}
                  disabled={generating}
                >
                  <SelectTrigger className="bg-white/5 border-white/10" data-testid="select-generate-pillar">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Mixed">Mixed (30/30/25/15)</SelectItem>
                    <div className="my-1 border-t border-white/10" />
                    {SINGLE_PILLARS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {mixedBreakdown && (
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {mixedBreakdown.map((b) => `${b.count} ${b.pillar}`).join(' · ')}
                  </p>
                )}
              </div>
              {/* Auto Accept toggle */}
              <div className="flex flex-col justify-end pb-0.5 space-y-1 shrink-0">
                <div
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors ${
                    genForm.autoAccept
                      ? 'border-primary/40 bg-primary/10 text-primary'
                      : 'border-white/10 bg-white/5 text-muted-foreground'
                  }`}
                  data-testid="toggle-auto-accept"
                >
                  <Switch
                    id="toggle-auto-accept"
                    checked={genForm.autoAccept}
                    onCheckedChange={(v) => setGenForm((f) => ({ ...f, autoAccept: v }))}
                  />
                  <Label
                    htmlFor="toggle-auto-accept"
                    className="text-xs font-medium whitespace-nowrap flex items-center gap-1 cursor-pointer"
                  >
                    <Zap className="w-3 h-3" />
                    Auto Accept
                  </Label>
                </div>
                {genForm.autoAccept && (
                  <p className="text-xs text-primary/70 max-w-[140px] leading-tight">
                    Goes live instantly — no spoilers
                  </p>
                )}
              </div>

              <Button
                type="submit"
                disabled={generating || !genForm.topic.trim()}
                className="shrink-0 self-start mt-[22px]"
                data-testid="button-generate-questions"
              >
                {generating ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    Generating &amp; analyzing...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 mr-2" />
                    Generate
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Staging Queue */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h3 className="text-xl font-semibold">
                Review Queue
                {loaded && (
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    ({stagingQuestions.length} pending)
                  </span>
                )}
              </h3>
              {loaded && stagingQuestions.length > 0 && (
                <div className="flex gap-2">
                  {healthCounts.clean > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/15 text-green-300 border border-green-500/30">
                      {healthCounts.clean} clean
                    </span>
                  )}
                  {healthCounts.warn > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-500/15 text-yellow-300 border border-yellow-500/30">
                      {healthCounts.warn} flagged
                    </span>
                  )}
                  {healthCounts.fail > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/15 text-red-300 border border-red-500/30">
                      {healthCounts.fail} failed
                    </span>
                  )}
                </div>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchStaging}
              disabled={loading}
              className="border-white/10"
              data-testid="button-refresh-staging"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              {loaded ? 'Refresh' : 'Load Queue'}
            </Button>
          </div>

          {!loaded && (
            <div className="text-center py-16 text-muted-foreground border-2 border-dashed border-white/10 rounded-xl">
              <Sparkles className="w-8 h-8 mx-auto mb-3 opacity-40" />
              <p>Click "Load Queue" to see pending questions, or generate new ones above.</p>
            </div>
          )}

          {loaded && stagingQuestions.length === 0 && (
            <div className="text-center py-16 text-muted-foreground border-2 border-dashed border-white/10 rounded-xl">
              <CheckCircle className="w-8 h-8 mx-auto mb-3 text-green-400 opacity-60" />
              <p>All clear — no questions pending review.</p>
            </div>
          )}

          <AnimatePresence mode="popLayout">
            {stagingQuestions.map((q) => (
              <motion.div
                key={q.id}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
              >
                <QuestionCard question={q} onPromote={handlePromote} onReject={handleReject} />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </AdminLayout>
  );
}
