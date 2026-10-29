# Дополнительные голоса и зависимости

Aimo загружает перечисленные компоненты по запросу. Веса и WASM не включены
в Git-репозиторий; текст для Piper обрабатывается в браузере.

| Компонент | Версия / источник | Лицензия / сведения |
|---|---|---|
| ONNX Runtime Web | [1.18.0](https://github.com/microsoft/onnxruntime/tree/v1.18.0), официальная браузерная сборка `dist/ort.wasm.min.js` в `app/vendor/`, WASM — jsDelivr | [MIT](https://github.com/microsoft/onnxruntime/blob/v1.18.0/LICENSE) |
| Piper web phonemizer wrapper | [@mintplex-labs/piper-tts-web 1.0.5](https://www.npmjs.com/package/@mintplex-labs/piper-tts-web/v/1.0.5), jsDelivr | [MIT, исходники](https://github.com/Mintplex-Labs/piper-tts-web) |
| Piper phonemizer WASM и данные | [@diffusionstudio/piper-wasm 1.0.0](https://www.npmjs.com/package/@diffusionstudio/piper-wasm/v/1.0.0), jsDelivr | [Исходники сборки](https://github.com/diffusionstudio/piper-wasm); Piper phonemize — MIT; включённый eSpeak NG — [GPL-3.0-or-later](https://github.com/espeak-ng/espeak-ng/blob/master/COPYING) |
| Denis medium, ru_RU | [Карточка модели](https://huggingface.co/rhasspy/piper-voices/blob/5041a7a49ae5b3a0f30e6837769eb03fdbb231bd/ru/ru_RU/denis/medium/MODEL_CARD) | Карточка указывает CC0 для датасета; [репозиторий моделей](https://huggingface.co/rhasspy/piper-voices) помечен MIT |
| Dmitri medium, ru_RU | [Карточка модели](https://huggingface.co/rhasspy/piper-voices/blob/5041a7a49ae5b3a0f30e6837769eb03fdbb231bd/ru/ru_RU/dmitri/medium/MODEL_CARD) | Карточка указывает CC0 для датасета; репозиторий моделей помечен MIT |

Оба голоса: один обученный диктор, 22 050 Гц, веса 63 201 294 байта каждый.
Веса и конфигурации зафиксированы на ревизии
`5041a7a49ae5b3a0f30e6837769eb03fdbb231bd`.
API phonemizer/ONNX сверены с опубликованным исходником Piper 1.0.5;
готовность скачивания определяется чтением обоих файлов, не флагом настроек.
Системные голоса предоставляет ОС/браузер, они не являются моделями Piper.

Локальная копия ONNX Runtime JS: `app/vendor/ort.wasm-1.18.0.min.js`;
MIT-лицензия сохранена в `app/vendor/ONNX-RUNTIME-LICENSE.txt`.
