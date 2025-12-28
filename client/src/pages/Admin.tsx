import { useState } from "react";
import { useLocation } from "wouter";
import { useGame, Question, Difficulty } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Save, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Admin() {
  const [_, setLocation] = useLocation();
  const { addQuestion } = useGame();
  const { toast } = useToast();

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

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-2xl mx-auto space-y-8">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="icon" onClick={() => setLocation("/")}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Admin Panel</h1>
            <p className="text-muted-foreground">Add custom questions to the local database.</p>
          </div>
        </div>

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
      </div>
    </div>
  );
}
