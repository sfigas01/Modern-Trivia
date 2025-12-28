# Modern Trivia

Modern Trivia is a browser-based trivia party game for local multiplayer. Create teams, pick a regional bias for questions, and compete through a guided question/answer loop with automatic scoring.

## Project Origins

This project was created using ChatGPT, Replit, and Codex. The original prototype was designed by ChatGPT and built in Replit using the App Connector, and this README was created using Codex.

## Features

- Local multiplayer team setup (2–6 teams).
- Regional question bias (Global Mix, US, CA).
- Automatic answer verification and scoring flow.
- Admin panel for adding custom questions stored in local storage.
- Built-in game state machine (see `docs/STATE_MACHINE.md`).

## Tech Stack

- React + Vite (client)
- Express + WebSocket (server)
- Drizzle ORM + PostgreSQL (optional data layer)
- Tailwind CSS + Radix UI

## Getting Started

### Prerequisites

- Node.js 20+
- npm

### Install

```bash
npm install
```

### Development

Run the Express API and Vite client together:

```bash
npm run dev
```

If you want only the Vite client (for UI work):

```bash
npm run dev:client
```

The app serves on `http://localhost:5000` by default.

### Production build

```bash
npm run build
npm start
```

## Project Structure

- `client/` — React UI
- `server/` — Express API + server setup
- `shared/` — Shared types/utilities
- `docs/STATE_MACHINE.md` — Game state flow documentation

## Notes

- Custom questions added in the Admin panel are saved in local storage for the current browser.
- Region bias affects which questions are chosen during play.

## License

MIT
