-- Up Migration

INSERT INTO permissions (key, description, group_name, resource_type, risk_level)
VALUES
    ('quizzes.attempts.read_own', 'Read participants, results and full answer snapshots on own quizzes', 'Quizzes', 'quiz_attempt', 'sensitive'),
    ('quizzes.attempts.read_any', 'Read participants, results and full answer snapshots on any quiz', 'Quizzes', 'quiz_attempt', 'sensitive'),
    ('quizzes.attempts.delete_own', 'Permanently delete participant attempts on own quizzes', 'Quizzes', 'quiz_attempt', 'dangerous'),
    ('quizzes.attempts.delete_any', 'Permanently delete participant attempts on any quiz', 'Quizzes', 'quiz_attempt', 'dangerous')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT r.id, p.id, 'allow'
FROM roles r CROSS JOIN permissions p
WHERE p.key IN (
    'quizzes.attempts.read_own', 'quizzes.attempts.read_any',
    'quizzes.attempts.delete_own', 'quizzes.attempts.delete_any'
)
AND (
    r.is_owner OR r.name = 'Administrator'
    OR (r.name = 'Uploader' AND p.key IN ('quizzes.attempts.read_own', 'quizzes.attempts.delete_own'))
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Down Migration

DELETE FROM permissions WHERE key IN (
    'quizzes.attempts.read_own', 'quizzes.attempts.read_any',
    'quizzes.attempts.delete_own', 'quizzes.attempts.delete_any'
);
