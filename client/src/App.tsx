import { Switch, Route } from "wouter";
import { GameProvider } from "@/lib/store";
import { Toaster } from "@/components/ui/toaster";
import Home from "@/pages/Home";
import Game from "@/pages/Game";
import Admin from "@/pages/Admin";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/game" component={Game} />
      <Route path="/admin" component={Admin} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <GameProvider>
      <div className="min-h-screen bg-background text-foreground font-sans selection:bg-primary selection:text-primary-foreground">
        <Router />
        <Toaster />
      </div>
    </GameProvider>
  );
}

export default App;
