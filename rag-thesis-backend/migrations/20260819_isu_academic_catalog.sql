-- ISU Echague institutional catalog: every college and its degree programs.
--
-- CCSICT remains the system's operating scope through the thesis defense and
-- is the only ACTIVE department. The other nine colleges are seeded as
-- standby data: `departments.active = false` hides them from every catalog
-- read (routers/catalog.py::_nested_catalog) and makes
-- services/catalog.py::resolve_academic_selection reject an upload addressed
-- to them with 422, so no thesis, profile, or chat session can reach them.
--
-- Their programs and specializations are seeded ACTIVE on purpose: the
-- department flag is the single authoritative switch, so scaling a college up
-- after the defense is one statement --
--
--   update public.departments set active = true where code = 'CA';
--
-- rather than a three-table cascade. See the activation checklist in the
-- README (Institutional catalog) before flipping one on: programs carrying
-- specializations additionally need services/catalog.py
-- SPECIALIZATION_REQUIRED_PROGRAMS and the validate_academic_classification
-- trigger from 20260725 widened beyond BSCS/BSIT.
--
-- Additive and idempotent. Never deletes and never changes an existing
-- department's `active` state, so a college someone already turned on stays on.
--
-- Rollback: 20260819_isu_academic_catalog.rollback.sql

-- Full college name. `departments.name` is the short institutional code and is
-- the foreign-key target for papers, profiles, chat sessions, scans, uploads,
-- and the activity log, so it cannot carry the prose title itself.
alter table public.departments add column if not exists title text;

insert into public.departments (name, code, title, track_label, tracks, active) values
  ('SVM', 'SVM', 'School of Veterinary Medicine',
   'Program / specialization', '[]'::jsonb, false),
  ('CA', 'CA', 'College of Agriculture',
   'Program / specialization', '[]'::jsonb, false),
  ('IOF', 'IOF', 'Institute of Fisheries',
   'Program / specialization', '[]'::jsonb, false),
  ('CAS', 'CAS', 'College of Arts and Sciences',
   'Program / specialization', '[]'::jsonb, false),
  ('CCSICT', 'CCSICT', 'College of Computing Studies, Information and Communication Technology',
   'Academic track', '[]'::jsonb, true),
  ('COE', 'COE', 'College of Engineering',
   'Program / specialization', '[]'::jsonb, false),
  ('CBAPA', 'CBAPA', 'College of Business, Accountancy and Public Administration',
   'Program / specialization', '[]'::jsonb, false),
  ('CON', 'CON', 'College of Nursing',
   'Program / specialization', '[]'::jsonb, false),
  ('CCJE', 'CCJE', 'College of Criminal Justice Education',
   'Program / specialization', '[]'::jsonb, false),
  ('CED', 'CED', 'College of Education',
   'Program / specialization', '[]'::jsonb, false)
-- Deliberately does not touch `active` or `tracks`: CCSICT already exists with
-- its legacy track list, and re-running this must not silently deactivate a
-- college that has since been scaled up.
on conflict (name) do update set
  code = excluded.code,
  title = excluded.title;

