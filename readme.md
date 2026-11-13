# GoodSharing Posts Service

The Posts Service manages post creation and publishes PostCreated events to the Notification Service.

## Environment Variables

Configure the following variables using your local environment or Kubernetes Secrets.

| Variable | Purpose |
|---|---|
| DATABASE_URL | PostgreSQL connection string |
| JWT_SECRET | JWT verification secret |
| REDIS_HOST | Redis host |
| REDIS_PORT | Redis port |
| NOTIFICATION_SERVICE_URL | Internal Notification Service base URL |
| INTERNAL_EVENT_AUTH_TOKEN | Shared internal event authentication token |
| NOTIFICATION_EVENT_TIMEOUT_MS | Notification event request timeout in milliseconds |

Do not commit actual secrets or credentials. Use placeholders in `.env.example`.

## Notification Event Integration

Posts Service sends PostCreated events to the internal Notification Service endpoint:

`/internal/events/post-created`

The integration uses `NOTIFICATION_SERVICE_URL` and `INTERNAL_EVENT_AUTH_TOKEN`.

Do not log authentication tokens or sensitive user information.

## Database Cleanup — Module 5 PART C

The migration:

`migrations/001_drop_legacy_notification_tables.sql`

removes the following obsolete Posts Service tables:

- `public.notifications`
- `public.category_subscriptions`

These tables are no longer used by the Posts Service application.

**Data-loss warning:** Applying this migration permanently deletes all existing records in these two tables. Verify the database backup and obtain the required approval before execution.

The migration does not drop or modify:

- `public.posts`
- `idx_posts_category`
- `idx_posts_user`
- `update_updated_at_column()`
- `posts_updated_at_trigger`

The migration file is provided for controlled database cleanup. It is not automatically executed by the application startup.

## Module 5 PART D — Transactional Outbox

Post creation and event creation are handled in the same PostgreSQL transaction.

The flow is:

1. Begin a database transaction.
2. Insert the post.
3. Build the PostCreated event with a stable event ID.
4. Insert the event into `public.outbox_events`.
5. Commit the transaction.
6. Invalidate the Redis cache after commit.

If the post insert or outbox insert fails, the transaction is rolled back. This prevents a post from being committed without its corresponding outbox event.

The GraphQL resolver does not synchronously depend on the Notification Service. A background publisher reads pending outbox events and sends them to the internal Notification Service endpoint.

### Publisher and recovery behaviour

- Pending events are claimed in batches using `FOR UPDATE SKIP LOCKED`.
- Stale PROCESSING events can be recovered after the configured lock timeout.
- An event is marked SENT only after the Notification Service accepts the request.
- Failed deliveries are returned to PENDING with increasing retry delays and bounded jitter.
- The same event ID is retained across delivery retries.
- The publisher runs independently of the post-creation response.

The Posts publisher retries pending events with capped backoff. Notification Service separately manages per-device delivery attempts, retry classification and dead-letter handling.

### Outbox migration safety

The migration:

`migrations/002_create_outbox_events.sql`

creates the outbox table and its indexes. It is a controlled database migration and is not automatically executed by application startup.

Before applying it to an existing database, verify the target database, inspect the schema, and confirm a backup. Do not execute production migrations without the required approval.

### PART D automated test verification

Run the Posts Service test suite:

```bash
npm test
```

The PART D tests cover:

- Post creation and outbox insertion in one transaction.
- Rollback when post insertion fails.
- Rollback when outbox insertion fails.
- Notification Service outage followed by later event delivery.
- Retry delivery using the same event ID.
- Stale PROCESSING event recovery.
- Concurrent-safe event claiming with `FOR UPDATE SKIP LOCKED`.
- Retry delay and bounded jitter.
- PostCreated event payload and invalid category handling.

The outage/recovery integration test uses a simulated database and publisher. It does not represent a live cross-service deployment test.

Notification Service test command:

`npm test`

The Notification Service suite uses `.env.test.local`. Keep this file out of Git and never print or commit its secret values.

Its automated coverage includes duplicate event processing, concurrent event persistence, permanent and transient FCM failures, retry scheduling, maximum-attempt dead-letter handling, and invalid-token deactivation.

Test results should be recorded from the actual test run. Passing automated tests do not replace the separate deployment and device verification planned for Module 5 PART E.
