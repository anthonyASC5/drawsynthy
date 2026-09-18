# Draw Synth

A retro paint program that turns vector drawings into looping music. Built with HTML, CSS, vanilla JavaScript, Canvas, Web Audio, and IndexedDB. No runtime dependencies, account, or backend.

## Run

From this directory, run `npm start` (or `python3 -m http.server 8080`), then open **http://localhost:8080**. ES modules require a server; opening `index.html` as a `file://` URL will not work. To deploy, publish this directory from a GitHub Pages branch; all paths are relative and no build is required.

## Play and draw

The first visit opens an editable demo. Press Play, then add your own marks. New creates a blank drawing. Horizontal position is time; vertical position is pitch. Longer strokes sustain and glide, thicker strokes play louder, and opacity adds brightness. The loop is deterministic, including seeded noise and the reverb impulse.

- **Pencil:** quiet sine pluck. **Ink:** bright sawtooth lead.
- **Watercolor:** translucent soft pad. **Marker:** warm triangle sustain.
- **Airbrush:** dotted filtered noise. **Bass:** low sawtooth, monophonic across bass marks.
- **Drums:** kick, snare, closed or open hi-hat. Drag to place a trail.
- **Eraser:** removes intersecting whole vector strokes on the active layer.
- **Select:** drag a rectangle (or click a mark); drag selected artwork to move it. Drag the bottom-right handle to resize. Properties includes duplicate, delete, and move to layer.
- **Line / Shape stamp:** drag from one corner to another to size a shape. Release to place; Select then lets you reposition and resize it. “Place centered” is a keyboard-accessible alternative. Nine shapes include melody and drum patterns.
- **Hand:** pan after zooming. Ctrl/Command + wheel also zooms. Touch: one finger paints, two fingers pan and zoom. Pen pressure controls width and loudness.

Tool properties expose size, opacity, hardness, smoothing, volume, attack, and release where relevant. Expand “Brush & envelope” for advanced settings. Sound properties contain scale, range, effects, and metronome settings. Sliders have adjacent editable number fields. Paper and grid settings never modify notes.

Click a layer name to paint on it. Eye controls only visibility; M mutes, S solos. “Edit layer” renames, adjusts volume, reorders, duplicates, or deletes it. Up to eight layers. Drag the blue Tools or Properties title bar to float that panel on desktop; double-click the title bar to dock again. On smaller screens use the title-bar settings button.

## Images and pitch

Use **Import Image** beside How to play to choose a PNG, JPG, or WebP (up to 30 MB). Detail controls contour resolution and simplification; Edge Threshold selects grayscale boundaries, and Invert reverses light and dark before tracing. Preview, then Import to create editable Ink lines on a new **Image** layer. The image fits the canvas without stretching. Processing stays in the browser; images are never uploaded. Imports require a free layer and stay within the project's stroke and point limits.

Imported lines use the same timing, pitch, selection and erase behavior as drawn lines. Select lines and choose a palette or custom color to recolor them. Import and recoloring support Undo.

Open **Properties → Sound settings → Pitch** to transpose the composition from −24 to +24 semitones. Drag the knob, use arrow keys for single semitones or Page Up/Down for octaves, and double-click to reset to zero. Live playback, WAV, and MIDI use the same transposition, with notes clamped to MIDI pitches 0–127. On MIDI's percussion channel, transposition changes drum note numbers. Pitch is saved with the project; older projects default to zero.

Click or drag the top canvas ruler to seek without drawing. Playback continues from the new position when playing, or stays paused when paused. Focus the ruler and use arrow keys to move by one beat (Shift for a bar), Home for the start, and End for the end. Seeking in a ping-pong loop starts on the forward pass.

## Shortcuts

| Key                      | Action                                       |
| ------------------------ | -------------------------------------------- |
| Space                    | Play / pause                                 |
| Enter                    | Return to loop start                         |
| B / E / L / V / H        | Ink / Eraser / Line / Select / Hand          |
| [ / ]                    | Smaller / larger brush                       |
| Ctrl/Command + Z         | Undo                                         |
| Ctrl/Command + Shift + Z | Redo                                         |
| Ctrl/Command + S         | Save / rename                                |
| Ctrl/Command + A         | Select all                                   |
| Ctrl/Command + D         | Duplicate selection                          |
| Ctrl/Command + N         | New drawing                                  |
| Delete / Backspace       | Delete selection                             |
| Escape                   | Cancel current action / close dialog or menu |

History retains 60 actions. Completed strokes, erase gestures, transforms, stamps, layer changes, and settings changes are reversible. Undo history is session-local.

## Projects and export

Projects auto-save in IndexedDB after changes. File → Open lists saved projects and supports deletion. New and Open save the current project before switching when storage is available. File → Duplicate creates an independent project. Import accepts `.dsy` or JSON files with Draw Synth version 1 data and validates bounds and limits. Export a project file for backups: clearing browser data removes local projects.

- **WAV:** one full loop, 44.1 kHz stereo PCM16, rendered with OfflineAudioContext and the same notes, synths, seeded noise, compressor, and effects as live playback. Ping-pong includes the outward and return passes. Metronome is included when enabled. Short edge fades prevent clicks; release and effect tails beyond the exact loop are trimmed.
- **MIDI:** format 1, 480 ticks per quarter note, tempo and time signature, separate layer tracks, velocity and durations. Drums use channel 10. Pitch glides become successive MIDI notes. MIDI does not contain the exact brush sounds or effects.
- **PNG:** 1800 × 1000 artwork; options to omit grid and paper texture. Visible layers are exported. Viewport zoom, selection handles, and playhead are omitted.
- **Project:** lossless editable `.dsy` JSON with strokes, pressure, brushes, layers, paper, sound, and transport settings.

## Audio timing and limits

A 25 ms scheduler looks 120 ms ahead using the AudioContext clock. The playhead reads that same clock. Each monotonic stroke segment is a continuous voice with frequency automation; overlapping segments form chords. Tempo and composition edits rebase active voices with short fades. On a suspended tab's return the scheduler resumes at the current position and skips missed onsets. Maximum 32 simultaneous instrument voices; older voices yield first. Avoid extremely dense compositions if exact live/offline voice stealing is important.

Modern Chrome, Edge, Firefox, and Safari are recommended. Browser audio starts only after Play or Preview is activated. Device sleep, background audio restrictions, silent mode, and audio-device changes can interrupt playback. WAV export may use substantial memory for slow eight-bar ping-pong loops. IndexedDB may be blocked or temporary in private browsing; use project-file export. Fullscreen and pressure support vary by browser. Mobile settings expose master volume hidden from the compact transport. High-contrast mode is in View. Reduced-motion preferences are respected.

## Verification

`npm test` runs deterministic composition, MIDI/WAV encoding, input validation, and geometry tests with Node's built-in test runner. `npm install` installs development-only tools. With the local server running, `npm run test:browser` runs the browser checks (run `npx playwright install chromium` once if needed). The app itself has no package dependencies.
