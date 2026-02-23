# Lingo Integration Notes

## New REST Query Params

- `GET /matches/:id/commentary?locale=es&quality=standard&includeSource=1`

## New Commentary POST Fields

- `sourceLocale?: "en" | "es" | "fr" | "de" | "hi" | "ar" | "ja" | "pt"`
- `quality?: "standard" | "fast"`

## WebSocket Subscription Contract

```json
{ "type": "subscribe", "matchId": 1, "locale": "es", "quality": "fast" }
```

Server ack:

```json
{ "type": "subscribed", "matchId": 1, "locale": "es", "quality": "fast" }
```

Commentary payload:

```json
{ "type": "commentary", "locale": "es", "quality": "standard", "data": { "id": 10, "message": "...", "translation": { "status": "precomputed" } } }
```

On-demand follow-up:

```json
{ "type": "commentary_translation_ready", "commentaryId": 10, "locale": "ja", "quality": "fast", "data": { "id": 10, "message": "..." } }
```
