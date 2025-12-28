import { useState } from "react";
import { useLocation } from "wouter";
import { useGame } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { X, Plus, Settings, Users, Globe, Zap } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function Home() {
  const [_, setLocation] = useLocation();
  const { state, addTeam, removeTeam, setCountryBias, setCategory, setNumRounds, startGame } = useGame();
  const [newTeamName, setNewTeamName] = useState("");

  const handleAddTeam = (e: React.FormEvent) => {
    e.preventDefault();
    if (newTeamName.trim()) {
      addTeam(newTeamName.trim());
      setNewTeamName("");
    }
  };

  const handleStart = () => {
    startGame();
    setLocation("/game");
  };

  const statusLabel =
    state.phase === "SETUP" ? "Not Started" : state.phase === "GAME_OVER" ? "Completed" : "In Progress";

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-background to-background">
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/20 rounded-full blur-[120px] opacity-50" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-500/10 rounded-full blur-[120px] opacity-50" />
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md z-10 space-y-8"
      >
        <div className="text-center space-y-2">
          <h1 className="text-6xl font-extrabold tracking-tighter bg-gradient-to-br from-white to-white/50 bg-clip-text text-transparent drop-shadow-sm">
            MODERN<br/>TRIVIA
          </h1>
          <p className="text-muted-foreground font-medium tracking-wide">
            THE PARTY GAME
          </p>
          <div className="flex justify-center">
            <Badge variant="outline" className="border-primary/40 text-primary">
              {statusLabel}
            </Badge>
          </div>
        </div>

        <Card className="border-white/10 bg-white/5 backdrop-blur-md shadow-2xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <Users className="w-5 h-5 text-primary" />
              Team Setup
            </CardTitle>
            <CardDescription>
              Add 2-6 teams to begin.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <form onSubmit={handleAddTeam} className="flex gap-2">
              <Input
                placeholder="Enter team name..."
                value={newTeamName}
                onChange={(e) => setNewTeamName(e.target.value)}
                className="bg-white/5 border-white/10 focus:border-primary/50 text-lg py-6"
                autoFocus
              />
              <Button type="submit" size="icon" className="h-12 w-12 shrink-0 rounded-xl" disabled={!newTeamName.trim() || state.teams.length >= 6}>
                <Plus className="w-6 h-6" />
              </Button>
            </form>

            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
              <AnimatePresence mode="popLayout">
                {state.teams.map((team) => (
                  <motion.div
                    key={team.id}
                    layout
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/5 group"
                  >
                    <span className="font-medium text-lg truncate px-2">{team.name}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeTeam(team.id)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/20 hover:text-destructive"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </motion.div>
                ))}
              </AnimatePresence>
              
              {state.teams.length === 0 && (
                <div className="text-center py-8 text-muted-foreground italic border-2 border-dashed border-white/5 rounded-lg">
                  No teams added yet
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-white/5 backdrop-blur-md">
          <CardHeader className="pb-3">
             <CardTitle className="flex items-center gap-2 text-lg">
              <Globe className="w-4 h-4 text-primary" />
              Region Bias
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-2">
              {(["Mix", "US", "CA"] as const).map((bias) => (
                <Button
                  key={bias}
                  variant={state.countryBias === bias ? "default" : "outline"}
                  onClick={() => setCountryBias(bias)}
                  className={`border-white/10 hover:bg-white/10 ${state.countryBias === bias ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''}`}
                >
                  {bias === "Mix" ? "Global Mix" : bias}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-white/5 backdrop-blur-md">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              Category
            </CardTitle>
            <CardDescription>
              Choose a topic for this round.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2 max-h-[200px] overflow-y-auto pr-2 custom-scrollbar">
              <Button
                variant={state.selectedCategory === "All" ? "default" : "outline"}
                onClick={() => setCategory("All")}
                className={`border-white/10 hover:bg-white/10 ${
                  state.selectedCategory === "All" ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""
                }`}
              >
                All Categories
              </Button>
              {state.categories.map((category) => (
                <Button
                  key={category}
                  variant={state.selectedCategory === category ? "default" : "outline"}
                  onClick={() => setCategory(category)}
                  className={`border-white/10 hover:bg-white/10 ${
                    state.selectedCategory === category
                      ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
                      : ""
                  }`}
                >
                  {category}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-white/5 backdrop-blur-md">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Zap className="w-4 h-4 text-primary" />
              Number of Rounds
            </CardTitle>
            <CardDescription>
              How many questions to play.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-4 gap-2">
              {[5, 10, 15, 20].map((rounds) => (
                <Button
                  key={rounds}
                  variant={state.numRounds === rounds ? "default" : "outline"}
                  onClick={() => setNumRounds(rounds)}
                  className={`border-white/10 hover:bg-white/10 ${state.numRounds === rounds ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''}`}
                >
                  {rounds}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Button 
            className="w-full h-16 text-xl font-bold tracking-wide rounded-2xl shadow-[0_0_40px_-10px_var(--color-primary)] hover:shadow-[0_0_60px_-10px_var(--color-primary)] transition-all"
            disabled={state.teams.length < 2}
            onClick={handleStart}
          >
            START GAME
          </Button>
          
          <div className="flex justify-center">
            <Button variant="link" className="text-muted-foreground text-xs" onClick={() => setLocation("/admin")}>
              <Settings className="w-3 h-3 mr-1" />
              Game Settings & Admin
            </Button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
