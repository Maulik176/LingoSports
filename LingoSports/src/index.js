import AgentAPI from 'apminsight';
AgentAPI.config();

import express from 'express';
import http from 'http';
import { matchRouter } from './routes/matches.js';
import { commentaryRouter } from './routes/commentary.js';
import { attachWebSocketServer } from './ws/server.js';
import { securityMiddleware } from './arcjet.js';

const PORT = Number(process.env.PORT) || 8000;
const HOST = process.env.HOST || '0.0.0.0';
const app = express();
const server = http.createServer(app);

app.set('trust proxy', true);
app.use(express.json()); //middleware

app.get('/', (req, res) => {
  res.send('Hello from Express server!');
});

app.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.use(securityMiddleware());

app.use('/matches', matchRouter);
app.use('/matches/:id/commentary', commentaryRouter);

const { broadCastMatchCreated , broadCastCommentary } = attachWebSocketServer(server);
app.locals.broadCastMatchCreated = broadCastMatchCreated;
app.locals.broadCastCommentary = broadCastCommentary

server.listen(PORT, HOST, () => {
  const baseUrl = HOST === '0.0.0.0' ? `http://localhost:${PORT}` : `http://${HOST}:${PORT}`;
  console.log(`Server is running on ${baseUrl}`);
  console.log(`WebSocket Server is running on ${baseUrl.replace('http', 'ws')}/ws`);
});
