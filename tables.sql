CREATE TABLE public.posts (
    id BIGINT GENERATED ALWAYS AS IDENTITY
        (INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START 1 CACHE 1 NO CYCLE)
        NOT NULL,
    title TEXT NOT NULL,
    category public.post_category NOT NULL,
    description TEXT NOT NULL,
    image_url TEXT,        -- stores image URL
    location TEXT,         -- optional location
    user_id BIGINT NOT NULL,
    is_deleted BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    CONSTRAINT posts_pkey PRIMARY KEY (id)
);