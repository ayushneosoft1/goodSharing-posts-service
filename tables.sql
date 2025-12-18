CREATE TABLE public.posts (
	id int8 GENERATED ALWAYS AS IDENTITY( INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START 1 CACHE 1 NO CYCLE) NOT NULL,
	title text NOT NULL,
	category public.post_category NOT NULL,
	description text NOT NULL,
	user_id int8 NOT NULL,
	is_deleted bool DEFAULT false NULL,
	created_at timestamp DEFAULT now() NULL,
	updated_at timestamp DEFAULT now() NULL,
	CONSTRAINT posts_pkey PRIMARY KEY (id)
);