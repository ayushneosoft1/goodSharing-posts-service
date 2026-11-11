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
-- INDEXES
-- =====================================================

CREATE INDEX idx_posts_category
ON posts(category);

CREATE INDEX idx_posts_user
ON posts(user_id);

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