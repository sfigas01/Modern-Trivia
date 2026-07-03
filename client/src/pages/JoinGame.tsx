import { useParams } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

export default function JoinGame() {
  const { code } = useParams<{ code?: string }>();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4">
      <Card className="w-full max-w-md border-white/10 bg-white/5 backdrop-blur-md">
        <CardHeader>
          <CardTitle>Join a Game</CardTitle>
          <CardDescription>Multiplayer joining is coming soon.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            {code
              ? `This screen is a placeholder for STE-208 (room code: ${code}).`
              : 'This screen is a placeholder for STE-208.'}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
