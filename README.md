# Context Call Control

A reference control plane for **one-to-one audio calls that are allowed only inside an application-defined context**.

The media server carries audio. This service decides whether two people may call, how long an invite rings, when a media token may be issued, and when the call must end. Swap the example adapters for your own identity provider, authorization rules, and push vendor.

## Model

1. A caller asks to start a call with `contextType` and `contextId`.
2. `ContextAuthorizer` resolves the two participants. If the caller is not one of them, or the context is inactive, the call is refused.
3. The service stores a `ringing` session and asks `PushNotifier` to invite the other participant.
4. **No media token is issued yet.** A ringing call is not a room session.
5. The callee accepts. The authorizer is checked again, then the callee receives a short-lived media token.
6. The caller refreshes `GET /v1/calls/active` and receives a token only after the call has been answered.
7. A signed media webhook moves the call through `connecting` and `active`.
8. A reaper ends the call when the ring expires or the context is no longer allowed, closes the room, and notifies both participants.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the ports and [SECURITY.md](SECURITY.md) for the rules this service is responsible for.

## API

All routes except the media webhook and health checks require `Authorization: Bearer <jwt>`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v1/calls/availability?contextType&contextId` | Whether the caller may start a call |
| `POST` | `/v1/calls` | Start a call. Requires `Idempotency-Key` |
| `GET` | `/v1/calls/active` | The caller's live call, with a token only after answer |
| `POST` | `/v1/calls/:callId/accept` | Callee accepts and receives a token |
| `POST` | `/v1/calls/:callId/decline` | Callee declines |
| `POST` | `/v1/calls/:callId/cancel` | Caller cancels while ringing |
| `POST` | `/v1/calls/:callId/end` | Either participant ends the call |
| `POST` | `/v1/devices/call-endpoint` | Register a push endpoint |
| `POST` | `/v1/devices/call-endpoint/deactivate` | Remove an endpoint |
| `POST` | `/v1/webhooks/media` | Signed media-server events |
| `GET` | `/v1/health/live` and `/v1/health/ready` | Process and database checks |

When `DEV_CONTEXTS_ENABLED=true`, `POST /v1/dev/contexts` inserts an example context. Leave that flag off outside local development.

## Local stack

Requirements: Docker, Node.js 20+.

```bash
cp .env.example .env
docker compose up --build
```

The API listens on `http://localhost:8080`. Postgres is on `localhost:5432`. The example LiveKit server is on `ws://localhost:7880` with API key `devkey` and secret `secret`.

Mint a development token (the `sub` value is the participant id):

```bash
npm install
npm run dev-token -- --sub alice --name Alice
```

Seed a context, register a callee device, then start a call:

```bash
curl -s -X POST http://localhost:8080/v1/dev/contexts \
  -H 'content-type: application/json' \
  -d '{"contextType":"session","contextId":"demo-1","participantA":"alice","participantB":"bob","nameA":"Alice","nameB":"Bob"}'
```

Run the service on the host instead of in Docker with `npm run start:dev` after Postgres and LiveKit are up. Point `DATABASE_URL` at `localhost`.

## Tests

```bash
npm test
```

Tests use in-memory fakes for the authorizer, push notifier, media session, and call store. They do not start LiveKit or Postgres.

## Replacing the examples

| Port | Example in this repo | Replace with |
| --- | --- | --- |
| Identity | HMAC dev JWT (`DEV_JWT_SECRET`) | Your token verifier |
| `ContextAuthorizer` | `call_contexts` rows | Your rule for who may call inside a context |
| `PushNotifier` | Logs the invite | APNs, FCM, or another push vendor |
| `MediaSession` | LiveKit access tokens and room delete | Another media server with the same token timing |
| `MediaWebhookVerifier` | LiveKit webhook JWT | Your media server's signature check |

`client_kind` and `push_provider` on device endpoints are opaque strings. This service does not interpret them.

## License

[MIT](LICENSE)
