# Third-Party Disclosure

This document records the third-party libraries, models, datasets, APIs and assets used by the
current Adaptive Input Layer and Swarmfall reference deployment.

## Libraries and frameworks

| Component | Declared version | Licence | Purpose |
|---|---:|---|---|
| MediaPipe Tasks Vision | 0.10.35 | Apache-2.0 | In-browser hand gesture recognition and hand landmarks |
| React / React DOM | 19.2.6 | MIT | Web application and calibration interface |
| React Server DOM Webpack | 19.2.6 | MIT | Vinext server-rendered build runtime |
| Vinext | 1.0.0-beta.4 | MIT | Vite-based Pages Router build and server bundle |
| Vite | 8.1.1 | MIT | Build tooling and development server |
| TypeScript | 6.0.2 | Apache-2.0 | Strictly typed application and middleware code |
| Vite React plugin | 5.1.4 | MIT | React compilation for Vite |
| Vite RSC plugin | 0.5.26 | MIT | React Server Components build integration |
| Cloudflare Vite plugin | 1.50.0 | MIT | Cloudflare-compatible runtime used by the Sites build |

Phaser is not installed or used. Swarmfall renders with the browser Canvas 2D API and HTML/CSS.

## Model

| Component | Provider | Licence | Purpose | Runs |
|---|---|---|---|---|
| MediaPipe Gesture Recognizer, float16 published task model | Google | Apache-2.0 | Recognizes built-in hand gesture categories and supplies hand landmarks used for pointing direction | On-device, in-browser |

No custom model was trained, and the published model weights were not modified. Point direction
is calculated locally from MediaPipe hand landmarks; it does not use a second model.

At runtime the vision channel downloads:

- Pinned MediaPipe WebAssembly runtime:
  `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm`
- Published Gesture Recognizer model:
  `https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task`

Camera frames remain in the browser and are not uploaded to jsDelivr, Google or the deployment
host. Network access is required for the initial runtime/model download unless those files are
self-hosted in a future release.

## APIs and hosted services

No LLM API or other inference API is used by the current build. Natural-language mapping and
strategy generation are deferred.

The public demonstration is hosted through OpenAI Sites. Hosting serves the web application; it
does not receive raw camera frames from MediaPipe processing.

## Datasets and player data

No external dataset is used. Calibration data is created by the player during prompted tests.
Only derived results—such as success count, median latency, false activations and direction
quality—are stored in browser local storage. Raw camera frames are neither persisted nor sent to a
server.

## Assets

No third-party sprites, audio files or web fonts are used. Swarmfall uses programmatically drawn
Canvas 2D shapes, CSS styling and system fonts.

## AI-assisted development

Portions of this codebase were developed with AI coding assistants. Team members remain
responsible for reviewing, testing and accepting the submitted code.
