# Security

The control plane exists so clients never invent rooms, peer ids, or long-lived media credentials.

## Rules

- Authenticate every call and device route. The media webhook is authenticated by signature, not by a user token.
- Authorize every start and every accept through `ContextAuthorizer`. A valid user token is not permission to call an arbitrary person.
- Issue a media token only after the callee has accepted. Do not return a token from start.
- Keep token lifetime between 10 and 120 seconds. Refresh only from the authenticated active-call route, and only for a participant of that call.
- Bind the media identity to the authenticated user id. Do not accept a client-supplied identity.
- Grant publish access for microphone audio only.
- Treat the signed webhook as a hint about who joined. Do not let a join on a still-ringing call count as an answer.
- Enforce one live call per participant inside the same transaction that inserts the session.
- Require `Idempotency-Key` on start so retries do not open a second call.
- If invite delivery fails or reaches zero devices, mark the session `failed` before returning an error.
- Re-check `stillAllowed` on accept and on the reaper. When a context ends, close the room and notify both participants.
- Room deletion is best-effort. A media-server error must not move a terminal call back to a live status.
- Store push tokens as secrets. The example notifier logs that an invite happened. Do not log raw push tokens in your adapter.
- Leave `DEV_CONTEXTS_ENABLED` unset in any shared environment. The seed route can attach any two participant ids.
- The dev JWT is an HMAC signed with `DEV_JWT_SECRET`. Replace the guard before exposing the service.

## Webhook

The verifier needs the raw request body. A JSON parser that re-serializes the body will break signature checks. This service enables the raw body on the webhook route only.

## What this service does not do

It does not place audio, choose a TURN layout, or store recordings. Put those concerns in the media server and in your own retention policy. `CALL_RETENTION_DAYS` deletes terminal call rows from this database only.
