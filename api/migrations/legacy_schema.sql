-- Canonical public schema after the ten retained legacy migrations.
CREATE SCHEMA IF NOT EXISTS public;

COMMENT ON SCHEMA public IS 'standard public schema';

CREATE TYPE public.course_item_type AS ENUM (
    'fixed',
    'free'
);

CREATE TYPE public.item_type AS ENUM (
    'requirement',
    'instruction',
    'separator'
);

CREATE TYPE public.role_type AS ENUM (
    'user',
    'moderator',
    'admin'
);

CREATE TYPE public.season AS ENUM (
    'Fall',
    'Winter',
    'Spring'
);

CREATE TABLE public.account (
    user_id character varying(255) NOT NULL,
    type character varying(255) NOT NULL,
    provider character varying(255) NOT NULL,
    provider_account_id character varying(255) NOT NULL,
    refresh_token text,
    access_token text,
    expires_at integer,
    token_type character varying(255),
    scope character varying(255),
    id_token text,
    session_state character varying(255)
);

CREATE TABLE public.course (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code character varying(10) NOT NULL,
    name character varying(255) NOT NULL,
    useful_rating numeric(4,3),
    liked_rating numeric(4,3),
    easy_rating numeric(4,3),
    num_ratings integer,
    description text DEFAULT ''::text NOT NULL,
    prereqs text DEFAULT ''::text NOT NULL,
    antireqs text DEFAULT ''::text NOT NULL,
    coreqs text DEFAULT ''::text NOT NULL
);

CREATE TABLE public.course_item (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    requirement_id uuid NOT NULL,
    type public.course_item_type NOT NULL,
    course_id uuid
);

CREATE TABLE public.free_course (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_item_id uuid NOT NULL,
    user_id character varying(255) NOT NULL,
    filled_course_id uuid NOT NULL
);

CREATE TABLE public.plan (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id character varying(255) NOT NULL
);

CREATE TABLE public.plan_template (
    plan_id uuid NOT NULL,
    template_id uuid NOT NULL
);

CREATE TABLE public.schedule (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    plan_id uuid NOT NULL
);

CREATE TABLE public.schedule_course (
    schedule_id uuid NOT NULL,
    course_id uuid NOT NULL,
    term character varying(20) NOT NULL
);

CREATE TABLE public.selected_course (
    plan_id uuid NOT NULL,
    course_item_id uuid NOT NULL,
    selected boolean DEFAULT false NOT NULL
);

CREATE TABLE public.session (
    session_token character varying(255) NOT NULL,
    user_id character varying(255) NOT NULL,
    expires timestamp with time zone NOT NULL
);

CREATE TABLE public.template (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    created_by character varying(255)
);

CREATE TABLE public.template_item (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    template_id uuid NOT NULL,
    type public.item_type NOT NULL,
    description text,
    order_index integer NOT NULL
);

CREATE TABLE public."user" (
    id character varying(255) NOT NULL,
    name character varying(255),
    email character varying(255) NOT NULL,
    email_verified timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    image character varying(255),
    role public.role_type DEFAULT 'user'::public.role_type NOT NULL
);

CREATE TABLE public.user_term_range (
    user_id character varying(255) NOT NULL,
    start_term public.season NOT NULL,
    start_year integer NOT NULL,
    end_term public.season NOT NULL,
    end_year integer NOT NULL
);

CREATE TABLE public.verification_token (
    identifier character varying(255) NOT NULL,
    token character varying(255) NOT NULL,
    expires timestamp with time zone NOT NULL
);

ALTER TABLE ONLY public.account
    ADD CONSTRAINT account_provider_provider_account_id_pk PRIMARY KEY (provider, provider_account_id);

ALTER TABLE ONLY public.course
    ADD CONSTRAINT course_code_unique UNIQUE (code);

ALTER TABLE ONLY public.course_item
    ADD CONSTRAINT course_item_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.course
    ADD CONSTRAINT course_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.free_course
    ADD CONSTRAINT free_course_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.plan
    ADD CONSTRAINT plan_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.plan_template
    ADD CONSTRAINT plan_template_plan_id_template_id_pk PRIMARY KEY (plan_id, template_id);

