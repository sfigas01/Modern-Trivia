import { useState } from "react";
import { useLocation } from "wouter";
import { AdminLayout } from "@/components/admin-layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, XCircle, BrainCircuit, ExternalLink, Trash2, Sparkles, LogIn, Shield } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Dispute, AIAnalysis } from "@shared/schema";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useGame, Question } from "@/lib/store";
import { useAuth } from "@/hooks/use-auth";
import { useAdmin } from "@/hooks/use-admin";

export default function AdminDisputes() {
    const [_, setLocation] = useLocation();
    const { toast } = useToast();
    const { user, isLoading: authLoading, isAuthenticated } = useAuth();
    const { isAdmin, isLoading: adminLoading } = useAdmin();
    const { state, updateQuestion } = useGame();
    const { data: disputes = [], isLoading } = useQuery<Dispute[]>({
        queryKey: ["/api/disputes"],
    });

    const [analyzingId, setAnalyzingId] = useState<string | null>(null);
    const [resolvingId, setResolvingId] = useState<string | null>(null);
    const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "resolved" | "rejected">("pending");

    const filteredDisputes = disputes.filter(d => 
        statusFilter === "all" ? true : d.status === statusFilter
    );
    
    const pendingCount = disputes.filter(d => d.status === "pending").length;
    const resolvedCount = disputes.filter(d => d.status === "resolved").length;
    const rejectedCount = disputes.filter(d => d.status === "rejected").length;

    const clearMutation = useMutation({
        mutationFn: () => apiRequest("DELETE", "/api/disputes"),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/disputes"] });
            toast({ title: "Disputes Cleared", description: "All disputes have been deleted." });
        },
        onError: () => {
            toast({ title: "Error", description: "Failed to clear disputes.", variant: "destructive" });
        }
    });

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

    const handleApplyFix = async (dispute: Dispute, analysis: AIAnalysis) => {
        if (!analysis.suggestedFix) return;
        
        const questionToUpdate = state.questions.find(q => q.id === dispute.questionId);
        if (!questionToUpdate) {
            toast({
                title: "Question Not Found",
                description: "Could not find the question to update.",
                variant: "destructive"
            });
            return;
        }

        const updatedQuestion: Question = {
            ...questionToUpdate,
            answer: analysis.suggestedFix.answer || questionToUpdate.answer,
            question: analysis.suggestedFix.question || questionToUpdate.question,
            explanation: analysis.suggestedFix.explanation || questionToUpdate.explanation,
        };

        updateQuestion(updatedQuestion);
        await handleResolve(dispute.id, "resolved");
        
        toast({
            title: "Fix Applied",
            description: "The question has been updated with the AI suggestion.",
        });
    };

    const getVerdictColor = (verdict: string) => {
        switch (verdict) {
            case "CORRECT": return "text-green-500";
            case "INCORRECT": return "text-red-500";
            default: return "text-yellow-500";
        }
    };

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
                        <CardDescription>
                            Please sign in to access the admin panel
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <Button 
                            className="w-full" 
                            size="lg"
                            onClick={() => window.location.href = "/api/login"}
                        >
                            <LogIn className="w-4 h-4 mr-2" />
                            Sign In with Replit
                        </Button>
                        <Button 
                            variant="outline" 
                            className="w-full"
                            onClick={() => setLocation("/")}
                        >
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
                            <p className="font-medium">{user?.email || "Unknown user"}</p>
                        </div>
                        <Button 
                            variant="outline" 
                            className="w-full"
                            onClick={() => setLocation("/")}
                        >
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
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div>
                        <h2 className="text-3xl font-bold tracking-tight" data-testid="text-disputes-title">Dispute Resolution</h2>
                        <p className="text-muted-foreground">Review and resolve reported inaccuracies with AI assistance.</p>
                    </div>
                    {disputes.length > 0 && (
                        <Button 
                            variant="destructive" 
                            size="sm"
                            onClick={() => clearMutation.mutate()}
                            disabled={clearMutation.isPending}
                            data-testid="button-clear-disputes"
                        >
                            <Trash2 className="w-4 h-4 mr-2" /> Clear All
                        </Button>
                    )}
                </div>

                {disputes.length > 0 && (
                    <div className="flex gap-1 flex-wrap" data-testid="dispute-filter-tabs">
                        <Button
                            size="sm"
                            variant={statusFilter === "pending" ? "default" : "ghost"}
                            onClick={() => setStatusFilter("pending")}
                            className={statusFilter === "pending" ? "bg-yellow-600 hover:bg-yellow-700" : ""}
                            data-testid="filter-pending"
                        >
                            Pending {pendingCount > 0 && `(${pendingCount})`}
                        </Button>
                        <Button
                            size="sm"
                            variant={statusFilter === "resolved" ? "default" : "ghost"}
                            onClick={() => setStatusFilter("resolved")}
                            className={statusFilter === "resolved" ? "bg-green-600 hover:bg-green-700" : ""}
                            data-testid="filter-resolved"
                        >
                            Resolved {resolvedCount > 0 && `(${resolvedCount})`}
                        </Button>
                        <Button
                            size="sm"
                            variant={statusFilter === "rejected" ? "default" : "ghost"}
                            onClick={() => setStatusFilter("rejected")}
                            className={statusFilter === "rejected" ? "bg-red-600 hover:bg-red-700" : ""}
                            data-testid="filter-rejected"
                        >
                            Rejected {rejectedCount > 0 && `(${rejectedCount})`}
                        </Button>
                        <Button
                            size="sm"
                            variant={statusFilter === "all" ? "default" : "ghost"}
                            onClick={() => setStatusFilter("all")}
                            data-testid="filter-all"
                        >
                            All ({disputes.length})
                        </Button>
                    </div>
                )}

                <div className="grid gap-4">
                    {isLoading ? (
                        <div className="space-y-4">
                            <Skeleton className="h-32 w-full" />
                            <Skeleton className="h-32 w-full" />
                        </div>
                    ) : disputes.length === 0 ? (
                        <Card className="bg-muted/5 border-dashed">
                            <CardContent className="flex flex-col items-center justify-center p-12 text-center text-muted-foreground">
                                <CheckCircle className="w-12 h-12 mb-4 opacity-20" />
                                <p>No disputes yet. Good job!</p>
                                <p className="text-sm mt-1">Users can flag incorrect answers during gameplay.</p>
                            </CardContent>
                        </Card>
                    ) : filteredDisputes.length === 0 ? (
                        <Card className="bg-muted/5 border-dashed">
                            <CardContent className="flex flex-col items-center justify-center p-12 text-center text-muted-foreground">
                                <p>No {statusFilter} disputes.</p>
                            </CardContent>
                        </Card>
                    ) : (
                        filteredDisputes.map((dispute) => {
                            const analysis = dispute.aiAnalysis as AIAnalysis | null;
                            return (
                                <Card key={dispute.id} className={`bg-white/5 border-white/10 overflow-hidden ${
                                    dispute.status === 'pending' ? 'border-yellow-500/30' : 
                                    dispute.status === 'resolved' ? 'border-green-500/30' : 'border-red-500/30'
                                }`} data-testid={`card-dispute-${dispute.id}`}>
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
                                                                {analysis.suggestedFix.explanation && (
                                                                    <p className="text-xs text-muted-foreground mt-1">
                                                                        Explanation: {analysis.suggestedFix.explanation}
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
                                                    
                                                    {analysis?.suggestedFix && (
                                                        <Button
                                                            className="w-full bg-amber-600 hover:bg-amber-700"
                                                            onClick={() => handleApplyFix(dispute, analysis)}
                                                            disabled={resolvingId === dispute.id}
                                                            data-testid={`button-apply-fix-${dispute.id}`}
                                                        >
                                                            <Sparkles className="w-4 h-4 mr-2" /> Apply Fix
                                                        </Button>
                                                    )}
                                                    
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
