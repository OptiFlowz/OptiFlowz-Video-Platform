import type { Answer, AttemptQuestion } from './attemptApi';

type Entry = { question: AttemptQuestion; answer: Answer };
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/** Serialize writes so a slow request cannot overwrite a newer selection. */
export class AnswerSaveQueue {
  private pending = new Map<number, Entry>();
  private running: Promise<boolean> | null = null;
  constructor(private write: (entry: Entry) => Promise<void>, private status: (status: SaveStatus) => void) {}
  get hasPending() { return this.pending.size > 0; }
  enqueue(question: AttemptQuestion, answer: Answer) {
    this.pending.set(question.question_no, { question, answer });
    void this.flush();
  }
  flush(): Promise<boolean> {
    if (this.running) return this.running;
    if (!this.pending.size) return Promise.resolve(true);
    this.status('saving');
    this.running = Promise.resolve().then(async () => {
      while (this.pending.size) {
        const [number, entry] = this.pending.entries().next().value!;
        try { await this.write(entry); }
        catch { this.status('error'); return false; }
        if (this.pending.get(number) === entry) this.pending.delete(number);
      }
      this.status('saved');
      return true;
    }).finally(() => { this.running = null; });
    return this.running;
  }
}
