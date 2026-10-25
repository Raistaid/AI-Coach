// Speech synthesis is provided by installed browser/OS voices. Recognition may
// use the browser's service; the UI explains this before the user enables it.
export function russianVoices(voices = []) {
  return voices.filter(v => typeof v?.lang === 'string' && /^ru(?:[-_]|$)/i.test(v.lang));
}
export const voiceKey = voice => voice.voiceURI || `${voice.lang}:${voice.name}`;
export function selectedVoice(voices, key = '') {
  const russian = russianVoices(voices);
  return russian.find(v => voiceKey(v) === key) || russian.find(v => v.default) || russian[0] || null;
}
export function configureUtterance(utterance, prefs, personality, voices) {
  utterance.lang = 'ru-RU'; utterance.rate = prefs.voiceRate ?? personality.voiceRate; utterance.pitch = personality.voicePitch;
  utterance.volume = prefs.voiceVolume ?? 1;
  const voice = selectedVoice(voices, prefs.voiceId);
  if (voice) utterance.voice = voice;
  return utterance;
}

export const recognitionConstructor = (scope = globalThis) => scope.SpeechRecognition || scope.webkitSpeechRecognition || null;

/** One utterance per click. Abort invalidates late callbacks on stop/navigation. */
export function createVoiceQuestion({ Recognition = recognitionConstructor(), onText = () => {}, onState = () => {}, timeoutMs = 15000, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let recognition = null, timer = null, token = 0;
  const clear = () => { if (timer !== null) clearTimer(timer); timer = null; };
  function abort() {
    token++; const old = recognition; recognition = null; clear();
    if (old) { old.onresult = old.onerror = old.onend = old.onstart = null; try { old.abort(); } catch { /* already stopped */ } }
    onState('idle');
  }
  return {
    supported: Boolean(Recognition),
    get listening() { return Boolean(recognition); },
    abort,
    start() {
      if (!Recognition) { onState('error', 'Голосовой ввод недоступен в этом браузере. Напиши вопрос.'); return; }
      abort(); const run = token;
      let current;
      try { current = new Recognition(); } catch { onState('error', 'Не удалось включить распознавание. Напиши вопрос.'); return; }
      recognition = current;
      let received = false;
      current.lang = 'ru-RU'; current.continuous = false; current.interimResults = false; current.maxAlternatives = 1;
      current.onstart = () => { if (run === token) onState('listening', 'Слушаю вопрос…'); };
      current.onresult = event => {
        if (run !== token || received) return;
        const result = event.results?.[event.resultIndex ?? 0];
        const text = result?.[0]?.transcript?.trim();
        if (!text || result.isFinal === false) return;
        received = true; abort(); onText(text.slice(0, 250));
      };
      current.onerror = event => {
        if (run !== token) return;
        const messages = { 'not-allowed': 'Микрофон недоступен. Разреши его в настройках сайта или напиши вопрос.', 'service-not-allowed': 'Сервис распознавания недоступен. Напиши вопрос.', 'audio-capture': 'Не найден микрофон. Напиши вопрос.', network: 'Сервис распознавания недоступен. Проверь интернет или напиши вопрос.', 'no-speech': 'Не расслышал вопрос. Попробуй ещё раз или напиши его.', 'language-not-supported': 'Распознавание русского недоступно. Напиши вопрос.' };
        abort(); onState('error', messages[event.error] || 'Не удалось распознать речь. Попробуй ещё раз или напиши вопрос.');
      };
      current.onend = () => { if (run === token) { abort(); if (!received) onState('idle', 'Не расслышал вопрос. Нажми микрофон ещё раз или напиши его.'); } };
      onState('starting', 'Подключаем микрофон…');
      try { current.start(); if (recognition === current) timer = setTimer(() => { if (run === token) { abort(); onState('idle', 'Микрофон выключен. Попробуй ещё раз или напиши вопрос.'); } }, timeoutMs); }
      catch { abort(); onState('error', 'Не удалось включить микрофон. Напиши вопрос или попробуй ещё раз.'); }
    },
  };
}
