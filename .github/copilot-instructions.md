# Project Guidelines

## Architecture

- `server.js` is the Express entry point and route layer. Keep HTTP behavior centralized there and keep scraping/parsing helpers in `src/lib/`.
- Put input sanitization and response shaping in `src/lib/normalizers.js`. Put remote fetching, URL building, and HTML parsing in `src/lib/xvideos-client.js`.
- The UI in `public/` is plain HTML, CSS, and browser-native JavaScript modules. Prefer extending the existing files over introducing a frontend framework or build step.

## Code Style

- Match the module system already used in each area: CommonJS on the backend, ESM in `public/`.
- Prefer small helper functions, defensive guards, and minimal changes that preserve the current structure.
- Keep user-facing text and error messages in Portuguese unless the surrounding file clearly uses another language.
- Escape dynamic HTML in the frontend and reuse shared helpers from `public/common.js` when possible.

## Conventions

- Validate user-controlled filters with explicit allowlists and clamp page numbers to the existing 1..250 range.
- Treat external URLs as untrusted. Reuse the existing safe URL checks and URL-building helpers instead of concatenating strings manually.
- Preserve accessibility behavior: semantic markup, keyboard navigation, visible focus states, and `aria-live` status updates.
- Reuse storage and navigation helpers from `public/common.js`, including the existing `bx_` localStorage key prefix.
- When changing normalization, parsing, or URL-building logic, add or update `node:test` coverage in `tests/`.

## Build and Test

- Install dependencies with `npm install`.
- Start the local server with `npm start`.
- Use `npm run dev` for watch mode during development.
- Run tests with `npm test`.
- The app serves locally on port 3000 by default. If that port is already in use, reuse the running server or set `PORT` before starting another instance.