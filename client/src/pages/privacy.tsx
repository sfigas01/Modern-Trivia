import { Link } from 'wouter';
import { Card, CardContent } from '@/components/ui/card';

// Linked from the Google OAuth consent screen. Keep it accurate when the data
// the app stores changes.
const LAST_UPDATED = 'September 29, 2026';
const CONTACT_EMAIL = 'PRIVACY_CONTACT_EMAIL_TBD';

export default function Privacy() {
  return (
    <div className="min-h-screen w-full bg-background px-4 py-10">
      <Card className="mx-auto w-full max-w-2xl">
        <CardContent className="space-y-5 pt-6 text-sm leading-relaxed text-muted-foreground">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Privacy policy</h1>
            <p className="mt-1 text-xs">Last updated {LAST_UPDATED}</p>
          </div>

          <p>
            You can play without an account. This page explains what we store if you sign in, and
            what we store about games.
          </p>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-foreground">
              When you sign in with Google
            </h2>
            <p>
              Google shares your email address, your name and your profile picture link with us. We
              use them to recognize you when you come back and to show who is signed in. We do not
              receive your Google password or access to anything else in your Google account.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-foreground">Game data</h2>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                Which questions a signed-in player has already seen, so you don&apos;t get repeats.
              </li>
              <li>Team and player names you type in, and room codes for multiplayer games.</li>
              <li>
                Answer disputes you submit, including the reason you give. Dispute text may be
                analyzed by OpenAI to help us review it.
              </li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-foreground">Cookies</h2>
            <p>
              We use one cookie to keep you signed in. There are no advertising or tracking cookies.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-foreground">Sharing</h2>
            <p>
              We don&apos;t sell your information or show ads. The app and its database run on
              Railway, and trivia questions are written and checked with OpenAI; those providers
              process data only to run the service.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-foreground">Your choices</h2>
            <p>
              To see or delete the information linked to your account, email{' '}
              <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>
                {CONTACT_EMAIL}
              </a>
              . You can also remove the app&apos;s access in your Google account settings.
            </p>
          </section>

          <Link href="/" className="inline-block text-foreground underline">
            Back to the game
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
