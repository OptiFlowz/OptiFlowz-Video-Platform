import type { Candidate } from './model';

export type CandidateDraft = Omit<Candidate, 'max_points'> & { max_points: number | '' };

export function candidateValues(rows: readonly CandidateDraft[]) {
  return rows.map(({ question_id, position, max_points }) => ({ question_id, position, max_points }));
}

export function sameCandidates(left: readonly CandidateDraft[], right: readonly CandidateDraft[]) {
  return JSON.stringify(candidateValues(left)) === JSON.stringify(candidateValues(right));
}

export function candidatesValid(rows: readonly CandidateDraft[]) {
  return rows.every(row => Number.isInteger(row.position) && row.position >= 0 && row.position <= 2147483647
    && typeof row.max_points === 'number' && Number.isFinite(row.max_points) && row.max_points > 0 && row.max_points <= 99999999.99
    && Math.abs(row.max_points * 100 - Math.round(row.max_points * 100)) < 1e-6);
}

export function moveCandidate(rows: readonly CandidateDraft[], id: string, targetId: string): CandidateDraft[] {
  const from = rows.findIndex(row => row.question_id === id), to = rows.findIndex(row => row.question_id === targetId);
  if (from < 0 || to < 0 || from === to) return [...rows];
  // Reuse the fixed-question slots so random source blocks retain their positions.
  let previous = -1;
  const positions = rows.map(row => { previous = Math.max(row.position, previous + 1); return previous; });
  // Duplicate slots at the integer limit can be spread backwards without overflowing.
  for (let index = positions.length - 1; index >= 0; index--) {
    positions[index] = Math.min(positions[index], index === positions.length - 1 ? 2147483647 : positions[index + 1] - 1);
  }
  const next = [...rows], [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next.map((row, index) => ({ ...row, position: positions[index] }));
}
