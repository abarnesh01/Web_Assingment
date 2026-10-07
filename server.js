require('dotenv').config();
const http = require('node:http');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: process.env.CLIENT_ORIGIN || '*' } });
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || 'development-only-change-me';
app.use(cors());
app.use(express.json({ limit: '32kb' }));
app.use(express.static('public'));

const publicUser = (row) => ({ id: row.id, username: row.username });
const messageQuery = `SELECT m.id, m.room_id AS roomId, m.user_id AS userId, u.username,
  m.body, m.created_at AS createdAt, m.updated_at AS updatedAt, m.edited
  FROM messages m JOIN users u ON u.id=m.user_id`;
function tokenFor(user) { return jwt.sign({ sub: user.id, username: user.username }, JWT_SECRET, { expiresIn: '12h' }); }
function auth(req, res, next) {
  const value = req.headers.authorization || '';
  try {
    if (!value.startsWith('Bearer ')) throw new Error('Missing bearer token');
    req.user = jwt.verify(value.slice(7), JWT_SECRET);
    next();
  } catch { res.status(401).json({ error: 'Authentication required. Please sign in again.' }); }
}
function validateBody(body) {
  return typeof body === 'string' && body.trim().length > 0 && body.trim().length <= 2000;
}
function safe(handler) { return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next); }

app.get('/api/health', (_req, res) => res.json({ status: 'ok', database: db.open ? 'connected' : 'disconnected', realtime: 'socket.io' }));
app.post('/api/auth/register', safe((req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) return res.status(400).json({ error: 'Username must be 3–24 letters, numbers or underscores.' });
  if (password.length < 8 || password.length > 72) return res.status(400).json({ error: 'Password must be 8–72 characters.' });
  if (db.prepare('SELECT id FROM users WHERE username=?').get(username)) return res.status(409).json({ error: 'That username is already taken.' });
  const result = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, bcrypt.hashSync(password, 10));
  const user = publicUser(db.prepare('SELECT id, username FROM users WHERE id=?').get(result.lastInsertRowid));
  res.status(201).json({ token: tokenFor(user), user });
}));
app.post('/api/auth/login', safe((req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const row = db.prepare('SELECT * FROM users WHERE username=?').get(username);
  if (!row || !bcrypt.compareSync(password, row.password_hash)) return res.status(401).json({ error: 'Incorrect username or password.' });
  const user = publicUser(row);
  res.json({ token: tokenFor(user), user });
}));
app.get('/api/auth/me', auth, (req, res) => res.json({ user: { id: Number(req.user.sub), username: req.user.username } }));

