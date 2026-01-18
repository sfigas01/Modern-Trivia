import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useGame, Question, Difficulty } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Save, Trash2, Edit2, Check, X, LogIn, Shield, BrainCircuit, ExternalLink, CheckCircle, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useAdmin } from "@/hooks/use-admin";
import { useDisputes } from "@/hooks/use-disputes";
import { motion } from "framer-motion";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";

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

export default function Admin() {
  const [_, setLocation] = useLocation();
  const { state, addQuestion, updateQuestion } = useGame();
  const { toast } = useToast();
  const { user, isLoading: authLoading, isAuthenticated } = useAuth();
  const { isAdmin, isLoading: adminLoading } = useAdmin();
  const { disputes, clearDisputes, isClearing } = useDisputes();
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "resolved" | "rejected">("pending");
  
  const filteredDisputes = disputes.filter(d => 
    statusFilter === "all" ? true : d.status === statusFilter
  );
  
  const pendingCount = disputes.filter(d => d.status === "pending").length;
  const resolvedCount = disputes.filter(d => d.status === "resolved").length;
  const rejectedCount = disputes.filter(d => d.status === "rejected").length;

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

  const handleApplyFix = async (dispute: typeof disputes[0], analysis: AIAnalysis) => {
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

  const [formData, setFormData] = useState({
    category: "",
    difficulty: "Medium" as Difficulty,
    question: "",
    answer: "",
    explanation: "",
    countryTag: "Global",
    sourceUrl: "",
    sourceName: ""
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.question || !formData.answer) return;

    const newQuestion: Question = {
      id: crypto.randomUUID(),
      category: formData.category || "General",
      difficulty: formData.difficulty,
      question: formData.question,
      answer: formData.answer,
      explanation: formData.explanation,
      tags: ["Custom", formData.countryTag],
      ...(formData.sourceUrl && { sourceUrl: formData.sourceUrl }),
      ...(formData.sourceName && { sourceName: formData.sourceName })
    };

    addQuestion(newQuestion);
    
    toast({
      title: "Question Added",
      description: "Successfully added to local library.",
    });

    setFormData({
      category: "",
      difficulty: "Medium",
      question: "",
      answer: "",
      explanation: "",
      countryTag: "Global",
      sourceUrl: "",
      sourceName: ""
    });
  };

  const handleClearDisputes = () => {
    clearDisputes();
    toast({
      title: "Disputes Cleared",
      description: "All disputes have been deleted.",
    });
  };

  const startEditing = (dispute: any) => {
    const question = state.questions.find(q => q.id === dispute.questionId);
    if (question) {
      setEditingQuestion({ ...question });
    } else {
      setEditingQuestion({
        id: dispute.questionId,
        question: dispute.questionText,
        answer: dispute.correctAnswer,
        category: "Disputed",
        difficulty: "Medium",
        explanation: "",
        tags: []
      });
    }
  };

  const saveEdit = () => {
    if (!editingQuestion) return;
    
    updateQuestion(editingQuestion);
    
    toast({
      title: "Question Updated",
      description: "Changes have been saved to the local library.",
    });
    
    setEditingQuestion(null);
  };

  // Loading state
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

  // Not authenticated
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
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Authenticated but not admin
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
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Authenticated and admin - show full admin panel
  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="icon" onClick={() => setLocation("/")} data-testid="button-back">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="flex-1">
            <h1 className="text-3xl font-bold">Admin Panel</h1>
            <p className="text-muted-foreground">Manage questions and disputes.</p>
          </div>
          <div className="text-right text-sm">
            <p className="text-muted-foreground">Signed in as</p>
            <p className="font-medium">{user?.email || "Admin"}</p>
          </div>
        </div>

        <Tabs defaultValue="questions" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="questions" data-testid="tab-questions">Add Questions</TabsTrigger>
            <TabsTrigger value="disputes" data-testid="tab-disputes">
              Answer Disputes
              {disputes.length > 0 && (
                <span className="ml-2 px-2 py-1 text-xs bg-red-500/20 text-red-500 rounded-full" data-testid="text-dispute-count">
                  {disputes.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="questions" className="space-y-6">
            <Card className="bg-white/5 border-white/10">
              <CardHeader>
                <CardTitle>Add New Question</CardTitle>
                <CardDescription>Questions persist in local storage on this device.</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Category</label>
                      <Input 
                        value={formData.category} 
                        onChange={e => setFormData({...formData, category: e.target.value})}
                        placeholder="e.g. Science"
                        data-testid="input-category"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Difficulty</label>
                      <Select 
                        value={formData.difficulty} 
                        onValueChange={(v: Difficulty) => setFormData({...formData, difficulty: v})}
                      >
                        <SelectTrigger data-testid="select-difficulty">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Easy">Easy (+1/-1)</SelectItem>
                          <SelectItem value="Medium">Medium (+2/-2)</SelectItem>
                          <SelectItem value="Hard">Hard (+3/-3)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Region Tag</label>
                    <Select 
                        value={formData.countryTag} 
                        onValueChange={(v) => setFormData({...formData, countryTag: v})}
                      >
                        <SelectTrigger data-testid="select-region">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Global">Global</SelectItem>
                          <SelectItem value="US">United States</SelectItem>
                          <SelectItem value="CA">Canada</SelectItem>
                        </SelectContent>
                      </Select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Question</label>
                    <Textarea 
                      value={formData.question} 
                      onChange={e => setFormData({...formData, question: e.target.value})}
                      placeholder="What is the capital of..."
                      className="min-h-[100px]"
                      data-testid="input-question"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Answer</label>
                    <Input 
                      value={formData.answer} 
                      onChange={e => setFormData({...formData, answer: e.target.value})}
                      placeholder="Short, direct answer"
                      data-testid="input-answer"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Explanation (Optional)</label>
                    <Textarea
                      value={formData.explanation}
                      onChange={e => setFormData({...formData, explanation: e.target.value})}
                      placeholder="Context shown after answering..."
                      data-testid="input-explanation"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Source URL (Optional)</label>
                      <Input
                        value={formData.sourceUrl}
                        onChange={e => setFormData({...formData, sourceUrl: e.target.value})}
                        placeholder="https://..."
                        data-testid="input-source-url"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Source Name (Optional)</label>
                      <Input
                        value={formData.sourceName}
                        onChange={e => setFormData({...formData, sourceName: e.target.value})}
                        placeholder="e.g. Wikipedia"
                        data-testid="input-source-name"
                      />
                    </div>
                  </div>

                  <Button type="submit" className="w-full" data-testid="button-save-question">
                    <Save className="w-4 h-4 mr-2" /> Save Question
                  </Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="disputes" className="space-y-6">
            {disputes.length === 0 ? (
              <Card className="bg-white/5 border-white/10 border-dashed">
                <CardContent className="p-8 text-center">
                  <p className="text-muted-foreground">No disputes yet.</p>
                  <p className="text-sm text-muted-foreground mt-1">Users can flag incorrect answers during gameplay.</p>
                </CardContent>
              </Card>
            ) : (
              <>
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
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
                  <Button 
                    variant="destructive" 
                    size="sm"
                    onClick={handleClearDisputes}
                    disabled={isClearing}
                    data-testid="button-clear-disputes"
                  >
                    <Trash2 className="w-4 h-4 mr-2" /> Clear All
                  </Button>
                </div>
                
                {filteredDisputes.length === 0 ? (
                  <Card className="bg-white/5 border-white/10 border-dashed">
                    <CardContent className="p-8 text-center">
                      <p className="text-muted-foreground">
                        {statusFilter === "all" ? "No disputes match the current filter." : `No ${statusFilter} disputes.`}
                      </p>
                    </CardContent>
                  </Card>
                ) : (
                <div className="space-y-4">
                  {filteredDisputes.map((dispute) => {
                    const analysis = dispute.aiAnalysis as AIAnalysis | null;
                    return (
                      <Card key={dispute.id} className={`bg-white/5 border-white/10 ${dispute.status === 'pending' ? 'border-yellow-500/30' : dispute.status === 'resolved' ? 'border-green-500/30' : 'border-red-500/30'}`} data-testid={`card-dispute-${dispute.id}`}>
                        <CardContent className="p-4 space-y-3">
                          <div className="flex justify-between items-start">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <Badge variant="outline" className={
                                  dispute.status === 'pending' ? 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20' :
                                    dispute.status === 'resolved' ? 'bg-green-500/10 text-green-500 border-green-500/20' :
                                      'bg-red-500/10 text-red-500 border-red-500/20'
                                }>
                                  {dispute.status.toUpperCase()}
                                </Badge>
                                <span className="text-xs text-muted-foreground">Question</span>
                              </div>
                              <div className="font-semibold" data-testid={`text-question-${dispute.id}`}>{dispute.questionText}</div>
                            </div>
                            {dispute.status === 'pending' && (
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                onClick={() => startEditing(dispute)}
                                className="text-primary hover:text-primary hover:bg-primary/10"
                                data-testid={`button-edit-${dispute.id}`}
                              >
                                <Edit2 className="w-4 h-4" />
                              </Button>
                            )}
                          </div>
                          
                          {editingQuestion?.id === dispute.questionId ? (
                            <motion.div 
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              className="p-4 border border-primary/30 bg-primary/5 rounded-lg space-y-4"
                            >
                              <div className="text-sm font-bold text-primary flex items-center gap-2">
                                <Edit2 className="w-3 h-3" /> EDITING QUESTION
                              </div>
                              <div className="space-y-2">
                                <label className="text-xs font-medium uppercase text-muted-foreground">Correct Answer</label>
                                <Input 
                                  value={editingQuestion.answer}
                                  onChange={(e) => setEditingQuestion({...editingQuestion, answer: e.target.value})}
                                  className="bg-background border-white/20"
                                  data-testid="input-edit-answer"
                                />
                              </div>
                              <div className="space-y-2">
                                <label className="text-xs font-medium uppercase text-muted-foreground">Question Text</label>
                                <Textarea
                                  value={editingQuestion.question}
                                  onChange={(e) => setEditingQuestion({...editingQuestion, question: e.target.value})}
                                  className="bg-background border-white/20 min-h-[80px]"
                                  data-testid="input-edit-question"
                                />
                              </div>
                              <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                  <label className="text-xs font-medium uppercase text-muted-foreground">Source URL</label>
                                  <Input
                                    value={editingQuestion.sourceUrl || ""}
                                    onChange={(e) => setEditingQuestion({...editingQuestion, sourceUrl: e.target.value})}
                                    className="bg-background border-white/20"
                                    placeholder="https://..."
                                    data-testid="input-edit-source-url"
                                  />
                                </div>
                                <div className="space-y-2">
                                  <label className="text-xs font-medium uppercase text-muted-foreground">Source Name</label>
                                  <Input
                                    value={editingQuestion.sourceName || ""}
                                    onChange={(e) => setEditingQuestion({...editingQuestion, sourceName: e.target.value})}
                                    className="bg-background border-white/20"
                                    placeholder="e.g. Wikipedia"
                                    data-testid="input-edit-source-name"
                                  />
                                </div>
                              </div>
                              <div className="flex gap-2 justify-end">
                                <Button variant="ghost" size="sm" onClick={() => setEditingQuestion(null)} data-testid="button-cancel-edit">
                                  <X className="w-4 h-4 mr-1" /> Cancel
                                </Button>
                                <Button size="sm" onClick={saveEdit} data-testid="button-update-question">
                                  <Check className="w-4 h-4 mr-1" /> Update Question
                                </Button>
                              </div>
                            </motion.div>
                          ) : (
                            <>
                              <div className="grid grid-cols-2 gap-4">
                                <div>
                                  <div className="text-xs text-muted-foreground mb-1">Game's Answer</div>
                                  <div className="font-semibold text-primary" data-testid={`text-correct-answer-${dispute.id}`}>{dispute.correctAnswer}</div>
                                </div>
                                <div>
                                  <div className="text-xs text-muted-foreground mb-1">Team's Answer</div>
                                  <div className="font-semibold" data-testid={`text-submitted-answer-${dispute.id}`}>{dispute.submittedAnswer || "(Passed)"}</div>
                                </div>
                              </div>
                              <div>
                                <div className="text-xs text-muted-foreground mb-1">Team: {dispute.teamName} — {new Date(dispute.timestamp).toLocaleDateString()}</div>
                                <div className="text-sm bg-red-500/10 rounded p-2 italic text-red-400/80" data-testid={`text-explanation-${dispute.id}`}>
                                  "{dispute.teamExplanation}"
                                </div>
                              </div>

                              {analysis && (
                                <motion.div
                                  initial={{ opacity: 0, y: 10 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  className="p-4 border border-purple-500/30 bg-purple-500/5 rounded-lg space-y-3"
                                >
                                  <div className="flex items-center gap-2">
                                    <BrainCircuit className="w-4 h-4 text-purple-400" />
                                    <span className="text-sm font-bold text-purple-400">AI ANALYSIS</span>
                                  </div>
                                  <div className="flex items-center justify-between">
                                    <span className={`font-bold ${getVerdictColor(analysis.verdict)}`}>
                                      {analysis.verdict === "CORRECT" ? "User is Correct" : 
                                       analysis.verdict === "INCORRECT" ? "Game is Correct" : "Ambiguous"}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                      {analysis.confidence}% confidence
                                    </span>
                                  </div>
                                  <p className="text-sm text-muted-foreground">
                                    {analysis.reasoning}
                                  </p>
                                  {analysis.suggestedFix?.answer && (
                                    <div className="p-2 bg-yellow-500/10 rounded border border-yellow-500/20">
                                      <div className="flex items-center justify-between mb-1">
                                        <p className="text-xs font-medium text-yellow-500">Suggested Fix:</p>
                                        {dispute.status === 'pending' && (
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            className="h-6 text-xs border-yellow-500/20 hover:bg-yellow-500/10 hover:text-yellow-500"
                                            onClick={() => handleApplyFix(dispute, analysis)}
                                            disabled={resolvingId === dispute.id}
                                            data-testid={`button-apply-fix-${dispute.id}`}
                                          >
                                            <Check className="w-3 h-3 mr-1" /> Apply Fix
                                          </Button>
                                        )}
                                      </div>
                                      <p className="text-sm">
                                        Change answer to: <strong>{analysis.suggestedFix.answer}</strong>
                                      </p>
                                    </div>
                                  )}
                                  {analysis.sources.length > 0 && (
                                    <div className="flex flex-wrap gap-1">
                                      {analysis.sources.map((source, i) => (
                                        <Badge key={i} variant="outline" className="text-xs">
                                          <ExternalLink className="w-3 h-3 mr-1" />
                                          {source}
                                        </Badge>
                                      ))}
                                    </div>
                                  )}
                                </motion.div>
                              )}

                              {dispute.status === 'pending' && (
                                <div className="flex gap-2 pt-2 border-t border-white/10">
                                  <Button
                                    size="sm"
                                    className="bg-purple-600 hover:bg-purple-700"
                                    onClick={() => handleAnalyze(dispute.id)}
                                    disabled={analyzingId === dispute.id || resolvingId === dispute.id}
                                    data-testid={`button-analyze-${dispute.id}`}
                                  >
                                    <BrainCircuit className="w-4 h-4 mr-2" />
                                    {analyzingId === dispute.id ? "Analyzing..." : "Analyze with AI"}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="border-green-500/20 hover:bg-green-500/10 hover:text-green-500"
                                    onClick={() => handleResolve(dispute.id, "resolved")}
                                    disabled={resolvingId === dispute.id}
                                    data-testid={`button-accept-${dispute.id}`}
                                  >
                                    <CheckCircle className="w-4 h-4 mr-2" /> Accept
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="border-red-500/20 hover:bg-red-500/10 hover:text-red-500"
                                    onClick={() => handleResolve(dispute.id, "rejected")}
                                    disabled={resolvingId === dispute.id}
                                    data-testid={`button-reject-${dispute.id}`}
                                  >
                                    <XCircle className="w-4 h-4 mr-2" /> Reject
                                  </Button>
                                </div>
                              )}
                            </>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
                )}
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
