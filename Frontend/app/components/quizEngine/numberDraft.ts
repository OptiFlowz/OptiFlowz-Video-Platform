/** Numeric fields may be temporarily empty while the user replaces a value. */
export type NumberDraft<T> = { [K in keyof T]: T[K] extends number | null ? T[K] | '' : T[K] };

export function numberDraftValue(value: string): number | '' {
  return value === '' ? '' : Number(value);
}