app.get('/api/rooms', auth, (_req, res) => {
  const rooms = db.prepare(`SELECT r.id,r.name,r.description,COUNT(m.id) AS messageCount,
    (SELECT body FROM messages WHERE room_id=r.id ORDER BY id DESC LIMIT 1) AS lastMessage
    FROM rooms r LEFT JOIN messages m ON m.room_id=r.id GROUP BY r.id ORDER BY r.id`).all();
  res.json({ rooms });
});
app.post('/api/rooms', auth, (req, res) => {
  const name = String(req.body.name || '').trim();
  const description = String(req.body.description || '').trim().slice(0, 160);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,31}$/.test(name)) return res.status(400).json({ error: 'Room name must be 2–32 letters, numbers, underscores or hyphens.' });
  try {
    const result = db.prepare('INSERT INTO rooms (name,description) VALUES (?,?)').run(name, description);
    const room = db.prepare('SELECT id,name,description FROM rooms WHERE id=?').get(result.lastInsertRowid);
    io.emit('room:created', room);
    res.status(201).json({ room });
  } catch (e) { if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'A room with that name already exists.' }); throw e; }
});
app.get('/api/rooms/:id/messages', auth, (req, res) => {
  const roomId = Number(req.params.id);
  if (!Number.isInteger(roomId) || roomId < 1) return res.status(400).json({ error: 'Invalid room id.' });
  if (!db.prepare('SELECT id FROM rooms WHERE id=?').get(roomId)) return res.status(404).json({ error: 'Room not found.' });
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const messages = db.prepare(`${messageQuery} WHERE m.room_id=? ORDER BY m.id DESC LIMIT ?`).all(roomId, limit).reverse();
  res.json({ messages });
});
function createMessage(roomId, userId, body) {
  const result = db.prepare('INSERT INTO messages (room_id,user_id,body) VALUES (?,?,?)').run(roomId, userId, body.trim());
  return db.prepare(`${messageQuery} WHERE m.id=?`).get(result.lastInsertRowid);
}
app.post('/api/rooms/:id/messages', auth, (req, res) => {
  const roomId = Number(req.params.id);
  if (!Number.isInteger(roomId) || !db.prepare('SELECT id FROM rooms WHERE id=?').get(roomId)) return res.status(404).json({ error: 'Room not found.' });
  if (!validateBody(req.body.body)) return res.status(400).json({ error: 'Message must contain 1–2000 characters.' });
  const message = createMessage(roomId, Number(req.user.sub), req.body.body);
  io.to(`room:${roomId}`).emit('message:new', message);
  res.status(201).json({ message });
});
app.put('/api/messages/:id', auth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid message id.' });
  if (!validateBody(req.body.body)) return res.status(400).json({ error: 'Message must contain 1–2000 characters.' });
  const old = db.prepare(`${messageQuery} WHERE m.id=?`).get(id);
  if (!old) return res.status(404).json({ error: 'Message not found.' });
  if (old.userId !== Number(req.user.sub)) return res.status(403).json({ error: 'You can edit only your own messages.' });
  db.prepare('UPDATE messages SET body=?,updated_at=CURRENT_TIMESTAMP,edited=1 WHERE id=?').run(req.body.body.trim(), id);
  const message = db.prepare(`${messageQuery} WHERE m.id=?`).get(id);
  io.to(`room:${message.roomId}`).emit('message:updated', message);
  res.json({ message });
});
app.delete('/api/messages/:id', auth, (req, res) => {
  const id = Number(req.params.id);
  const message = db.prepare(`${messageQuery} WHERE m.id=?`).get(id);
  if (!message) return res.status(404).json({ error: 'Message not found.' });
  if (message.userId !== Number(req.user.sub)) return res.status(403).json({ error: 'You can delete only your own messages.' });
  db.prepare('DELETE FROM messages WHERE id=?').run(id);
  io.to(`room:${message.roomId}`).emit('message:deleted', { id, roomId: message.roomId });
  res.json({ success: true, id });
});

io.use((socket, next) => {
  try { socket.user = jwt.verify(socket.handshake.auth?.token || '', JWT_SECRET); next(); }
  catch { next(new Error('Authentication required')); }
});
io.on('connection', (socket) => {
  socket.on('room:join', (roomId, ack = () => {}) => {
    const id = Number(roomId);
    if (!Number.isInteger(id) || !db.prepare('SELECT id FROM rooms WHERE id=?').get(id)) return ack({ error: 'Room not found.' });
    for (const room of socket.rooms) if (room.startsWith('room:')) socket.leave(room);
    socket.join(`room:${id}`);
    ack({ ok: true, roomId: id, username: socket.user.username });
  });
  socket.on('presence:typing', (roomId) => {
    const id = Number(roomId);
    if (socket.rooms.has(`room:${id}`)) socket.to(`room:${id}`).emit('presence:typing', { username: socket.user.username });
  });
});
app.use((req, res) => res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` }));
app.use((err, _req, res, _next) => {
  console.error(err);
  if (err instanceof SyntaxError && 'body' in err) return res.status(400).json({ error: 'Malformed JSON request body.' });
  res.status(500).json({ error: 'Unexpected server error.' });
});
server.listen(PORT, '0.0.0.0', () => console.log(`Relay listening on http://0.0.0.0:${PORT}`));
