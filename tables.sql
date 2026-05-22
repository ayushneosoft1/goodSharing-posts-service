-- =====================================================
-- POSTS TABLE
-- =====================================================

CREATE TABLE public.posts (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    title TEXT NOT NULL,

    category public.post_category NOT NULL,

    description TEXT NOT NULL,

    image_url TEXT,

    location TEXT,

    user_id BIGINT NOT NULL,

    is_deleted BOOLEAN NOT NULL DEFAULT false,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_post_user
    FOREIGN KEY (user_id)
    REFERENCES users(id)
    ON DELETE CASCADE
);

--------------------------------------------------------

-- =====================================================
-- CATEGORY SUBSCRIPTIONS
-- =====================================================

CREATE TABLE category_subscriptions (
    id BIGSERIAL PRIMARY KEY,

    user_id BIGINT NOT NULL,

    category public.post_category NOT NULL,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT unique_user_category
    UNIQUE (user_id, category),

    CONSTRAINT fk_subscription_user
    FOREIGN KEY (user_id)
    REFERENCES users(id)
    ON DELETE CASCADE
);

--------------------------------------------------------

-- =====================================================
-- NOTIFICATIONS TABLE
-- =====================================================

CREATE TABLE notifications (
    id BIGSERIAL PRIMARY KEY,

    user_id BIGINT NOT NULL,

    post_id BIGINT,

    title TEXT NOT NULL,

    message TEXT NOT NULL,

    is_read BOOLEAN NOT NULL DEFAULT false,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_notification_user
    FOREIGN KEY (user_id)
    REFERENCES users(id)
    ON DELETE CASCADE,

    CONSTRAINT fk_notification_post
    FOREIGN KEY (post_id)
    REFERENCES posts(id)
    ON DELETE SET NULL
);

--------------------------------------------------------

-- =====================================================
-- INDEXES
-- =====================================================

CREATE INDEX idx_posts_category
ON posts(category);

CREATE INDEX idx_posts_user
ON posts(user_id);

CREATE INDEX idx_subscriptions_user
ON category_subscriptions(user_id);

CREATE INDEX idx_subscriptions_category
ON category_subscriptions(category);

CREATE INDEX idx_notifications_user
ON notifications(user_id);

CREATE INDEX idx_notifications_user_read
ON notifications(user_id, is_read);

--------------------------------------------------------

-- =====================================================
-- AUTO UPDATE updated_at FIELD
-- =====================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS
$$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;

    RETURN NEW;
END;
$$
LANGUAGE plpgsql;

CREATE TRIGGER posts_updated_at_trigger
BEFORE UPDATE
ON posts
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

--------------------------------------------------------