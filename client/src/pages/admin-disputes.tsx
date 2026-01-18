import { useState } from "react";
import { AdminLayout } from "@/components/admin-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, XCircle, BrainCircuit, ExternalLink } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Dispute } from "@shared/schema";
import { Skeleton } from "@/components/ui/skeleton";

import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface AIAnalysis {
    verdict: "CORRECT" | "INCORRECT" | "AMBIGUOUS";
    confidence: number;
    reasoning: string;
    suggestedFix?: {
        question?: string;
        answer?: string;
        explanation?: string;
    };
    sources: string[];
}

export default function AdminDisputes() {
    const { toast } = useToast();
    const { data: disputes, isLoading } = useQuery<Dispute[]>({
        queryKey: ["/api/disputes"],
    });

    const [analyzingId, setAnalyzingId] = useState<string | null>(null);
    const [resolvingId, setResolvingId] = useState<string | null>(null);

    const handleAnalyze = async (id: string) => {
        setAnalyzingId(id);
        try {
            await apiRequest("POST", `/api/disputes/${id}/analyze`);
            await queryClient.invalidateQueries({ queryKey: ["/api/disputes"] });
            toast({ title: "Analysis Complete", description: "AI has reviewed the dispute." });
        } catch (error) {
            toast({
                title: "Analysis Failed",
                description: "Could not contact AI service.",
                variant: "destructive"
            });
        } finally {
            setAnalyzingId(null);
        }
    };

    const handleResolve = async (id: string, status: "resolved" | "rejected") => {
        setResolvingId(id);
        try {
            await apiRequest("PATCH", `/api/disputes/${id}`, {
                status,
                resolutionNote: status === "resolved" ? "Accepted by admin" : "Rejected by admin"
            });
            await queryClient.invalidateQueries({ queryKey: ["/api/disputes"] });
            toast({
                title: status === "resolved" ? "Dispute Accepted" : "Dispute Rejected",
                description: `The dispute has been marked as ${status}.`
            });
        } catch (error) {
            toast({
                title: "Action Failed",
                description: "Could not update dispute status.",
                variant: "destructive"
            });
        } finally {
            setResolvingId(null);
        }
    };

    const getVerdictColor = (verdict: string) => {
        switch (verdict) {
            case "CORRECT": return "text-green-500";
            case "INCORRECT": return "text-red-500";
            default: return "text-yellow-500";
        }
    };

    return (
        <AdminLayout>
            <div className="space-y-6">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight" data-testid="text-disputes-title">Dispute Resolution</h2>
                    <p className="text-muted-foreground">Review and resolve reported inaccuracies with AI assistance.</p>
                </div>

                <div className="grid gap-4">
                    {isLoading ? (
                        <div className="space-y-4">
                            <Skeleton className="h-32 w-full" />
                            <Skeleton className="h-32 w-full" />
                        </div>
                    ) : disputes?.length === 0 ? (
                        <Card className="bg-muted/5 border-dashed">
                            <CardContent className="flex flex-col items-center justify-center p-12 text-center text-muted-foreground">
                                <CheckCircle className="w-12 h-12 mb-4 opacity-20" />
                                <p>No active disputes. Good job!</p>
                            </CardContent>
                        </Card>
                    ) : (
                        disputes?.map((dispute) => {
                            const analysis = dispute.aiAnalysis as AIAnalysis | null;
                            return (
                                <Card key={dispute.id} className="bg-white/5 border-white/10 overflow-hidden" data-testid={`card-dispute-${dispute.id}`}>
                                    <div className="flex flex-col md:flex-row">
                                        <div className="p-6 flex-1 space-y-4 border-b md:border-b-0 md:border-r border-white/10">
                                            <div className="flex justify-between items-start">
                                                <div className="space-y-1">
                                                    <Badge variant="outline" className={
                                                        dispute.status === 'pending' ? 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20' :
                                                            dispute.status === 'resolved' ? 'bg-green-500/10 text-green-500 border-green-500/20' :
                                                                'bg-red-500/10 text-red-500 border-red-500/20'
                                                    }>
                                                        {dispute.status.toUpperCase()}
                                                    </Badge>
                                                    <p className="text-xs text-muted-foreground">Team: {dispute.teamName}</p>
                                                </div>
                                                <span className="text-xs text-muted-foreground">
                                                    {new Date(dispute.timestamp).toLocaleDateString()}
                                                </span>
                                            </div>

                                            <div className="space-y-3">
                                                <div>
                                                    <span className="text-xs font-medium uppercase text-muted-foreground">Question</span>
                                                    <p className="font-medium">{dispute.questionText}</p>
                                                </div>

                                                <div className="grid grid-cols-2 gap-4">
                                                    <div className="p-3 rounded-md bg-green-500/5 border border-green-500/10">
                                                        <span className="text-xs font-medium uppercase text-green-500/80">Current Answer</span>
                                                        <p className="font-semibold">{dispute.correctAnswer}</p>
                                                    </div>
                                                    <div className="p-3 rounded-md bg-red-500/5 border border-red-500/10">
                                                        <span className="text-xs font-medium uppercase text-red-500/80">User Claim</span>
                                                        <p className="font-semibold">{dispute.submittedAnswer || "(No answer)"}</p>
                                                    </div>
                                                </div>

                                                <div className="text-sm bg-muted/20 p-3 rounded italic text-muted-foreground border-l-2 border-primary/50">
                                                    "{dispute.teamExplanation}"
                                                </div>
                                            </div>
                                        </div>

                                        <div className="p-6 w-full md:w-96 bg-muted/5 space-y-4 flex flex-col">
                                            <div className="flex-1">
                                                <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                                                    <BrainCircuit className="w-4 h-4 text-purple-400" />
                                                    AI Analysis
                                                </h4>
                                                {analysis ? (
                                                    <div className="text-sm space-y-3 p-3 bg-white/5 rounded">
                                                        <div className="flex items-center justify-between">
                                                            <span className={`font-bold ${getVerdictColor(analysis.verdict)}`}>
                                                                {analysis.verdict}
                                                            </span>
                                                            <span className="text-xs text-muted-foreground">
                                                                {analysis.confidence}% confidence
                                                            </span>
                                                        </div>
                                                        <p className="text-muted-foreground text-xs leading-relaxed">
                                                            {analysis.reasoning}
                                                        </p>
                                                        {analysis.suggestedFix && (
                                                            <div className="mt-2 p-2 bg-yellow-500/10 rounded border border-yellow-500/20">
                                                                <p className="text-xs font-medium text-yellow-500 mb-1">Suggested Fix:</p>
                                                                {analysis.suggestedFix.answer && (
                                                                    <p className="text-xs text-muted-foreground">
                                                                        Answer: <strong>{analysis.suggestedFix.answer}</strong>
                                                                    </p>
                                                                )}
                                                            </div>
                                                        )}
                                                        {analysis.sources.length > 0 && (
                                                            <div className="flex flex-wrap gap-1 mt-2">
                                                                {analysis.sources.map((source, i) => (
                                                                    <Badge key={i} variant="outline" className="text-xs">
                                                                        <ExternalLink className="w-3 h-3 mr-1" />
                                                                        {source}
                                                                    </Badge>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <p className="text-xs text-muted-foreground">
                                                        Run analysis to verify facts and get a recommended resolution.
                                                    </p>
                                                )}
                                            </div>

                                            {dispute.status === "pending" && (
                                                <div className="space-y-2 pt-4 border-t border-white/10">
                                                    <Button
                                                        className="w-full bg-purple-600 hover:bg-purple-700"
                                                        onClick={() => handleAnalyze(dispute.id)}
                                                        disabled={analyzingId === dispute.id || resolvingId === dispute.id}
                                                        data-testid={`button-analyze-${dispute.id}`}
                                                    >
                                                        {analyzingId === dispute.id ? "Analyzing..." : "Analyze with AI"}
                                                    </Button>
                                                    <div className="grid grid-cols-2 gap-2">
                                                        <Button
                                                            variant="outline"
                                                            className="border-green-500/20 hover:bg-green-500/10 hover:text-green-500"
                                                            onClick={() => handleResolve(dispute.id, "resolved")}
                                                            disabled={resolvingId === dispute.id}
                                                            data-testid={`button-accept-${dispute.id}`}
                                                        >
                                                            <CheckCircle className="w-4 h-4 mr-2" /> Accept
                                                        </Button>
                                                        <Button
                                                            variant="outline"
                                                            className="border-red-500/20 hover:bg-red-500/10 hover:text-red-500"
                                                            onClick={() => handleResolve(dispute.id, "rejected")}
                                                            disabled={resolvingId === dispute.id}
                                                            data-testid={`button-reject-${dispute.id}`}
                                                        >
                                                            <XCircle className="w-4 h-4 mr-2" /> Reject
                                                        </Button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </Card>
                            );
                        })
                    )}
                </div>
            </div>
        </AdminLayout>
    );
}
