import { useState } from "react";
import { useLocation } from "wouter";
import { useGame, Question, Difficulty } from "@/lib/store";
import { AdminLayout } from "@/components/admin-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, LogIn, Shield } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useAdmin } from "@/hooks/use-admin";

export default function Admin() {
  const [_, setLocation] = useLocation();
  const { addQuestion } = useGame();
  const { toast } = useToast();
  const { user, isLoading: authLoading, isAuthenticated } = useAuth();
  const { isAdmin, isLoading: adminLoading } = useAdmin();

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
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Add Questions</h2>
          <p className="text-muted-foreground">Add custom trivia questions to your local library.</p>
        </div>

        <Card className="bg-white/5 border-white/10 max-w-2xl">
          <CardHeader>
            <CardTitle>New Question</CardTitle>
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
      </div>
    </AdminLayout>
  );
}
