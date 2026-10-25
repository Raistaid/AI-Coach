// Compare measured results only within one skill, metric and media source.
// Legacy records stay in the UI but cannot supply an unknown provenance here.

const METRICS = {
  football: { touches: 'Лучшая серия', lifts: 'Подъёмы стопы' },
  squats: { reps: 'Повторы' },
  balance: { balanceSeconds: 'Лучшее удержание, с' },
};

const count = value => Number.isSafeInteger(value) && value >= 0;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

function timestamp(value) {
  if (typeof value !== 'string') return null;
  const parts = ISO_DATE.exec(value);
  if (!parts) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = parts;
  const [year, month, day, hour, minute, second] = [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]
    || hour > 23 || minute > 59 || second > 59) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function normalize(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)
    || record.schemaVersion !== 2 || !['camera', 'file'].includes(record.source)
    || !count(record.seconds) || record.seconds === 0 || !count(record.metricValue)) return null;
  const metricLabel = Object.hasOwn(METRICS, record.skill)
    && Object.hasOwn(METRICS[record.skill], record.metricKey)
    ? METRICS[record.skill][record.metricKey] : null;
  if (!metricLabel) return null;
  const at = timestamp(record.date);
  if (at === null) return null;
  if (record.metricKey === 'touches'
    && (!count(record.bestStreak) || record.bestStreak > record.metricValue)) return null;
  return {
    skill: record.skill, source: record.source, metricKey: record.metricKey,
    metricLabel, at,
    value: record.metricKey === 'touches' ? record.bestStreak : record.metricValue,
  };
}

/**
 * previousRecords contains history BEFORE the current record is inserted.
 * Returns null for unsupported/legacy/demo or malformed current records.
 * sampleCount includes the current result. Only strictly earlier records with
 * the same skill, metric and source are comparable. No all-time claim is made:
 * bestValue is the best within the supplied saved-history window.
 */
export function compareProgress(record, previousRecords = []) {
  const current = normalize(record);
  if (!current) return null;
  const previous = (Array.isArray(previousRecords) ? previousRecords : [])
    .map(normalize)
    .filter(item => item && item.skill === current.skill && item.source === current.source
      && item.metricKey === current.metricKey && item.at < current.at);
  // Sorting this new array never changes the caller's history.
  previous.sort((a, b) => b.at - a.at);
  const previousValue = previous[0]?.value ?? null;
  const delta = previousValue === null ? null : current.value - previousValue;
  const previousBest = previous.length ? Math.max(...previous.map(item => item.value)) : null;
  const bestValue = Math.max(current.value, previousBest ?? current.value);
  const isNewBest = previousBest !== null && current.value > 0 && current.value > previousBest;
  const scope = current.source === 'file' ? 'среди сохранённых тренировок по видео' : 'среди сохранённых тренировок с камерой';
  const prefix = current.source === 'file' ? 'Видео. ' : '';
  let text;
  if (previousValue === null) {
    text = `${prefix}Первый результат ${scope}. ${current.metricLabel}: ${current.value}.`;
  } else {
    const change = delta > 0 ? `+${delta}` : delta < 0 ? String(delta) : 'без изменения';
    text = `${prefix}${current.metricLabel}: ${current.value}. Предыдущий результат: ${previousValue}; изменение: ${change}. `
      + (isNewBest ? `Новый лучший результат ${scope}.` : `Лучший результат ${scope}: ${bestValue}.`);
  }
  if (current.value === 0) text += ' В этой тренировке положительный результат не зафиксирован.';
  return {
    metricLabel: current.metricLabel, value: current.value, previousValue, delta,
    bestValue, isNewBest, sampleCount: previous.length + 1, text,
  };
}
