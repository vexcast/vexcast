# IA en Vexcast

Vexcast puede usar **Claude** (API de Anthropic) o **modelos que se ejecutan en tu PC**. Todo se configura en **IA → Centro de IA**: eliges el motor, y lo que haga falta (motores locales, modelos, voces) se instala con un clic. No hay que instalar nada a mano.

| Función | Claude | En este PC | Dónde |
|---|---|---|---|
| Co-presentador que responde al chat | ✅ | ✅ llama.cpp + modelo GGUF | IA → Texto y Co-presentador |
| Moderación con IA | ✅ | ✅ | IA → Moderación |
| Traducción de subtítulos | ✅ | ✅ | IA → Subtítulos |
| Voz (TTS) | ❌ Claude no genera audio | ✅ Piper o voz del sistema | IA → Voz |
| Transcripción de subtítulos | ❌ La API de Claude no transcribe audio | ✅ whisper.cpp | IA → Subtítulos |

La voz y la transcripción siempre las hace otro motor, aunque uses Claude para el texto. Se pueden combinar libremente: por ejemplo, Claude para el co-presentador, Piper para la voz y Whisper local para los subtítulos.

---

## Claude (API de Anthropic)

1. Crea una clave en https://console.anthropic.com/settings/keys.
2. En **IA → Texto** elige **Claude**, pega la clave y elige el modelo:
   - **Claude Haiku 5.5**: el más barato ($0,10 / $0,50 por millón de tokens), ideal para el co-presentador.
   - **Claude Sonnet 5.5**: rápido y muy capaz ($2 / $10).
   - **Claude Opus 5.5**: el más capaz ($4 / $20), el predeterminado.
3. Pulsa **Probar conexión**: aparecen también los demás modelos disponibles en tu cuenta.

Notas:
- Se cobra por uso en tu cuenta de Anthropic. Los mensajes que analiza (co-presentador, moderación, traducción) se envían a Anthropic.
- Si Claude prefiere no responder a algo, la API lo reintenta sola con otro modelo de Claude (rescate en el servidor).
- La clave se guarda solo en este PC y nunca se muestra completa en la app ni en el móvil.

## Texto en este PC (llama.cpp)

1. En **IA → Centro de IA** instala **Texto local (llama.cpp)**. La aceleración por defecto es la GPU por Vulkan (NVIDIA, AMD e Intel); con una NVIDIA puedes elegir CUDA (más rápido, unos 600 MB). En Mac usa Metal.
2. Pulsa **Descargar modelos…**: hay recomendados (Qwen 2.5 3B es el punto ideal) y un buscador de Hugging Face con todos los modelos GGUF. Para cada archivo se indica el tamaño y la cuantización; Q4_K_M equilibra calidad y tamaño.
3. En **IA → Texto** elige **En este PC** y el modelo.

El motor se carga solo la primera vez que se usa y queda en memoria; **Liberar memoria** lo cierra (se vuelve a cargar cuando haga falta).

## Voz (Piper o voz del sistema)

- **Voz del sistema**: sin instalar nada (Windows, `say` en macOS, `espeak-ng` en Linux).
- **Piper**: instálalo desde el Centro de IA y descarga voces del catálogo (filtrado por idioma, con calidad y tamaño). Recomendada en español: `es_ES-davefx-medium`.
- **Compatible con OpenAI**: cualquier servidor con `/audio/speech` (Kokoro-FastAPI, LocalAI…).

## Subtítulos (Whisper)

- **Whisper en este PC**: instala **Subtítulos locales (whisper.cpp)** y descarga un modelo (`small` sin GPU potente, `large-v3-turbo-q5_0` con GPU). Con NVIDIA elige la versión CUDA.
- **Servidor compatible con OpenAI**: la API de OpenAI (`https://api.openai.com/v1`, modelo `whisper-1`, con tu clave) o un servidor local como speaches.

## Lo que no está disponible, y por qué

- **Voz con Claude**: la API de Claude solo genera texto.
- **Transcripción con Claude**: la API de Claude no acepta audio.
- **whisper.cpp en Mac**: el proyecto no publica un programa para macOS (solo una librería para apps). En Mac usa un servidor compatible con OpenAI.
- **Motores locales en sistemas sin paquete oficial** (por ejemplo, Windows ARM para llama.cpp): el Centro de IA lo indica y propone alternativas.

Los motores se descargan de sus publicaciones oficiales en GitHub (`ggml-org/llama.cpp`, `ggml-org/whisper.cpp`, `rhasspy/piper`) y los modelos de Hugging Face. Todo se guarda en la carpeta de datos de Vexcast (`…/vexcast/ai`), visible desde el Centro de IA.
