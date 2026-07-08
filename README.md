# AudioMass AI

[![CI](https://github.com/anton-karlovskiy/AudioMassAI/actions/workflows/ci.yml/badge.svg)](https://github.com/anton-karlovskiy/AudioMassAI/actions/workflows/ci.yml)

Free, full-featured, web-based audio & waveform editor — with in-browser AI transcription and summarization. Everything runs client-side: no backend, no uploads, no plugins.

Based on [AudioMass](https://audiomass.co) by Pantelis Kalogiros, extended with AI features and modernized tooling.

## Features

- Waveform editing: cut / copy / paste / trim, multi-level undo & redo, per-channel editing, zoom & pan, region selection
- Effects with live preview and presets: gain, fade in/out, normalize, compressor, graphic & paragraphic EQ, delay, reverb, distortion, hard limiter, speed/rate change, reverse, invert, RNNoise noise reduction
- Recording from the microphone (with automatic resampling)
- Import mp3 / wav / ogg / flac / aiff — from disk, drag-and-drop, or URL; export to MP3, WAV, or FLAC (encoded in web workers)
- ID3v2 / MP4 metadata reader, frequency & spectrum analyzer (docked or pop-out), local session drafts in IndexedDB (LZ4-compressed)
- **AI transcription** (Whisper via transformers.js, fully in-browser) and **AI summarization** (Chrome's built-in Summarizer API, with a DistilBART worker fallback for other browsers)

## Getting started

Requires Node 20.19+ or 22.12+, and [pnpm](https://pnpm.io) (run `corepack enable` and pnpm will be picked up automatically from the `packageManager` field below).

```bash
pnpm install
pnpm dev      # dev server at http://localhost:5055
```

Other scripts:

```bash
pnpm build       # production build to dist/
pnpm preview     # serve the production build locally
pnpm lint        # eslint
pnpm format      # prettier
pnpm test        # unit tests (Vitest + jsdom)
pnpm test:e2e    # end-to-end tests (Playwright; needs `pnpm exec playwright install chromium` once)
```

## Testing

- `tests/unit/` — Vitest + jsdom tests for the framework-free building blocks: the event bus, undo/redo history, modals, keyboard shortcuts, context menu and toasts.
- `tests/e2e/` — Playwright tests that drive the real app in Chromium: boot, sample loading, playback, cut/paste/undo buffer edits, effect application, and the effect/export dialogs. The Playwright config starts the Vite dev server automatically.
- CI (`.github/workflows/ci.yml`) runs lint, a format check, the unit suite, a production build, and the E2E suite on every pull request.

## Project structure

```
index.html            Entry page (Vite root); loads vendor globals + src/main.js
src/
  main.js             Entry point: creates and mounts the AudioEditor
  core/
    audio-editor.js   Editor core: event bus + subsystem wiring
    undo-history.js   Undo/redo stacks for destructive edits
  audio/
    audio-engine.js   wavesurfer wrapper; translates app events into audio work
    audio-utils.js    Buffer surgery, FX bank, preview/offline rendering, export
    recorder.js       getUserMedia recording with live waveform preview
    id3-reader.js     ID3v2 + MP4 metadata parsers
  ui/
    editor-ui.js      Menus, toolbar, footer, context menu, drag & drop
    effects-ui.js     One dialog per effect + preset storage + analyzer windows
    modals.js         SimpleModal + AudioEffectModal (preview/preset plumbing)
    keyboard-shortcuts.js, context-menu.js, drag-drop.js, toast.js, welcome-modal.js
  effects/
    paragraphic-eq.js Canvas EQ curve editor dialog
    tempo-tools.js    Beat/tempo analysis dialog
    recording-modal.js "New recording" dialog
  features/
    transcription.js  AI transcription & summarization feature
  storage/
    local-sessions.js IndexedDB session drafts (LZ4-compressed)
  styles/             main.css + icon font
public/
  vendor/             Third-party libraries served as-is (see note below)
  workers/            Web workers: mp3/wav/flac encoders, Whisper, DistilBART
  about.html, eq.html, sp.html, samples/, images/, icons
tests/
  unit/               Vitest + jsdom tests
  e2e/                Playwright tests
```

### Architecture notes

- Subsystems communicate through a small pub/sub **event bus** on the editor instance (`fireEvent` / `listenFor`). UI code fires `Request*` events; the engine performs the work and fires `Did*` events back.
- The **wavesurfer 2.0.5 build in `public/vendor/` is patched** by the original AudioMass author and calls back into the editor through the `window.PKAudioEditor` global (set in `src/main.js`). It cannot be replaced with the npm package, which is why it is loaded as a classic script rather than bundled.
- Encoding (lamejs, libflac) and AI inference (transformers.js) run in **web workers** under `public/workers/`, keeping heavy work off the main thread and out of the app bundle. The AI workers load their models at runtime.
- The AI **summarization** feature prefers Chrome's built-in Summarizer API and falls back to an in-browser DistilBART model elsewhere (behind a download confirmation, ~284 MB).

## Browser support

Modern evergreen browsers. The AI transcription runs anywhere transformers.js does; built-in summarization requires Chrome/Edge with the Summarizer API, other browsers use the bundled fallback model.

## License

MIT — original AudioMass code © Pantelis Kalogiros.
