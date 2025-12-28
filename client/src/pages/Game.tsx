import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useGame, Team } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { motion, AnimatePresence } from "framer-motion";
import { Check, X, Minus, Trophy, ArrowRight, HelpCircle } from "lucide-react";
import confetti from "canvas-confetti";

export default function Game() {
  const [_, setLocation] = useLocation();
  const { state, handleAnswer, nextQuestion, endGame } = useGame();
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);

  // Redirect if invalid state
  useEffect(() => {
    if (state.teams.length < 2 || !state.questions.length) {
      setLocation("/");
    }
  }, [state.teams, state.questions, setLocation]);

  if (!state.questions.length) return null;

  const currentQ = state.questions[state.currentQuestionIndex];
  const isSummary = state.phase === "summary";

  const getDifficultyColor = (d: string) => {
    switch(d) {
      case "Easy": return "bg-[var(--color-difficulty-easy)] text-white hover:bg-[var(--color-difficulty-easy)]/90";
      case "Medium": return "bg-[var(--color-difficulty-medium)] text-black hover:bg-[var(--color-difficulty-medium)]/90";
      case "Hard": return "bg-[var(--color-difficulty-hard)] text-white hover:bg-[var(--color-difficulty-hard)]/90";
      default: return "bg-primary";
    }
  };

  const handleAction = (result: "correct" | "incorrect" | "pass") => {
    if (selectedTeam) {
      if (result === "correct") {
        confetti({
          particleCount: 100,
          spread: 70,
          origin: { y: 0.6 }
        });
      }
      handleAnswer(selectedTeam.id, result);
      setSelectedTeam(null);
    }
  };

  // Summary View
  if (isSummary) {
    // Sort teams by score
    const sortedTeams = [...state.teams].sort((a, b) => b.score - a.score);
    const swingTeam = state.teams.find(t => t.id === state.recentSwingTeamId);
    const wasCorrect = swingTeam && swingTeam.lastRoundDelta > 0;
    const wasPass = swingTeam && swingTeam.lastRoundDelta === 0;

    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-background overflow-hidden relative">
        {/* Background elements */}
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-primary/5 rounded-full blur-[100px] pointer-events-none" />
        
        <div className="w-full max-w-4xl space-y-8 relative z-10">
          {/* Result Banner */}
          <motion.div 
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="text-center space-y-6"
          >
            <Badge variant="outline" className="px-4 py-1 text-sm uppercase tracking-widest border-white/20">
              Round Complete
            </Badge>
            
            <div className="space-y-2">
              <h2 className="text-2xl text-muted-foreground font-medium">The answer was</h2>
              <h1 className="text-4xl md:text-6xl font-bold text-primary filter drop-shadow-lg">
                {currentQ.answer}
              </h1>
            </div>

            <Card className="bg-white/5 border-white/10 max-w-2xl mx-auto backdrop-blur-sm">
              <CardContent className="p-6 text-center">
                <p className="text-lg md:text-xl leading-relaxed opacity-90">
                  {currentQ.explanation}
                </p>
              </CardContent>
            </Card>
          </motion.div>

          {/* Scoreboard */}
          <div className="grid md:grid-cols-2 gap-6 mt-12">
            <div className="space-y-4">
               <div className="flex items-center justify-between text-sm uppercase tracking-wider text-muted-foreground border-b border-white/10 pb-2">
                 <span>Team</span>
                 <span>Score</span>
               </div>
               <div className="space-y-3">
                 {sortedTeams.map((team, index) => (
                   <motion.div 
                     key={team.id}
                     layout
                     className={`flex items-center justify-between p-4 rounded-xl border transition-colors ${
                       team.id === state.recentSwingTeamId 
                         ? (wasCorrect ? 'bg-green-500/10 border-green-500/50' : (wasPass ? 'bg-white/5 border-white/20' : 'bg-red-500/10 border-red-500/50'))
                         : 'bg-white/5 border-white/5'
                     }`}
                   >
                     <div className="flex items-center gap-3">
                       <span className="flex items-center justify-center w-8 h-8 rounded-full bg-white/10 text-xs font-bold font-mono">
                         {index + 1}
                       </span>
                       <span className="font-bold text-lg">{team.name}</span>
                       {team.id === state.recentSwingTeamId && (
                         <Badge variant="secondary" className="text-[10px] h-5">
                           {wasPass ? "PASSED" : (wasCorrect ? "HIT" : "MISS")}
                         </Badge>
                       )}
                     </div>
                     <div className="flex items-center gap-2">
                        <span className={`text-sm font-mono ${team.lastRoundDelta > 0 ? 'text-green-400' : team.lastRoundDelta < 0 ? 'text-red-400' : 'text-muted-foreground'}`}>
                          {team.lastRoundDelta > 0 ? '+' : ''}{team.lastRoundDelta !== 0 ? team.lastRoundDelta : '-'}
                        </span>
                        <span className="text-2xl font-bold font-mono">{team.score}</span>
                     </div>
                   </motion.div>
                 ))}
               </div>
            </div>

            <div className="flex flex-col justify-center space-y-4">
               {swingTeam && (
                 <Card className="bg-gradient-to-br from-white/5 to-transparent border-white/10 overflow-hidden">
                   <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary to-transparent opacity-50" />
                   <CardContent className="p-6 text-center space-y-2">
                     <div className="text-sm uppercase tracking-widest text-muted-foreground">Round Impact</div>
                     <div className="text-3xl font-bold truncate">{swingTeam.name}</div>
                     <div className={`text-5xl font-black font-mono tracking-tighter ${wasCorrect ? 'text-green-400' : (wasPass ? 'text-muted-foreground' : 'text-red-400')}`}>
                        {wasCorrect ? '+' : ''}{swingTeam.lastRoundDelta}
                     </div>
                   </CardContent>
                 </Card>
               )}
               
               <Button 
                 onClick={nextQuestion} 
                 className="h-20 text-xl font-bold shadow-lg hover:shadow-primary/20 transition-all mt-auto"
               >
                 NEXT QUESTION <ArrowRight className="ml-2 w-6 h-6" />
               </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Question View
  return (
    <div className="min-h-screen flex flex-col bg-background relative overflow-hidden">
      {/* Top Bar */}
      <div className="w-full h-2 bg-white/5">
        <motion.div 
          className="h-full bg-primary"
          initial={{ width: "0%" }}
          animate={{ width: `${((state.currentQuestionIndex) / state.questions.length) * 100}%` }}
        />
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-4 md:p-8 max-w-6xl mx-auto w-full relative z-10">
        
        {/* Question Card */}
        <AnimatePresence mode="wait">
           <motion.div
             key={currentQ.id}
             initial={{ opacity: 0, y: 50, rotateX: -10 }}
             animate={{ opacity: 1, y: 0, rotateX: 0 }}
             exit={{ opacity: 0, y: -50, rotateX: 10 }}
             transition={{ duration: 0.5, type: "spring" }}
             className="w-full max-w-4xl"
           >
             <div className="flex justify-between items-center mb-6">
                <Badge variant="outline" className="text-lg px-4 py-2 border-white/20 bg-white/5">
                  {currentQ.category}
                </Badge>
                <Badge className={`text-lg px-4 py-2 ${getDifficultyColor(currentQ.difficulty)} border-none shadow-lg`}>
                  {currentQ.difficulty}
                </Badge>
             </div>

             <div className="min-h-[300px] flex items-center justify-center text-center p-8 md:p-12 rounded-3xl bg-white/5 border border-white/10 backdrop-blur-md shadow-2xl relative overflow-hidden group">
               <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-blue-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-1000" />
               <h1 className="text-3xl md:text-5xl lg:text-6xl font-bold leading-tight font-display tracking-tight drop-shadow-sm relative z-10">
                 {currentQ.question}
               </h1>
             </div>
           </motion.div>
        </AnimatePresence>

        {/* Controls */}
        <div className="mt-12 w-full max-w-4xl">
          <div className="text-center mb-6 text-muted-foreground font-medium uppercase tracking-widest text-sm">
            {selectedTeam ? `Action for ${selectedTeam.name}` : "Who is answering?"}
          </div>

          {!selectedTeam ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {state.teams.map((team) => (
                <Button
                  key={team.id}
                  variant="outline"
                  onClick={() => setSelectedTeam(team)}
                  className="h-20 text-lg md:text-xl font-bold border-white/10 hover:bg-primary hover:text-white hover:border-primary transition-all duration-300 hover:scale-105 active:scale-95"
                >
                  {team.name}
                  <Badge variant="secondary" className="ml-2 bg-white/20 text-current">{team.score}</Badge>
                </Button>
              ))}
              <Button
                variant="ghost"
                onClick={nextQuestion}
                className="h-20 text-muted-foreground hover:text-foreground border border-transparent hover:border-white/10"
              >
                Skip / No One Knows
              </Button>
            </div>
          ) : (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="grid grid-cols-3 gap-4"
            >
              <Button
                onClick={() => handleAction("incorrect")}
                className="h-24 bg-red-500/20 text-red-500 border border-red-500/50 hover:bg-red-500 hover:text-white text-xl md:text-2xl font-bold transition-all"
              >
                <X className="w-8 h-8 mr-2" /> Incorrect
              </Button>
              <Button
                onClick={() => handleAction("pass")}
                className="h-24 bg-yellow-500/20 text-yellow-500 border border-yellow-500/50 hover:bg-yellow-500 hover:text-black text-xl md:text-2xl font-bold transition-all"
              >
                <Minus className="w-8 h-8 mr-2" /> Pass
              </Button>
              <Button
                onClick={() => handleAction("correct")}
                className="h-24 bg-green-500/20 text-green-500 border border-green-500/50 hover:bg-green-500 hover:text-white text-xl md:text-2xl font-bold transition-all"
              >
                <Check className="w-8 h-8 mr-2" /> Correct
              </Button>
            </motion.div>
          )}
          
          {selectedTeam && (
             <div className="mt-4 text-center">
               <Button variant="ghost" size="sm" onClick={() => setSelectedTeam(null)} className="text-muted-foreground">
                 Cancel Selection
               </Button>
             </div>
          )}
        </div>
      </div>
      
      {/* Background decoration */}
      <div className="absolute bottom-0 left-0 w-full h-1/2 bg-gradient-to-t from-background to-transparent z-0 pointer-events-none" />
    </div>
  );
}
