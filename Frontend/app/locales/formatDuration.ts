/** Format whole seconds as localized hours, minutes and seconds without rounding up. */
export function formatDurationWords(seconds: number, locale: string): string {
  const language = locale === 'sr' ? 'sr-Latn' : locale;
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const units: [string, number][] = [
    ['hour', Math.floor(total / 3600)],
    ['minute', Math.floor((total % 3600) / 60)],
    ['second', total % 60],
  ];
  const parts = units.filter(([unit, value]) => value > 0 || (unit === 'second' && total === 0))
    .map(([unit, value]) => new Intl.NumberFormat(language, {
      style: 'unit', unit, unitDisplay: 'long', maximumFractionDigits: 0,
    }).format(value));
  return new Intl.ListFormat(language, { style: 'long', type: 'conjunction' }).format(parts);
}
