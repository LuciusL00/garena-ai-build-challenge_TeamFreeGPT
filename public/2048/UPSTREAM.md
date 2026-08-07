# Upstream 2048 source

This directory contains an unchanged subset of Gabriele Cirulli's 2048 source code.

- Repository: <https://github.com/gabrielecirulli/2048>
- Pinned commit: `478b6ec346e3787f589e4af751378d06ded4cbbc`
- Licence: MIT; see `LICENSE.txt` in this directory.
- Imported unchanged: `tile.js`, `grid.js`, `html_actuator.js`, `game_manager.js`.
- Intentionally excluded: the original keyboard/touch input manager, application bootstrap,
  polyfills, fonts and metadata.

The TeamFreeGPT host adapter supplies input through the public Adaptive Input API. The imported
game manager receives only its existing semantic `move(direction)` event.
