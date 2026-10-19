-- Up Migration

-- Define the permission set and default role grants. Route enforcement is added separately.
INSERT INTO permissions (key, description, group_name, resource_type, risk_level)
VALUES
    ('quizzes.create', 'Create quizzes', 'Quizzes', 'quiz', 'normal'),
    ('quizzes.read_own', 'List and read quizzes created by the user, including authoring details', 'Quizzes', 'quiz', 'normal'),
    ('quizzes.read_any', 'List and read any quiz, including authoring details', 'Quizzes', 'quiz', 'sensitive'),
    ('quizzes.update_own', 'Update own quiz settings, status, video requirements, question candidates and sources', 'Quizzes', 'quiz', 'normal'),
    ('quizzes.update_any', 'Update any quiz settings, status, video requirements, question candidates and sources', 'Quizzes', 'quiz', 'dangerous'),
    ('quizzes.delete_own', 'Delete quizzes created by the user', 'Quizzes', 'quiz', 'sensitive'),
    ('quizzes.delete_any', 'Delete any quiz', 'Quizzes', 'quiz', 'dangerous'),
    ('quizzes.participate', 'Access published quizzes, check eligibility and watch requirements, and start, resume and interact with the user''s own attempts', 'Quizzes', 'quiz_attempt', 'normal'),
    ('questions.create', 'Create questions', 'Quiz questions', 'question', 'normal'),
    ('questions.read_own', 'List and read questions created by the user, including authoring details', 'Quiz questions', 'question', 'normal'),
    ('questions.read_any', 'List and read any question, including authoring details', 'Quiz questions', 'question', 'sensitive'),
    ('questions.update_own', 'Update own question content, answer options, explanations and group memberships', 'Quiz questions', 'question', 'normal'),
    ('questions.update_any', 'Update any question content, answer options, explanations and group memberships', 'Quiz questions', 'question', 'dangerous'),
    ('questions.delete_own', 'Delete questions created by the user', 'Quiz questions', 'question', 'sensitive'),
    ('questions.delete_any', 'Delete any question', 'Quiz questions', 'question', 'dangerous'),
    ('question_groups.create', 'Create question groups', 'Question groups', 'question_group', 'normal'),
    ('question_groups.read_own', 'List and read question groups created by the user, including authoring details', 'Question groups', 'question_group', 'normal'),
    ('question_groups.read_any', 'List and read any question group, including authoring details', 'Question groups', 'question_group', 'sensitive'),
    ('question_groups.update_own', 'Update own question group metadata and question memberships', 'Question groups', 'question_group', 'normal'),
    ('question_groups.update_any', 'Update any question group metadata and question memberships', 'Question groups', 'question_group', 'dangerous'),
    ('question_groups.delete_own', 'Delete question groups created by the user', 'Question groups', 'question_group', 'sensitive'),
    ('question_groups.delete_any', 'Delete any question group', 'Question groups', 'question_group', 'dangerous')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT r.id, p.id, 'allow'
FROM roles r
CROSS JOIN permissions p
WHERE p.key IN (
    'quizzes.create', 'quizzes.read_own', 'quizzes.read_any',
    'quizzes.update_own', 'quizzes.update_any', 'quizzes.delete_own', 'quizzes.delete_any',
    'quizzes.participate',
    'questions.create', 'questions.read_own', 'questions.read_any',
    'questions.update_own', 'questions.update_any', 'questions.delete_own', 'questions.delete_any',
    'question_groups.create', 'question_groups.read_own', 'question_groups.read_any',
    'question_groups.update_own', 'question_groups.update_any', 'question_groups.delete_own', 'question_groups.delete_any'
)
AND (
    r.is_owner
    OR r.name = 'Administrator'
    OR (r.name = 'Viewer' AND p.key = 'quizzes.participate')
    OR (r.name = 'Uploader' AND p.key IN (
        'quizzes.participate',
        'quizzes.create', 'quizzes.read_own', 'quizzes.update_own', 'quizzes.delete_own',
        'questions.create', 'questions.read_own', 'questions.update_own', 'questions.delete_own',
        'question_groups.create', 'question_groups.read_own', 'question_groups.update_own', 'question_groups.delete_own'
    ))
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Down Migration

-- Existing cascading foreign keys remove any corresponding role grants.
DELETE FROM permissions WHERE key IN (
    'quizzes.create',
    'quizzes.read_own',
    'quizzes.read_any',
    'quizzes.update_own',
    'quizzes.update_any',
    'quizzes.delete_own',
    'quizzes.delete_any',
    'quizzes.participate',
    'questions.create',
    'questions.read_own',
    'questions.read_any',
    'questions.update_own',
    'questions.update_any',
    'questions.delete_own',
    'questions.delete_any',
    'question_groups.create',
    'question_groups.read_own',
    'question_groups.read_any',
    'question_groups.update_own',
    'question_groups.update_any',
    'question_groups.delete_own',
    'question_groups.delete_any'
);
