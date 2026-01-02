import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { saveDispute } from "@/lib/disputes";
import { useToast } from "@/hooks/use-toast";

interface DisputeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  questionId: string;
  questionText: string;
  correctAnswer: string;
  teamName: string;
  submittedAnswer: string | null;
}

export function DisputeModal({
  open,
  onOpenChange,
  questionId,
  questionText,
  correctAnswer,
  teamName,
  submittedAnswer
}: DisputeModalProps) {
  const [explanation, setExplanation] = useState("");
  const { toast } = useToast();

  const handleSubmit = async () => {
    if (!explanation.trim()) {
      toast({
        title: "Error",
        description: "Please provide an explanation for the dispute.",
        variant: "destructive"
      });
      return;
    }

    const result = await saveDispute({
      questionId,
      questionText,
      correctAnswer,
      teamName,
      submittedAnswer,
      teamExplanation: explanation
    });

    if (result.needsAuth) {
      toast({
        title: "Authentication Required",
        description: "Please sign in to submit disputes. Redirecting to login...",
        variant: "destructive"
      });
      setTimeout(() => {
        window.location.href = "/api/login";
      }, 1500);
      return;
    }

    if (!result.success) {
      toast({
        title: "Error",
        description: result.message || "Failed to submit dispute. Please try again.",
        variant: "destructive"
      });
      return;
    }

    toast({
      title: "Dispute Submitted",
      description: "Thank you for helping us improve the game. We'll review this.",
    });

    setExplanation("");
    onOpenChange(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>Dispute This Answer</AlertDialogTitle>
          <AlertDialogDescription>
            Help us improve the game by explaining why you think this answer is incorrect.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4 my-4">
          <Card className="bg-white/5 border-white/10">
            <CardContent className="p-4 space-y-2">
              <div>
                <div className="text-sm text-muted-foreground mb-1">Question</div>
                <div className="font-semibold">{questionText}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground mb-1">Game's Answer</div>
                <div className="font-semibold text-primary">{correctAnswer}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground mb-1">Your Answer</div>
                <div className="font-semibold">{submittedAnswer || "(Passed)"}</div>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-2">
            <label className="text-sm font-medium">Why do you dispute this answer?</label>
            <Textarea
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
              placeholder="Explain why you think the game's answer is incorrect or provide evidence..."
              className="min-h-32 bg-white/5 border-white/10"
            />
            <p className="text-xs text-muted-foreground">
              Your feedback helps us verify and fix incorrect answers.
            </p>
          </div>
        </div>

        <div className="flex gap-2 justify-end">
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleSubmit} className="bg-primary">
            Submit Dispute
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
