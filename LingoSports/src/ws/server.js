import { WebSocket, WebSocketServer } from 'ws';
import { wsArcject } from '../arcjet.js';

function sendJson(socket, payload) {
  if (socket.readyState !== WebSocket.OPEN) return;

  socket.send(JSON.stringify(payload));
}

function broadCast(wss, payload) {
  for (const client of wss.clients) {
    if (!client) continue;
    sendJson(client, payload);
  }
}

export function attachWebSocketServer(server) {
  const wss = new WebSocketServer({
    server,
    path: '/ws',
    maxPayload: 1024 * 1024,
  });

  wss.on('connection', async(socket,req) => {
    if(wsArcject){
        try {
            const decision = await wsArcject.protect(req);
            if (decision.isDenied()) {
                const code = decision.reason.isRateLimit() ? 1013 : 1008;
                const reason = decision.reason.isRateLimit() ? "Rate Limit Exceeded" : "Access Denied";
                socket.close(code,reason);
                return;
              }  
        } catch (error) {
            console.error("ws connection error", error);
            socket.close(1011,"Server Security Error");
        }
    }
    sendJson(socket, { type: 'welcome' });
    socket.on('error', console.error);
  });

  function broadCastMatchCreated(match) {
    broadCast(wss, { type: 'match_created', data: match });
  }

  return { broadCastMatchCreated };
}
