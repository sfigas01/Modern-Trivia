# Modern Trivia

## Overview

Modern Trivia is a browser-based multiplayer trivia party game designed for local play. Teams compete through a guided question/answer loop with automatic scoring and answer verification. The game features Canadian-focused content with global general knowledge, avoiding US-centric defaults. It supports 2-6 teams with configurable rounds and category selection.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite for development and production builds
- **Routing**: Wouter for lightweight client-side routing
- **State Management**: React Context API with custom `GameProvider` for game state
- **Data Fetching**: TanStack React Query for server state management
- **Styling**: Tailwind CSS v4 with custom theme variables, Radix UI primitives
- **UI Components**: shadcn/ui component library (New York style)
- **Animations**: Framer Motion for transitions and effects

### Backend Architecture
- **Runtime**: Node.js with Express.js
- **Language**: TypeScript with ES modules
- **API Style**: RESTful JSON endpoints under `/api/*`
- **Authentication**: Replit Auth integration with OpenID Connect
- **Session Management**: Express sessions with PostgreSQL store (`connect-pg-simple`)

### Game State Machine
The game follows a linear state machine pattern documented in `docs/STATE_MACHINE.md`:
- **SETUP** → **QUESTION** → **VERIFYING** → **REVEAL** → **SCORE_UPDATE** → (loop or **GAME_OVER**)
- Answer verification uses string similarity matching with normalization rules
- Transient states (VERIFYING, SCORE_UPDATE) handle automatic transitions

### Data Storage
- **ORM**: Drizzle ORM with PostgreSQL dialect
- **Schema Location**: `shared/schema.ts` with auth models in `shared/models/auth.ts`
- **Tables**: `sessions` (auth), `users` (auth), `disputes` (QA logging), `admin_roles`
- **Questions**: Stored in static JSON file (`client/src/lib/questions.json`) with optional local storage for custom questions

### Project Structure
```
client/          # React frontend application
  src/
    components/  # UI components including shadcn/ui
    hooks/       # Custom React hooks (auth, admin, disputes)
    lib/         # Utilities, store, questions data
    pages/       # Route components (Home, Game, Admin)
server/          # Express backend
  replit_integrations/auth/  # Authentication module
shared/          # Shared types and database schema
docs/            # Documentation (state machine)
```

## External Dependencies

### Database
- **PostgreSQL**: Required for session storage, user data, disputes, and admin roles
- **Connection**: Via `DATABASE_URL` environment variable
- **Migrations**: Managed with `drizzle-kit push`

### Authentication
- **Replit Auth**: OpenID Connect integration for user authentication
- **Session Secret**: Requires `SESSION_SECRET` environment variable
- **Issuer URL**: Defaults to `https://replit.com/oidc`

### Third-Party Libraries
- **string-similarity**: Fuzzy answer matching for verification
- **canvas-confetti**: Visual celebration effects
- **Passport.js**: Authentication middleware with OpenID Client strategy

### Development Tools
- **Vite Plugins**: Runtime error overlay, Cartographer (Replit-specific), meta images
- **esbuild**: Production server bundling with dependency allowlist optimization

## Dispute Resolution System

### Overview
The admin panel includes an AI-powered dispute resolution system for handling challenges to trivia answers.

### Features
- **Public Dispute Submission**: Users can flag incorrect answers during gameplay without authentication
- **Admin Dispute Review**: Authenticated admins view and resolve disputes in the Admin panel's "Answer Disputes" tab
- **AI Analysis**: GPT-4o powered analysis evaluates disputes with:
  - Verdict (CORRECT/INCORRECT/AMBIGUOUS)
  - Confidence percentage
  - Reasoning explanation
  - Suggested fix for incorrect answers
  - Reference sources
- **Resolution Workflow**: Accept, Reject, or Apply AI-suggested fixes
- **Status Filtering**: Filter disputes by Pending, Resolved, Rejected, or All

### Architecture
- Questions stored in local storage via `useGame` store
- Disputes stored in PostgreSQL `disputes` table
- AI analysis stored in `disputes.aiAnalysis` JSON column
- API Endpoints:
  - `POST /api/disputes` - Create dispute (public)
  - `GET /api/disputes` - List disputes (admin only)
  - `POST /api/disputes/:id/analyze` - Run AI analysis (admin only)
  - `PATCH /api/disputes/:id` - Update dispute status (admin only)
  - `DELETE /api/disputes` - Clear all disputes (admin only)