-- Programs for the standby colleges. CCSICT's five programs (BSCS, BSIT,
-- BSDSA, BSIS, BLIS) are already seeded by
-- 20260725_normalized_academic_catalog.sql and are intentionally not repeated
-- here. BLIS belongs to CCSICT, not to the College of Education.
insert into public.programs (department_id, code, name, active)
select department.id, seed.code, seed.name, true
from public.departments as department
join (values
  -- School of Veterinary Medicine
  ('SVM', 'DVM', 'Doctor of Veterinary Medicine'),
  -- College of Agriculture
  ('CA', 'BSA', 'Bachelor of Science in Agriculture'),
  ('CA', 'BSAB', 'Bachelor of Science in Agri Business'),
  ('CA', 'BSAH', 'Bachelor of Science in Animal Husbandry'),
  ('CA', 'BSF', 'Bachelor of Science in Forestry'),
  ('CA', 'DAS', 'Diploma in Agricultural Sciences'),
  ('CA', 'DAT', 'Diploma in Agricultural Technology'),
  -- Institute of Fisheries
  ('IOF', 'BSFAS', 'Bachelor of Science in Fisheries and Aquatic Sciences'),
  -- College of Arts and Sciences
  ('CAS', 'ABCOM', 'Bachelor of Arts in Communication'),
  ('CAS', 'ABENG', 'Bachelor of Arts in English'),
  ('CAS', 'ABELS', 'Bachelor of Arts in English Language Studies'),
  ('CAS', 'BSBIO', 'Bachelor of Science in Biology'),
  ('CAS', 'BSCHEM', 'Bachelor of Science in Chemistry'),
  ('CAS', 'BSES', 'Bachelor of Science in Environmental Science'),
  ('CAS', 'BSMATH', 'Bachelor of Science in Mathematics'),
  ('CAS', 'BSPSYCH', 'Bachelor of Science in Psychology'),
  -- College of Engineering
  ('COE', 'BSABE', 'Bachelor of Science in Agricultural and Biosystems Engineering'),
  ('COE', 'BSCE', 'Bachelor of Science in Civil Engineering'),
  -- College of Business, Accountancy and Public Administration
  ('CBAPA', 'BPA', 'Bachelor in Public Administration'),
  ('CBAPA', 'BSACC', 'Bachelor of Science in Accountancy'),
  ('CBAPA', 'BSBA', 'Bachelor of Science in Business Administration'),
  ('CBAPA', 'BSENT', 'Bachelor of Science in Entrepreneurship'),
  ('CBAPA', 'BSHM', 'Bachelor of Science in Hospitality Management'),
  ('CBAPA', 'BSMA', 'Bachelor of Science in Management Accounting'),
  ('CBAPA', 'BSTM', 'Bachelor of Science in Tourism Management'),
  -- College of Nursing
  ('CON', 'BSN', 'Bachelor of Science in Nursing'),
  -- College of Criminal Justice Education
  ('CCJE', 'BSCRIM', 'Bachelor of Science in Criminology'),
  ('CCJE', 'BSLEA', 'Bachelor of Science in Law Enforcement Administration'),
  -- College of Education
  ('CED', 'BECED', 'Bachelor of Early Childhood Education'),
  ('CED', 'BEED', 'Bachelor of Elementary Education'),
  ('CED', 'BPED', 'Bachelor of Physical Education'),
  ('CED', 'BSED', 'Bachelor of Secondary Education'),
  ('CED', 'BTLED', 'Bachelor of Technology and Livelihood Education')
) as seed(department_code, code, name) on seed.department_code = department.code
on conflict (department_id, code) do update set name = excluded.name;

-- Majors carried as specializations, matching how CCSICT already models
-- BSIT -> WMAD / NETSEC rather than inventing one program per major.
insert into public.specializations (program_id, code, name, active)
select program.id, seed.code, seed.name, true
from public.programs as program
join public.departments as department on department.id = program.department_id
join (values
  ('CBAPA', 'BSBA', 'HRM', 'Human Resource Management'),
  ('CBAPA', 'BSBA', 'MM', 'Marketing Management'),
  ('CED', 'BSED', 'ENG', 'English'),
  ('CED', 'BSED', 'FIL', 'Filipino'),
  ('CED', 'BSED', 'LIM', 'Library and Information Management'),
  ('CED', 'BSED', 'MATH', 'Mathematics'),
  ('CED', 'BSED', 'SOCSTUD', 'Social Studies'),
  ('CED', 'BTLED', 'HE', 'Home Economics'),
  ('CED', 'BTLED', 'ICT', 'Information and Communication Technology')
) as seed(department_code, program_code, code, name)
  on seed.department_code = department.code and seed.program_code = program.code
on conflict (program_id, code) do update set name = excluded.name;

-- Guardrail: this migration adds institutional reference data only. It creates
-- no thesis, touches no paper, and leaves CCSICT the sole active department.
