INSERT INTO "user" (id,name,email,role) VALUES ('legacy-student','Release Student','release@example.invalid','user');
INSERT INTO account (user_id,type,provider,provider_account_id) VALUES
  ('legacy-student','oauth','google','legacy-google-subject'),
  ('legacy-student','oauth','github','42');
INSERT INTO session (session_token,user_id,expires) VALUES ('legacy-release-session','legacy-student',now()+interval '1 hour');
INSERT INTO plan (id,user_id) VALUES ('11111111-1111-4111-8111-111111111111','legacy-student');
INSERT INTO schedule (id,name,plan_id) VALUES ('22222222-2222-4222-8222-222222222222','Saved release schedule','11111111-1111-4111-8111-111111111111');
INSERT INTO template (id,name,description,created_by) VALUES ('33333333-3333-4333-8333-333333333333','Release degree requirements','Preserved across releases','legacy-student');
INSERT INTO template_item (id,template_id,type,description,order_index) VALUES ('44444444-4444-4444-8444-444444444444','33333333-3333-4333-8333-333333333333','requirement','Core and elective',0);
INSERT INTO course (id,code,name,num_ratings) VALUES
  ('77777777-7777-4777-8777-777777777777','CS135','Designing Functional Programs',100),
  ('88888888-8888-4888-8888-888888888888','CS136','Elementary Algorithm Design',80);
INSERT INTO course_item (id,requirement_id,type,course_id) VALUES
  ('55555555-5555-4555-8555-555555555555','44444444-4444-4444-8444-444444444444','fixed','77777777-7777-4777-8777-777777777777'),
  ('66666666-6666-4666-8666-666666666666','44444444-4444-4444-8444-444444444444','free',null);
INSERT INTO plan_template (plan_id,template_id) VALUES ('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333');
INSERT INTO free_course (course_item_id,user_id,filled_course_id) VALUES ('66666666-6666-4666-8666-666666666666','legacy-student','88888888-8888-4888-8888-888888888888');
INSERT INTO selected_course (plan_id,course_item_id,selected) VALUES
  ('11111111-1111-4111-8111-111111111111','55555555-5555-4555-8555-555555555555',true),
  ('11111111-1111-4111-8111-111111111111','66666666-6666-4666-8666-666666666666',true);
INSERT INTO user_term_range (user_id,start_term,start_year,end_term,end_year) VALUES ('legacy-student','Fall',2026,'Spring',2027);
INSERT INTO schedule_course (schedule_id,course_id,term) VALUES
  ('22222222-2222-4222-8222-222222222222','77777777-7777-4777-8777-777777777777','Fall 2026'),
  ('22222222-2222-4222-8222-222222222222','88888888-8888-4888-8888-888888888888','Winter 2027');
