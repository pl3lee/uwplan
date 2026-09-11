SELECT jsonb_build_object(
  'user', (SELECT jsonb_build_object('id',id,'role',role) FROM "user" WHERE id='legacy-student'),
  'providers', (SELECT jsonb_object_agg(provider,provider_account_id) FROM account WHERE user_id='legacy-student'),
  'schedule_owner', (SELECT p.user_id FROM schedule s JOIN plan p ON p.id=s.plan_id WHERE s.id='22222222-2222-4222-8222-222222222222'),
  'template', (SELECT t.name FROM plan_template pt JOIN template t ON t.id=pt.template_id WHERE pt.plan_id='11111111-1111-4111-8111-111111111111'),
  'free_choice', (SELECT c.code FROM free_course f JOIN course c ON c.id=f.filled_course_id WHERE f.user_id='legacy-student'),
  'selected_slots', (SELECT jsonb_agg(course_item_id ORDER BY course_item_id) FROM selected_course WHERE plan_id='11111111-1111-4111-8111-111111111111' AND selected),
  'assignments', (SELECT jsonb_agg(jsonb_build_object('code',c.code,'term',sc.term) ORDER BY c.code) FROM schedule_course sc JOIN course c ON c.id=sc.course_id WHERE sc.schedule_id='22222222-2222-4222-8222-222222222222'),
  'range', (SELECT jsonb_build_array(start_term,start_year,end_term,end_year) FROM user_term_range WHERE user_id='legacy-student'),
  'candidate_schedule', (SELECT id::text FROM schedule WHERE name='Written by rejected candidate')
);
