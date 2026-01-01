import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useGame, Question, Difficulty } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Save, Trash2, Edit2, Check, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getAllDisputes, clearDisputes, type Dispute } from "@/lib/disputes";
import { motion } from "framer-motion";

export default function Admin() {
  const [_, setLocation] = useLocation();
  const { state, addQuestion, updateQuestion } = useGame();
  const { toast } = useToast();
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);

  useEffect(() => {
    setDisputes(getAllDisputes());
  }, []);

  const [formData, setFormData] = useState({
    category: "",
    difficulty: "Medium" as Difficulty,
    question: "",
    answer: "",
    explanation: "",
    countryTag: "Global"
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
      tags: ["Custom", formData.countryTag]
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
      countryTag: "Global"
    });
  };

  const handleClearDisputes = () => {
    clearDisputes();
    setDisputes([]);
    toast({
      title: "Disputes Cleared",
      description: "All disputes have been deleted.",
    });
  };

  const startEditing = (dispute: Dispute) => {
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

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="icon" onClick={() => setLocation("/")}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Admin Panel</h1>
            <p className="text-muted-foreground">Manage questions and disputes.</p>
          </div>
        </div>

        <Tabs defaultValue="questions" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="questions">Add Questions</TabsTrigger>
            <TabsTrigger value="disputes">
              Answer Disputes
              {disputes.length > 0 && (
                <span className="ml-2 px-2 py-1 text-xs bg-red-500/20 text-red-500 rounded-full">
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
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Difficulty</label>
                      <Select 
                        value={formData.difficulty} 
                        onValueChange={(v: Difficulty) => setFormData({...formData, difficulty: v})}
                      >
                        <SelectTrigger>
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
                        <SelectTrigger>
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
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Answer</label>
                    <Input 
                      value={formData.answer} 
                      onChange={e => setFormData({...formData, answer: e.target.value})}
                      placeholder="Short, direct answer"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Explanation (Optional)</label>
                    <Textarea 
                      value={formData.explanation} 
                      onChange={e => setFormData({...formData, explanation: e.target.value})}
                      placeholder="Context shown after answering..."
                    />
                  </div>

                  <Button type="submit" className="w-full">
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
                <div className="flex justify-between items-center">
                  <h2 className="text-lg font-semibold">{disputes.length} Disputed Answer{disputes.length !== 1 ? 's' : ''}</h2>
                  <Button 
                    variant="destructive" 
                    size="sm"
                    onClick={handleClearDisputes}
                  >
                    <Trash2 className="w-4 h-4 mr-2" /> Clear All
                  </Button>
                </div>
                <div className="space-y-4">
                  {disputes.map((dispute) => (
                    <Card key={dispute.id} className="bg-white/5 border-white/10 border-red-500/30">
                      <CardContent className="p-4 space-y-3">
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <div className="text-xs text-muted-foreground mb-1">Question</div>
                            <div className="font-semibold">{dispute.questionText}</div>
                          </div>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            onClick={() => startEditing(dispute)}
                            className="text-primary hover:text-primary hover:bg-primary/10"
                          >
                            <Edit2 className="w-4 h-4" />
                          </Button>
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
                              />
                            </div>
                            <div className="space-y-2">
                              <label className="text-xs font-medium uppercase text-muted-foreground">Question Text</label>
                              <Textarea 
                                value={editingQuestion.question}
                                onChange={(e) => setEditingQuestion({...editingQuestion, question: e.target.value})}
                                className="bg-background border-white/20 min-h-[80px]"
                              />
                            </div>
                            <div className="flex gap-2 justify-end">
                              <Button variant="ghost" size="sm" onClick={() => setEditingQuestion(null)}>
                                <X className="w-4 h-4 mr-1" /> Cancel
                              </Button>
                              <Button size="sm" onClick={saveEdit}>
                                <Check className="w-4 h-4 mr-1" /> Update Question
                              </Button>
                            </div>
                          </motion.div>
                        ) : (
                          <>
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <div className="text-xs text-muted-foreground mb-1">Game's Answer</div>
                                <div className="font-semibold text-primary">{dispute.correctAnswer}</div>
                              </div>
                              <div>
                                <div className="text-xs text-muted-foreground mb-1">Team's Answer</div>
                                <div className="font-semibold">{dispute.submittedAnswer || "(Passed)"}</div>
                              </div>
                            </div>
                            <div>
                              <div className="text-xs text-muted-foreground mb-1">Team: {dispute.teamName} — {new Date(dispute.timestamp).toLocaleDateString()}</div>
                              <div className="text-sm bg-red-500/10 rounded p-2 italic text-red-400/80">
                                "{dispute.teamExplanation}"
                              </div>
                            </div>
                          </>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
