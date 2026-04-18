import { Switch, Route } from 'wouter';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { GameProvider } from '@/lib/store';
import { Toaster } from '@/components/ui/toaster';
import Home from '@/pages/Home';
import Game from '@/pages/Game';
import Admin from '@/pages/Admin';
import AdminDisputes from '@/pages/admin-disputes';
import AdminSettings from '@/pages/admin-settings';
import AdminStaging from '@/pages/admin-staging';
import AdminQuestions from '@/pages/admin-questions';
import AdminQualitySweep from '@/pages/admin-quality-sweep';
import NotFound from '@/pages/not-found';

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/game" component={Game} />
      <Route path="/admin" component={Admin} />
      <Route path="/admin/staging" component={AdminStaging} />
      <Route path="/admin/questions" component={AdminQuestions} />
      <Route path="/admin/disputes" component={AdminDisputes} />
      <Route path="/admin/settings" component={AdminSettings} />
      <Route path="/admin/quality-sweep" component={AdminQualitySweep} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <GameProvider>
        <div className="min-h-screen bg-background text-foreground font-sans selection:bg-primary selection:text-primary-foreground">
          <Router />
          <Toaster />
        </div>
      </GameProvider>
    </QueryClientProvider>
  );
}

export default App;