ALTER TABLE ONLY public.schedule_course
    ADD CONSTRAINT schedule_course_schedule_id_course_id_pk PRIMARY KEY (schedule_id, course_id);

ALTER TABLE ONLY public.schedule
    ADD CONSTRAINT schedule_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.selected_course
    ADD CONSTRAINT selected_course_plan_id_course_item_id_pk PRIMARY KEY (plan_id, course_item_id);

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_pkey PRIMARY KEY (session_token);

ALTER TABLE ONLY public.template_item
    ADD CONSTRAINT template_item_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.template
    ADD CONSTRAINT template_name_unique UNIQUE (name);

ALTER TABLE ONLY public.template
    ADD CONSTRAINT template_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_term_range
    ADD CONSTRAINT user_term_range_pkey PRIMARY KEY (user_id);

ALTER TABLE ONLY public.verification_token
    ADD CONSTRAINT verification_token_identifier_token_pk PRIMARY KEY (identifier, token);

CREATE INDEX account_user_id_idx ON public.account USING btree (user_id);

CREATE INDEX course_code_idx ON public.course USING btree (code);

CREATE INDEX course_item_course_id_idx ON public.course_item USING btree (course_id);

CREATE INDEX course_item_requirement_id_idx ON public.course_item USING btree (requirement_id);

CREATE UNIQUE INDEX free_course_item_user_idx ON public.free_course USING btree (course_item_id, user_id);

CREATE INDEX free_course_user_id_idx ON public.free_course USING btree (user_id);

CREATE UNIQUE INDEX plan_user_id_idx ON public.plan USING btree (user_id);

CREATE INDEX schedule_course_term_idx ON public.schedule_course USING btree (term);

CREATE INDEX session_user_id_idx ON public.session USING btree (user_id);

ALTER TABLE ONLY public.account
    ADD CONSTRAINT account_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id);

ALTER TABLE ONLY public.course_item
    ADD CONSTRAINT course_item_course_id_course_id_fk FOREIGN KEY (course_id) REFERENCES public.course(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.course_item
    ADD CONSTRAINT course_item_requirement_id_template_item_id_fk FOREIGN KEY (requirement_id) REFERENCES public.template_item(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.free_course
    ADD CONSTRAINT free_course_course_item_id_course_item_id_fk FOREIGN KEY (course_item_id) REFERENCES public.course_item(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.free_course
    ADD CONSTRAINT free_course_filled_course_id_course_id_fk FOREIGN KEY (filled_course_id) REFERENCES public.course(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.free_course
    ADD CONSTRAINT free_course_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.plan_template
    ADD CONSTRAINT plan_template_plan_id_plan_id_fk FOREIGN KEY (plan_id) REFERENCES public.plan(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.plan_template
    ADD CONSTRAINT plan_template_template_id_template_id_fk FOREIGN KEY (template_id) REFERENCES public.template(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.plan
    ADD CONSTRAINT plan_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.schedule_course
    ADD CONSTRAINT schedule_course_course_id_course_id_fk FOREIGN KEY (course_id) REFERENCES public.course(id);

ALTER TABLE ONLY public.schedule_course
    ADD CONSTRAINT schedule_course_schedule_id_schedule_id_fk FOREIGN KEY (schedule_id) REFERENCES public.schedule(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.schedule
    ADD CONSTRAINT schedule_plan_id_plan_id_fk FOREIGN KEY (plan_id) REFERENCES public.plan(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.selected_course
    ADD CONSTRAINT selected_course_course_item_id_course_item_id_fk FOREIGN KEY (course_item_id) REFERENCES public.course_item(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.selected_course
    ADD CONSTRAINT selected_course_plan_id_plan_id_fk FOREIGN KEY (plan_id) REFERENCES public.plan(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id);

ALTER TABLE ONLY public.template
    ADD CONSTRAINT template_created_by_user_id_fk FOREIGN KEY (created_by) REFERENCES public."user"(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.template_item
    ADD CONSTRAINT template_item_template_id_template_id_fk FOREIGN KEY (template_id) REFERENCES public.template(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_term_range
    ADD CONSTRAINT user_term_range_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;
