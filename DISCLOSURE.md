# Third-Party Disclosure

Per the Garena AI Build Challenge 2026 submission requirements: all third-party libraries,
models, datasets and APIs used in this project.

> Status: maintained as components land. Every dependency added must be recorded here.

## Libraries and frameworks

| Component | Version | Licence | Purpose |
|---|---|---|---|
| Phaser | 3.90.x | MIT | 2D game engine — rendering, physics, scene management |
| Vite | 8.x | MIT | Build tooling and development server |
| TypeScript | 6.x | Apache-2.0 | Language and type checking |

## Models

| Component | Provider | Licence | Purpose | Runs |
|---|---|---|---|---|
| MediaPipe Tasks Vision — Gesture Recognizer | Google | Apache-2.0 | Hand gesture recognition from camera input | On-device, in-browser |
| MediaPipe Tasks Vision — Face Landmarker | Google | Apache-2.0 | Facial blendshape detection (planned) | On-device, in-browser |

Pre-trained models are used as published. No custom training was performed, and no model
weights were modified.

## APIs

| Component | Provider | Purpose | Data sent |
|---|---|---|---|
| **TODO** — LLM API | | Natural-language interpretation of player constraints; composition of tactical presets from an allowlisted grammar | Player-typed text only. No camera data, no gameplay telemetry. |

API credentials are held in server-side environment variables and are never present in client
code or in this repository.

## Datasets

None. No external datasets are used. All measurement data is generated during a session by the
player using the prototype, and is stored only in browser local storage.

## Assets

| Asset | Source | Licence |
|---|---|---|
| **TODO** — record any sprites, fonts or audio used | | |

Where possible the prototype renders primitives programmatically rather than using external art
assets.

## AI-assisted development

Portions of this codebase were developed with AI coding assistants. All code was reviewed by the
team before merging.
