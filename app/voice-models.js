// Real Piper speakers, pinned to the public model repository revision.
// These are distinct trained voices, not pitch presets of a system voice.
export const VOICE_REVISION = '5041a7a49ae5b3a0f30e6837769eb03fdbb231bd';
export const LOCAL_VOICES = [
  { id: 'piper:ru_RU-denis-medium', modelId: 'ru_RU-denis-medium', name: 'Денис', description: 'Ровный мужской голос', speaker: 'denis', modelBytes: 63201294, configBytes: 4823 },
  { id: 'piper:ru_RU-dmitri-medium', modelId: 'ru_RU-dmitri-medium', name: 'Дмитрий', description: 'Мягкий мужской голос', speaker: 'dmitri', modelBytes: 63201294, configBytes: 4824 },
];
export const localVoice = id => LOCAL_VOICES.find(voice => voice.id === id) || null;
export function voiceFiles(voice) {
  const base = `https://huggingface.co/rhasspy/piper-voices/resolve/${VOICE_REVISION}/ru/ru_RU/${voice.speaker}/medium/${voice.modelId}.onnx`;
  const name = `${voice.modelId}-${VOICE_REVISION.slice(0, 8)}`;
  return [
    { name: `${name}.json`, url: `${base}.json`, bytes: voice.configBytes },
    { name: `${name}.onnx`, url: base, bytes: voice.modelBytes },
  ];
}
