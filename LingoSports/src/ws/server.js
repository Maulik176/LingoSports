import { WebSocket, WebSocketServer } from 'ws';
import { wsArcject } from '../arcjet.js';


//Maulik - Broadcast Functionality
const matchSubscribers = new Map();

function firstHeaderValue(headerValue) {
  if (Array.isArray(headerValue)) return headerValue[0];
  return headerValue;
}

function getClientIp(req) {
  const xForwardedFor = firstHeaderValue(req.headers?.['x-forwarded-for']);
  const forwardedIp = typeof xForwardedFor === 'string'
    ? xForwardedFor.split(',')[0]?.trim()
    : undefined;

  return (
    forwardedIp ||
    firstHeaderValue(req.headers?.['x-real-ip']) ||
    firstHeaderValue(req.headers?.['cf-connecting-ip']) ||
    req.socket?.remoteAddress
  );
}

function buildArcjetRequest(req) {
  const ip = getClientIp(req);
  return ip ? { ...req, ip } : req;
}

//function for users to subscribe to a match
function subscribe(matchId, socket){
  if(!matchSubscribers.has(matchId)){
    matchSubscribers.set(matchId, new Set());
  }
  matchSubscribers.get(matchId).add(socket);
}

//function for users to unsubscribe from a match
function unsubscribe(matchId, socket){
  const subscribers = matchSubscribers.get(matchId);
  if(!subscribers) return;

  subscribers.delete(socket);

  if(subscribers.size === 0){
    matchSubscribers.delete(matchId);
  }
}

//when a user lets say closes the browser or disconnect from internet we unsubscribe them from all matches
function cleanUpSubscriptions(socket){
  for(const matchId of socket.subscriptions){
    unsubscribe(matchId, socket);
  }
}

//send data to only those poeple who are interested in the match
function broadcastToMatch(matchId, payload){
  const subscribers = matchSubscribers.get(matchId);
  if(!subscribers || subscribers.size == 0) return;

  const message = JSON.stringify(payload);
  for(const client of subscribers){
    if(client.readyState === WebSocket.OPEN){
      client.send(message);
    }
  }

}

function handleMessage(socket,data){
  let message;
  try {
    message = JSON.parse(data.toString());
  } catch {
    sendJson(socket, {type: 'error', message:'Invalid JSON'});
    return;
  }

  if(message?.type === "subscribe" && Number.isInteger(message.matchId)){
    subscribe(message.matchId,socket);
    socket.subscriptions.add(message.matchId);
    sendJson(socket, {type: 'subscribed', matchId:message.matchId});
    return;
  }

  if(message?.type === "unsubscribe" && Number.isInteger(message.matchId)){
    unsubscribe(message.matchId,socket);
    socket.subscriptions.delete(message.matchId);
    sendJson(socket, {type: 'unsubscribed', matchId:message.matchId});
    return;
  }
}

function sendJson(socket, payload) {
  if (socket.readyState !== WebSocket.OPEN) return;

  socket.send(JSON.stringify(payload));
}

function broadCastToAll(wss, payload) {
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

  wss.on('connection', async (socket, req) => {
    if (wsArcject) {
      try {
        const decision = await wsArcject.protect(buildArcjetRequest(req));
        if (decision.isDenied()) {
          const code = decision.reason.isRateLimit() ? 4001 : 4003;
          const reason = decision.reason.isRateLimit() ? 'Rate Limit Exceeded' : 'Access Denied';
          socket.close(code, reason);
          return;
        }
      } catch (error) {
        if (error?.message?.includes('requested `ip` characteristic but the `ip` value was empty')) {
          console.warn('Arcjet skipped websocket check due to missing client IP');
        } else {
        console.error('ws connection error', error);
        socket.close(1011, 'Server Security Error');
        return;
        }
      }
    }

    socket.subscriptions = new Set();

    sendJson(socket, { type: 'welcome' });

    socket.on('message', (data) => {
      handleMessage(socket,data);
    })

    socket.on('error', () => {
      socket.terminate();
    })

    socket.on('close', () => {
      cleanUpSubscriptions(socket);
    })

    socket.on('error', console.error);
  });

  function broadCastMatchCreated(match) {
    broadCastToAll(wss, { type: 'match_created', data: match });
  }

  function broadCastCommentary(matchId, comment){
    broadcastToMatch(matchId, {type: 'commentary', data: comment});
  }

  return { broadCastMatchCreated , broadCastCommentary};
}
