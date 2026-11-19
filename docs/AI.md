# AI in Vexcast

Vexcast can use **Claude** (Anthropic API) or **models that run on your PC**. Everything is configured in **AI → AI hub**: you pick the engine, and whatever is needed (local engines, models, voices) installs with one click. Nothing has to be installed by hand.

| Feature | Claude | On this PC | Where |
|---|---|---|---|
| Co-host that replies to chat | ✅ | ✅ llama.cpp + GGUF model | AI → Text and Co-host |
| AI moderation | ✅ | ✅ | AI → Moderation |
| Caption translation | ✅ | ✅ | AI → Captions |
| Voice (TTS) | ❌ Claude doesn't generate audio | ✅ Piper or system voice | AI → Voice |
| Caption transcription | ❌ The Claude API doesn't transcribe audio | ✅ whisper.cpp | AI → Captions |

Voice and transcription are always handled by another engine, even if you use Claude for text. They can be mixed freely: for example, Claude for the co-host, Piper for the voice and local Whisper for captions.

---

## Claude (Anthropic API)

1. Create a key at https://console.anthropic.com/settings/keys.
2. In **AI → Text**, choose **Claude**, paste the key and pick the model:
   - **Claude Haiku 5.5**: the cheapest ($0.10 / $0.50 per million tokens), ideal for the co-host.
   - **Claude Sonnet 5.5**: fast and very capable ($2 / $10).
   - **Claude Opus 5.5**: the most capable ($4 / $20), the default.
3. Click **Test connection**: the other models available on your account show up too.

Notes:
- Usage is billed to your Anthropic account. The messages it analyzes (co-host, moderation, translation) are sent to Anthropic.
- If Claude declines to answer something, the API automatically retries with another Claude model (server-side fallback).
- The key is stored only on this PC and is never shown in full in the app or on the phone.

## Text on this PC (llama.cpp)

1. In **AI → AI hub**, install **Local text (llama.cpp)**. The default acceleration is GPU via Vulkan (NVIDIA, AMD and Intel); with an NVIDIA card you can choose CUDA (faster, about 600 MB). On Mac it uses Metal.
2. Click **Download models…**: there are recommended models (Qwen 2.5 3B is the sweet spot) and a Hugging Face search covering every GGUF model. Each file shows its size and quantization; Q4_K_M balances quality and size.
3. In **AI → Text**, choose **On this PC** and the model.

The engine loads on first use and stays in memory; **Free memory** shuts it down (it reloads when needed).

## Voice (Piper or system voice)

- **System voice**: nothing to install (Windows, `say` on macOS, `espeak-ng` on Linux).
- **Piper**: install it from the AI hub and download voices from the catalog (filterable by language, with quality and size). Recommended for Spanish: `es_ES-davefx-medium`.
- **OpenAI-compatible**: any server with `/audio/speech` (Kokoro-FastAPI, LocalAI…).

## Captions (Whisper)

- **Whisper on this PC**: install **Local captions (whisper.cpp)** and download a model (`small` without a powerful GPU, `large-v3-turbo-q5_0` with a GPU). With NVIDIA, choose the CUDA build.
- **OpenAI-compatible server**: the OpenAI API (`https://api.openai.com/v1`, model `whisper-1`, with your key) or a local server such as speaches.

## What isn't available, and why

- **Voice with Claude**: the Claude API only generates text.
- **Transcription with Claude**: the Claude API doesn't accept audio.
- **whisper.cpp on Mac**: the project doesn't publish a macOS program (only a library for apps). On Mac, use an OpenAI-compatible server.
- **Local engines on systems without an official package** (for example, Windows ARM for llama.cpp): the AI hub says so and suggests alternatives.

Engines are downloaded from their official GitHub releases (`ggml-org/llama.cpp`, `ggml-org/whisper.cpp`, `rhasspy/piper`) and models from Hugging Face. Everything is stored in the Vexcast data folder (`…/vexcast/ai`), which can be opened from the AI hub.
