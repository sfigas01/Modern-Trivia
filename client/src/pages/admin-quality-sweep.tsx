import { useState } from 'react';
import { useLocation } from 'wouter';
import { ScanSearch, Play, LogIn, Shield } from 'lucide-react';
import { AdminLayout } from '@/components/admin-layout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { useAuth } from '@/hooks/use-auth';
import { useAdmin } from '@/hooks/use-admin';
import type {
  QualitySweepReport,
  QuestionQualityFinding,
  DuplicateMatch,
  FactCheckVerdict,
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

// --- Report section components ---

function SummarySection({ report }: { report: QualitySweepReport }) {
  return (
    <Card className="bg-white/5 border-white/10">
      <CardHeader>
        <CardTitle className="text-lg">Summary</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Questions scanned</p>
            <p className="text-2xl font-bold">{report.totalQuestions}</p>
          </div>
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">High findings</p>
            <p className="text-2xl font-bold text-red-400">
              {report.audit.findingsBySeverity.high}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Medium findings</p>
            <p className="text-2xl font-bold text-yellow-400">
              {report.audit.findingsBySeverity.medium}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Duplicates</p>
            <p className="text-2xl font-bold">
              {report.duplicates ? report.duplicates.duplicatesFound.length : '—'}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function RecommendationsSection({ recommendations }: { recommendations: string[] }) {
  return (
    <Card className="bg-white/5 border-white/10">
      <CardHeader>
        <CardTitle className="text-lg">Recommendations</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="list-disc list-inside space-y-1 text-sm">
          {recommendations.map((rec, i) => (
            <li key={i}>{rec}</li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function DuplicatesSection({ duplicates }: { duplicates: DuplicateMatch[] }) {
  if (duplicates.length === 0) {
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
          Duplicates ({duplicates.length} pair{duplicates.length !== 1 ? 's' : ''})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Question A</TableHead>
              <TableHead>Question B</TableHead>
              <TableHead>AI Reasoning</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {duplicates.map((match, i) => (
              <TableRow key={i}>
                <TableCell>
                  <MatchTypeBadge type={match.matchType} />
                </TableCell>
                <TableCell className="font-mono text-sm">
                  {match.similarityScore.toFixed(2)}
                </TableCell>
                <TableCell className="max-w-[200px]">
                  <p className="text-xs text-muted-foreground mb-1">{match.questionIdA}</p>
                  <p className="text-sm">{truncate(match.questionTextA)}</p>
                </TableCell>
                <TableCell className="max-w-[200px]">
                  <p className="text-xs text-muted-foreground mb-1">{match.questionIdB}</p>
                  <p className="text-sm">{truncate(match.questionTextB)}</p>
                </TableCell>
                <TableCell className="max-w-[200px] text-sm">
                  {match.aiReasoning ? truncate(match.aiReasoning) : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function AuditFindingsSection({ findings }: { findings: QuestionQualityFinding[] }) {
  const grouped = {
    high: findings.filter((f) => f.severity === 'high'),
    medium: findings.filter((f) => f.severity === 'medium'),
    low: findings.filter((f) => f.severity === 'low'),
  };

  if (findings.length === 0) {
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
        <CardTitle className="text-lg">Static Audit Findings ({findings.length})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {(['high', 'medium', 'low'] as const).map((severity) => {
          const group = grouped[severity];
          if (group.length === 0) return null;
          return (
            <div key={severity}>
              <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <SeverityBadge severity={severity} />
                {group.length} finding{group.length !== 1 ? 's' : ''}
              </h4>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Question ID</TableHead>
                    <TableHead>Rule</TableHead>
                    <TableHead>Message</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.map((finding, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-xs">{finding.questionId}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{finding.rule}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">{finding.message}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function FactCheckSection({ results }: { results: FactCheckVerdict[] }) {
  const actionable = results
    .filter((r) => r.verdict === 'fail' || r.verdict === 'flag')
    .sort((a, b) => (a.verdict === 'fail' ? -1 : 1) - (b.verdict === 'fail' ? -1 : 1));

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
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Question ID</TableHead>
              <TableHead>Verdict</TableHead>
              <TableHead>Confidence</TableHead>
              <TableHead>Reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {actionable.map((result, i) => (
              <TableRow key={i}>
                <TableCell className="font-mono text-xs">{result.questionId}</TableCell>
                <TableCell>
                  <VerdictBadge verdict={result.verdict} />
                </TableCell>
                <TableCell className="font-mono text-sm">{result.confidence}%</TableCell>
                <TableCell className="text-sm max-w-[400px]">{result.reason}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// --- Main page component ---

export default function AdminQualitySweep() {
  const [_, setLocation] = useLocation();
  const { toast } = useToast();
  const { user, isLoading: authLoading, isAuthenticated } = useAuth();
  const { isAdmin, isLoading: adminLoading } = useAdmin();

  const [skipFactCheck, setSkipFactCheck] = useState(false);
  const [skipDuplicates, setSkipDuplicates] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [report, setReport] = useState<QualitySweepReport | null>(null);

  const handleRunSweep = async () => {
    setIsRunning(true);
    setReport(null);
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

  // Auth guards — same pattern as admin-settings.tsx
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
            <RecommendationsSection recommendations={report.recommendations} />

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
