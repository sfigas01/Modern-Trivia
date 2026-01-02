# Modern Trivia

Modern Trivia is a browser-based multiplayer trivia party game designed for local teams (2-6 teams) playing together. It features automatic answer verification with fuzzy matching, a comprehensive scoring system, and 600+ built-in trivia questions with Canadian-focused content and global general knowledge.

## Project Origins

This project was created using ChatGPT, Replit, and Codex. The original prototype was designed by ChatGPT and built in Replit using the App Connector, and this README was created using Codex.

## Features

### Game Features
- **Team-Based Gameplay**: 2-6 teams with custom names
- **600+ Trivia Questions**: Organized by category, difficulty, and regional focus
- **Category Selection**: Filter by Geography, Science, History, Music, and more, or select "All"
- **Intelligent Answer Verification**: Fuzzy matching with 80% similarity threshold
  - Handles punctuation, articles, number words, and case-insensitivity
- **Difficulty-Based Scoring**:
  - Easy questions: ±1 point
  - Medium questions: ±2 points
  - Hard questions: ±3 points
- **Round System**: Teams rotate after every 4 questions, with round score displays
- **State Machine Architecture**: Ensures consistent game flow (see `docs/STATE_MACHINE.md`)

### Authentication & Admin Features
- **Replit Authentication**: Secure OpenID Connect-based login
- **Dispute System**: Challenge question answers with explanations (requires authentication)
- **Admin Panel**:
  - Add, edit, and delete custom questions (stored in local storage)
  - View and manage dispute logs (requires admin role)
  - Grant/revoke admin roles
- **Role-Based Access Control**: Admin-only features protected by database roles

### User Experience
- **Responsive Design**: Mobile-friendly interface with Tailwind CSS
- **Smooth Animations**: Framer Motion transitions throughout
- **Modern UI**: Radix UI components with accessible, polished design
- **Custom Questions**: Add your own questions via the admin panel

## Tech Stack

### Frontend
- **React 19** with TypeScript
- **Vite** for fast development and optimized builds
- **Tailwind CSS v4** for styling
- **Radix UI** component library
- **Framer Motion** for animations
- **React Query** (@tanstack/react-query) for server state management
- **Wouter** for lightweight routing
- **React Hook Form** + **Zod** for form validation

### Backend
- **Node.js 20** with TypeScript
- **Express.js** web framework
- **Drizzle ORM** for type-safe database queries
- **PostgreSQL 16** database
- **Replit Auth** (OpenID Connect) for authentication
- **Express Session** with PostgreSQL session store

### Libraries & Utilities
- **string-similarity** for fuzzy answer matching
- **canvas-confetti** for celebration effects
- **Lucide React** for icons

## Getting Started

### Prerequisites

- **Node.js 20+**
- **PostgreSQL database** (provided automatically on Replit)
- **npm** or **yarn**

### Environment Variables

Create a `.env` file or set the following environment variables:

```bash
DATABASE_URL=postgresql://user:password@host:port/database
SESSION_SECRET=your-session-secret-here
PORT=5000
ISSUER_URL=https://replit.com/oidc  # Optional, defaults to Replit OIDC
REPL_ID=your-repl-id  # Auto-set on Replit
```

### Install

```bash
npm install
```

### Database Setup

Push the database schema to your PostgreSQL instance:

```bash
npm run db:push
```

This creates the required tables:
- `sessions` - Session storage
- `users` - User accounts
- `disputes` - Question dispute logs
- `admin_roles` - Admin access control

### Development

Run the Express API and Vite client together:

```bash
npm run dev
```

The app serves on `http://localhost:5000` by default.

For client-only development (UI work):

```bash
npm run dev:client
```

### Production Build

```bash
npm run build
npm start
```

The build process:
1. Compiles the React app with Vite → `dist/public/`
2. Bundles the Express server with esbuild → `dist/index.cjs`
3. Optimizes and minifies for production

## Project Structure

```
Modern-Trivia/
├── client/              # React frontend application
│   └── src/
│       ├── components/  # UI components (including shadcn/ui library)
│       ├── hooks/       # Custom React hooks (auth, admin, disputes)
│       ├── lib/         # Utilities, store, questions.json (600+ questions)
│       └── pages/       # Route pages (Home, Game, Admin)
├── server/              # Express backend
│   ├── index.ts         # Main server setup
│   ├── routes.ts        # API routes (disputes, admin)
│   └── replit_integrations/
│       └── auth/        # Replit Auth integration
├── shared/              # Shared code between client & server
│   ├── schema.ts        # Drizzle ORM database schema
│   └── models/          # User and session models
├── docs/
│   ├── STATE_MACHINE.md # Game state flow documentation
│   └── ADMIN_SETUP.md   # Admin role setup instructions
└── script/
    └── build.ts         # Production build script
```

## Game Flow

The game follows a state machine pattern with these states:

1. **SETUP** → Add teams and configure game settings
2. **QUESTION** → Display question and accept team answer
3. **VERIFYING** → Normalize and compare answer (transient)
4. **REVEAL** → Show result and correct answer
5. **SCORE_UPDATE** → Apply points and rotate teams (transient)
6. **ROUND_SCORE** → Display scores after each complete round
7. **GAME_OVER** → Final scoreboard and winner announcement

See `docs/STATE_MACHINE.md` for detailed state transitions.

## Admin Setup

To grant admin access to users:

1. Ensure the user has logged in at least once (creates user record)
2. See `docs/ADMIN_SETUP.md` for instructions on granting admin roles
3. Admin users can:
   - View and clear dispute logs
   - Add/edit/delete custom questions
   - Grant/revoke admin roles for other users

## API Endpoints

### Authentication
- `POST /api/login` - Start Replit Auth flow
- `GET /api/logout` - Logout current user
- `GET /api/auth/user` - Get current authenticated user

### Disputes
- `POST /api/disputes` - Submit question dispute (requires authentication)
- `GET /api/disputes` - View all disputes (requires admin)
- `DELETE /api/disputes` - Clear all disputes (requires admin)

### Admin
- `POST /api/admin/grant` - Grant admin role (requires admin)
- `DELETE /api/admin/revoke/:userId` - Revoke admin role (requires admin)
- `GET /api/admin/check` - Check if current user is admin

## Questions Database

The game includes 600+ built-in trivia questions organized by:

- **Categories**: Geography, Science, History, Music, Sports, Pop Culture, and more
- **Difficulty Levels**: Easy, Medium, Hard
- **Regional Tags**: Canada (CA), United States (US), Global
- **Content Pillars**:
  - **TimeCapsule**: Historical events and cultural moments
  - **GlobalEh**: International knowledge with Canadian perspective
  - **FreshPrints**: Recent events and modern culture
  - **GreatOutdoors**: Nature, geography, and wildlife

Questions are stored in `client/src/lib/questions.json` and can be supplemented with custom questions via the admin panel (stored in browser local storage).

## Deployment

This application is designed to run on Replit with autoscale deployment:

1. **Build Command**: `npm run build`
2. **Run Command**: `node ./dist/index.cjs`
3. **Required Modules**: nodejs-20, web, postgresql-16
4. **Port**: 5000 (mapped to external port 80)

The Replit configuration is defined in `.replit`.

## Notes

- Custom questions added in the Admin panel are saved in browser local storage
- The dispute system requires user authentication via Replit Auth
- Admin roles are managed in the PostgreSQL database
- Answer verification uses fuzzy matching with an 80% similarity threshold to handle minor typos and formatting differences
- The session store uses PostgreSQL for persistence (falls back to in-memory if `DATABASE_URL` is not set)

## License

MIT
