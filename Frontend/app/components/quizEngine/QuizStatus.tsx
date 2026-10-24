import { useQueryClient } from '@tanstack/react-query';
import StatusPicker from '~/components/library/statusPicker';
import { ActiveSVG, EditSVG, InactiveSVG } from '~/constants';
import { useI18n } from '~/i18n';
import { engineKey, request } from './api';
import { inspectQuiz } from './inspectQuiz';
import type { Quiz } from './model';
import { useAccess, styles } from './shared';

export default function QuizStatus({ quiz, disabled, className }: {
  quiz: Pick<Quiz, 'id' | 'user_id' | 'title' | 'status'>;
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const access = useAccess('quizzes', quiz);
  const client = useQueryClient();
  return <StatusPicker<Quiz['status']>
    value={quiz.status}
    title={quiz.title}
    disabled={disabled || !access.update}
    className={className ?? `visibility ${quiz.status === 'published' ? 'public' : styles.unpublishedStatus}`}
    options={[
      { value: 'draft', label: t('qeDraft'), icon: EditSVG },
      { value: 'published', label: t('qePublished'), icon: ActiveSVG },
      { value: 'archived', label: t('qeArchived'), icon: InactiveSVG },
    ]}
    onSave={async status => {
      if (status === 'published') {
        const issues = await inspectQuiz(quiz);
        if (issues.length) throw new Error([t('qeNotReady'), ...issues.map(key => t(key))].join(' '));
      }
      await request(`/${quiz.id}`, 'PATCH', { status });
      await client.invalidateQueries({ queryKey: engineKey });
    }}
  />;
}
