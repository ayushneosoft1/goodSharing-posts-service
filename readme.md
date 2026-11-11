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
