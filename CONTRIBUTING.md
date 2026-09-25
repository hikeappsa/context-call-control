# Contributing

## Development

```bash
npm install
npm test
npm run build
```

`npm test` compiles TypeScript and runs `node --test` against the in-memory call store and fake adapters. You do not need Postgres or LiveKit for tests.

To exercise the HTTP service, copy `.env.example` to `.env` and start the local stack:

```bash
docker compose up --build
```

## Adding an adapter

Keep product rules out of `src/calls`. Implement the port and register it in `app.module.ts`.

- **Identity.** Replace `DevJwtGuard` with a guard that sets `request.user` to `{ userId, displayName }`.
- **Authorization.** Implement `ContextAuthorizer`. `resolve` must return both parties. `stillAllowed` must become false when the context should no longer support a call.
- **Push.** Implement `PushNotifier`. Read active `device_endpoints` for the callee. Return the number of successful sends. Do not mark the call answered from a push acknowledgement.
- **Media.** Implement `MediaSession` and `MediaWebhookVerifier`. Preserve token timing: no token before accept, short TTL, microphone-only publish if the media server supports source limits.

## Pull requests

- Add or update a test when you change a call transition.
- Do not commit `.env` files or real credentials.
- Keep the example adapters free of a specific product schema. `contextType` and `contextId` stay opaque strings.
