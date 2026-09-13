-- +goose Up
-- Preserve identities and the current displayed order, including legacy UUIDv4s.
ALTER TABLE course_item ADD COLUMN order_index integer;
WITH positions AS (
    SELECT id, (row_number() OVER (PARTITION BY requirement_id ORDER BY id) - 1)::integer AS position
    FROM course_item
)
UPDATE course_item c SET order_index=p.position FROM positions p WHERE p.id=c.id;

-- Old releases omit this column. Serialize their append against the parent so
-- concurrent inserts still get distinct positions without changing old SQL.
-- +goose StatementBegin
CREATE FUNCTION assign_course_item_position() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
    PERFORM 1 FROM template_item WHERE id=NEW.requirement_id FOR UPDATE;
    IF NEW.order_index IS NULL THEN
        SELECT COALESCE(max(order_index)+1,0) INTO NEW.order_index
        FROM course_item WHERE requirement_id=NEW.requirement_id;
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER course_item_position BEFORE INSERT ON course_item
FOR EACH ROW EXECUTE FUNCTION assign_course_item_position();
ALTER TABLE course_item ALTER COLUMN order_index SET NOT NULL;
ALTER TABLE course_item ADD CONSTRAINT course_item_position_unique UNIQUE(requirement_id,order_index);
ALTER TABLE course_item ADD CONSTRAINT course_item_position_valid CHECK(order_index>=0);

-- Stable tie-breaking repairs ambiguous block positions without reordering them.
WITH positions AS (
    SELECT id, (row_number() OVER (PARTITION BY template_id ORDER BY order_index,id)-1)::integer AS position
    FROM template_item
)
UPDATE template_item t SET order_index=p.position FROM positions p WHERE p.id=t.id;
ALTER TABLE template_item ADD CONSTRAINT template_item_position_unique UNIQUE(template_id,order_index);
ALTER TABLE template_item ADD CONSTRAINT template_item_position_valid CHECK(order_index>=0);

-- Legacy free slots can retain an unused catalog reference. Keep that metadata
-- intact while enforcing shape for new/updated rows; validate after explicit repair.
ALTER TABLE course_item ADD CONSTRAINT course_item_shape CHECK(
    (type='fixed' AND course_id IS NOT NULL) OR (type='free' AND course_id IS NULL)
) NOT VALID;
-- Constant discriminator columns let ordinary foreign keys enforce subtypes.
-- Defaults keep inserts from the retained release compatible.
ALTER TABLE template_item ADD CONSTRAINT template_item_id_type_unique UNIQUE(id,type);
ALTER TABLE course_item ADD COLUMN requirement_type item_type NOT NULL DEFAULT 'requirement';
ALTER TABLE course_item ADD CONSTRAINT course_item_requirement_type CHECK(requirement_type='requirement');
ALTER TABLE course_item ADD CONSTRAINT course_item_requirement_kind_fk
    FOREIGN KEY(requirement_id,requirement_type) REFERENCES template_item(id,type) ON DELETE CASCADE;
ALTER TABLE course_item ADD CONSTRAINT course_item_id_type_unique UNIQUE(id,type);
ALTER TABLE free_course ADD COLUMN item_type course_item_type NOT NULL DEFAULT 'free';
ALTER TABLE free_course ADD CONSTRAINT free_course_item_type CHECK(item_type='free');
ALTER TABLE free_course ADD CONSTRAINT free_course_item_kind_fk
    FOREIGN KEY(course_item_id,item_type) REFERENCES course_item(id,type) ON DELETE CASCADE;

ALTER TABLE schedule_course ADD CONSTRAINT schedule_course_term_valid
    CHECK(term ~ '^(Winter|Spring|Fall) [1-9][0-9]{0,3}$');
-- Historical reversed ranges are saved user values: do not guess new endpoints.
ALTER TABLE user_term_range ADD CONSTRAINT user_term_range_valid CHECK(
    start_year BETWEEN 1 AND 9999 AND end_year BETWEEN 1 AND 9999 AND
    start_year*3 + CASE start_term WHEN 'Winter' THEN 0 WHEN 'Spring' THEN 1 ELSE 2 END <=
    end_year*3 + CASE end_term WHEN 'Winter' THEN 0 WHEN 'Spring' THEN 1 ELSE 2 END
) NOT VALID;
-- Reject existing email collisions rather than merge distinct account identities.
CREATE UNIQUE INDEX user_email_lower_unique ON "user"(lower(email));

CREATE INDEX schedule_plan_id_idx ON schedule(plan_id,id);
CREATE INDEX plan_template_template_id_idx ON plan_template(template_id,plan_id);
CREATE INDEX selected_course_item_id_idx ON selected_course(course_item_id,plan_id);
CREATE INDEX template_created_by_idx ON template(created_by);
CREATE INDEX free_course_filled_course_id_idx ON free_course(filled_course_id);
CREATE INDEX schedule_course_course_id_idx ON schedule_course(course_id);
-- template_item_position_unique and course_item_position_unique cover parent reads.
DROP INDEX course_code_idx;
DROP INDEX course_item_requirement_id_idx;
DROP INDEX schedule_course_term_idx;

CREATE VIEW plan_course_choices WITH (security_invoker=true) AS
SELECT p.id AS plan_id,p.user_id,pt.template_id,ci.id AS course_item_id,
    (CASE WHEN ci.type='fixed' THEN ci.course_id ELSE fc.filled_course_id END)::uuid AS course_id,
    COALESCE(sc.selected,false) AS selected
FROM plan p
JOIN plan_template pt ON pt.plan_id=p.id
JOIN template_item ti ON ti.template_id=pt.template_id
JOIN course_item ci ON ci.requirement_id=ti.id
LEFT JOIN selected_course sc ON sc.plan_id=p.id AND sc.course_item_id=ci.id
LEFT JOIN free_course fc ON fc.user_id=p.user_id AND fc.course_item_id=ci.id;

CREATE VIEW active_course_sources WITH (security_invoker=true) AS
SELECT plan_id,user_id,template_id,course_item_id,course_id
FROM plan_course_choices WHERE selected AND course_id IS NOT NULL;

-- Existing restricted application roles need the same read access to these
-- invoker views. Do not grant schema ownership or migration privileges.
-- +goose StatementBegin
DO $$
DECLARE reader record;
BEGIN
    FOR reader IN SELECT DISTINCT grantee FROM information_schema.role_table_grants
        WHERE table_schema='public' AND table_name='selected_course' AND privilege_type='SELECT'
    LOOP
        EXECUTE format('GRANT SELECT ON plan_course_choices,active_course_sources TO %I',reader.grantee);
    END LOOP;
END;
$$;
-- +goose StatementEnd

-- Repair #19 using the exact active-source definition used by new reads/writes.
DELETE FROM schedule_course assignment USING schedule s
WHERE assignment.schedule_id=s.id AND NOT EXISTS (
    SELECT 1 FROM active_course_sources source
    WHERE source.plan_id=s.plan_id AND source.course_id=assignment.course_id
);

-- +goose Down
-- Application rollback retains expanded schema and candidate writes. Reversing
-- the repaired data or renumbered positions cannot restore the original state.
-- +goose StatementBegin
DO $$ BEGIN RAISE EXCEPTION 'UWPlan planning integrity migration is forward-only; roll back application images'; END $$;
-- +goose StatementEnd
