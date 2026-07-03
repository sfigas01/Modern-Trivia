import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

export default function HostGame() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4">
      <Card className="w-full max-w-md border-white/10 bg-white/5 backdrop-blur-md">
        <CardHeader>
          <CardTitle>Host a Game</CardTitle>
          <CardDescription>Multiplayer hosting is coming soon.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">This screen is a placeholder for STE-207.</p>
        </CardContent>
      </Card>
    </div>
  );
}
