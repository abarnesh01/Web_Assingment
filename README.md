# Relay — Realtime Team Chat

Relay is a full-stack educational team chat demonstrating REST APIs for persistent CRUD and Socket.IO for realtime collaboration. The browser exchanges JSON with an Express server; users authenticate with signed JWTs; SQLite stores accounts, rooms and messages.

## Run locally

Requirements: Node.js 20 or newer.

```bash
npm install
cp .env.example .env
# Change JWT_SECRET in .env before using outside a local demo
npm start
```

Open `http://localhost:3000`, create an account (username: 3–24 alphanumeric/underscore characters; password: 8–72 characters), then sign in from a second browser tab to see realtime updates. SQLite creates `relay.sqlite` and seeds general, announcements and engineering rooms automatically.

## Architecture

The single-page client (`public/`) calls the Express JSON API and opens an authenticated Socket.IO connection. `server.js` verifies bearer JWTs before serving protected resources and before websocket connection. `db.js` initializes the normalized SQLite schema and indexes messages by room. A write to a message endpoint commits the database operation first; then Socket.IO broadcasts the committed message only to `room:<id>`. Thus persistent state remains the source of truth, while WebSockets provide low-latency updates.

## REST API

All protected endpoints require `Authorization: Bearer <token>`. Request and response payloads are JSON.

| Method | Endpoint | Purpose | Success |
|---|---|---|---|
| GET | `/api/health` | Service/database status | 200 |
| POST | `/api/auth/register` | Create account and issue token | 201 |
| POST | `/api/auth/login` | Verify credentials and issue token | 200 |
| GET | `/api/auth/me` | Current authenticated user | 200 |
| GET | `/api/rooms` | List rooms and latest activity | 200 |
| POST | `/api/rooms` | Create a room | 201 |
| GET | `/api/rooms/:id/messages?limit=50` | Read persisted room history | 200 |
| POST | `/api/rooms/:id/messages` | Create/persist and broadcast a message | 201 |
| PUT | `/api/messages/:id` | Edit own message | 200 |
| DELETE | `/api/messages/:id` | Delete own message | 200 |

Common errors use JSON `{ "error": "..." }`: 400 invalid input/JSON, 401 missing or expired authentication, 403 ownership violation, 404 missing route/entity, 409 duplicate account/room, and 500 unexpected server failure.

## Realtime events

| Direction | Event | Payload / result |
|---|---|---|
| Client → server | `room:join` | Room id; acknowledged with `{ok:true}` or error |
| Client → server | `presence:typing` | Room id; sent to other room members |
| Server → clients | `message:new` | Newly committed message JSON |
| Server → clients | `message:updated` | Updated committed message JSON |
| Server → clients | `message:deleted` | `{id, roomId}` |
| Server → clients | `room:created` | New room JSON |

## Data model

`users(id, username, password_hash, created_at)`, `rooms(id, name, description, created_at)`, and `messages(id, room_id, user_id, body, created_at, updated_at, edited)`. Foreign keys cascade when parent rows are deleted; a room/time index supports history reads. Passwords use bcrypt; SQL is parameterized; message and identifier ownership checks are server-side.

## Security and limitations

This is a teaching/demo implementation. The default JWT secret is explicitly development-only; use a long random `JWT_SECRET` from an environment secret store. Tokens are kept in localStorage for convenience; production should use secure, HttpOnly, SameSite cookies or a carefully designed refresh-token flow, enforce HTTPS, add rate limiting and audit logging, constrain CORS, and plan backups/migrations. The seeded demo rooms are workspace-wide, not private channels.

See [`docs/assignment.md`](docs/assignment.md) for the rubric-oriented report and [`plan.md`](plan.md) for design decisions.
