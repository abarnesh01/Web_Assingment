# Realtime Team Chat — Implementation Plan

## Product and architecture

Build a responsive team chat application with a Node.js/Express REST API, Socket.IO realtime transport and SQLite persistent storage. Clients authenticate with a signed bearer JWT; REST requests and websocket handshake share token authentication. Rooms, messages and users persist in SQLite. New messages are validated, inserted before broadcast, then emitted only to the selected room. A small single-page frontend consumes JSON APIs and joins room-scoped Socket.IO channels.

### Workflow
1. Register or log in; server hashes passwords and issues JWT.
2. Client fetches room list and room history via REST.
3. Client joins a room over Socket.IO; online status and validated new messages update live.
4. Message create uses REST (POST), then server persists and broadcasts; edits/deletes use REST and broadcast corresponding events.

### API surface
- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`
- `GET /api/rooms`, `POST /api/rooms`, `GET /api/rooms/:id/messages`
- `POST /api/rooms/:id/messages`, `PUT /api/messages/:id`, `DELETE /api/messages/:id`
- `GET /api/health`

Responses are JSON with appropriate status codes; validation, auth, not-found and server errors are handled consistently.

## Project structure
- `server.js` — Express setup, Socket.IO auth/events, REST routes and server startup.
- `db.js` — SQLite connection/schema, prepared queries and seed room.
- `public/index.html`, `public/styles.css`, `public/app.js` — responsive client and API/websocket handling.
- `docs/` — screenshot and generated assignment document.
- `README.md` — setup, API, design and demonstration notes.

## Design direction
- **Design movement:** editorial dark-mode workspace with restrained terminal-inspired details.
- **Core principles:** clear hierarchy, high signal-to-noise, tactile controls, calm realtime feedback.
- **Color philosophy:** ink/navy canvas for focus; electric mint indicates live/healthy state; warm amber distinguishes highlights.
- **Layout paradigm:** narrow navigation rail, room list, expansive conversation canvas and contextual composer.
- **Signature elements:** live presence indicator, compact message metadata, softly glowing send affordance.
- **Interaction:** immediate, reversible-feeling UI feedback; clear disabled/loading states; keyboard-friendly form controls.
- **Animation:** brief 140–200ms fades/slides on incoming messages and hover transitions; respect reduced-motion preference.
- **Typography:** system sans for interface, monospace for timestamps/technical labels; bold concise headings.
- **Brand essence:** “Relay” is a fast, approachable team channel for groups that need shared context; direct, dependable, lively.
- **Brand voice:** concise and human. Examples: “The room is live.” “Share an update with the team.”
- **Wordmark:** two linked chat brackets forming an R-like signal mark.
- **Signature color:** mint `#69E6BD`.

## Material constraints
Use a simple local SQLite database for reproducible setup; tokens are held in browser storage for this educational demo. Document this limitation and recommend HTTPS, secure cookies/refresh tokens and rate limiting before production. No secrets or credentials are committed.
