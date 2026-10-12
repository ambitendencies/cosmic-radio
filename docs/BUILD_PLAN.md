# Cosmic Radio — Build Plan

Goal: listen to live data from deep-space instruments, rendered as music that
is pleasant to hear, not just audible.

## 1. Core design principle

Most "sonification" turns a number straight into a frequency and comes out
sounding like a broken theremin. Cosmic Radio does it differently: **data
never picks a pitch directly. It steers musical parameters**, and a small
music-theory engine guarantees that every note is consonant:

| Layer of control | Driven by | Rule that keeps it beautiful |
|---|---|---|
| Key / root | Kp geomagnetic index | Moves along the circle of fifths, only at phrase boundaries |
| Mode (bright ↔ dark) | IMF Bz (north/south magnetic field) | Lydian → Ionian → Mixolydian → Dorian → Aeolian → Phrygian, with hysteresis |
| Tempo | Solar-wind speed | 56–96 BPM, glides slowly |
| Note density | Solar-wind proton density (log) | Notes are gated by probability, never by a raw pulse count |
| Timbre brightness | Speed + temperature | Low-pass cutoff ramps over seconds |
| Tension | Southward Bz + Kp | Adds sus/add9 colour and detune, never dissonant clusters |
| Shimmer / bells | GOES X-ray flux (log, A→X class) | Flares swell into chime cascades drawn from the current chord |
| Texture | GOES proton flux | Quiet filtered-noise "solar breath" |
| Spacecraft voices | NASA Deep Space Network, live | Each spacecraft talking to Earth gets a voice: distance sets register and echo, data rate sets note rate, signal power sets loudness |
| Space / reverb | Kp (aurora) | More disturbed sky means a bigger, more open room |

Every parameter is smoothed: values ramp over seconds, and harmony changes on
bar lines. The result is slow, evolving ambient music where real changes in
space weather can be heard as changes in mood.

## 2. Data sources (all free, no API keys)

| Feed | Instrument | URL |
|---|---|---|
| Solar-wind plasma | NOAA DSCOVR / ACE at the L1 point, 1.5M km away | `services.swpc.noaa.gov/products/solar-wind/plasma-2-hour.json` |
| Interplanetary magnetic field | DSCOVR magnetometer | `services.swpc.noaa.gov/products/solar-wind/mag-2-hour.json` |
| X-ray flux | GOES-16/18 XRS | `services.swpc.noaa.gov/json/goes/primary/xrays-6-hour.json` |
| Proton flux | GOES SEISS | `services.swpc.noaa.gov/json/goes/primary/integral-protons-6-hour.json` |
| Kp index | Ground magnetometer network | `services.swpc.noaa.gov/products/noaa-planetary-k-index.json` |
| Deep Space Network | DSN antennas talking to Voyager 1/2, JWST, Juno, etc. | `eyes.nasa.gov/dsn/data/dsn.xml` |

## 3. Architecture

```
 NOAA SWPC / NASA DSN
        │  (HTTP, polled every 60 s)
        ▼
 server.js ── zero-dependency Node proxy + static server, with caching and CORS handling
        │  /api/feeds/:id
        ▼
 Browser
  data/feeds.js      fetch: proxy → direct → simulator fallback
  data/parsers.js    raw feeds → normalized SpaceState      (pure, unit-tested)
  data/simulator.js  plausible synthetic space weather for offline use and demos
  music/theory.js    scales, modes, chords, quantizer           (pure, unit-tested)
  music/mapper.js    SpaceState → MusicalParams                 (pure, unit-tested)
  audio/engine.js    AudioContext, master bus, reverb, delay, limiter, analyser
  audio/scheduler.js look-ahead clock (16th-note grid)
  audio/harmony.js   live key, mode and chord progression shared by every layer
  audio/layers/*     drone, pad, arpeggio, bells, texture, spacecraft
  ui/*               controls, data readouts, visualizer
```

No build step and no npm dependencies: `npm start`, then open the browser.

### Layer contract
Each sound layer is a class in `public/js/audio/layers/` that implements:

```js
export default class MyLayer {
  static id = 'my-layer'; static label = 'My Layer';
  constructor(engine)       // engine.ctx, engine.bus, engine.reverbSend, engine.delaySend, engine.harmony
  start(time)               // build nodes and fade in
  stop(time)                // fade out and disconnect
  update(params, state)     // called when new MusicalParams arrive (~every 2 s)
  onStep(step, time, ctx)   // called on every 16th note; ctx = { bar, beat, secondsPerStep }
  setEnabled(on)            // mute toggle (output gain ramp)
}
```
Layers register in `public/js/audio/layers/index.js`.

## 4. Phases and owners

### Phase 1: foundation (Opus 5.5, main session)
1. Repo scaffold, `package.json`, zero-dependency `server.js` with a feed proxy and cache
2. Shared feed config, fetcher with a three-level fallback, normalized `SpaceState`
3. SWPC parsers (plasma, mag, Kp, X-ray, protons) that handle both array and object formats
4. Simulator that drifts realistically and fires occasional flares and storms
5. Music theory core, plus the mapper from SpaceState to MusicalParams
6. Audio engine: master chain (HPF → bus → compressor → soft clip → limiter), generated convolution reverb, ping-pong delay, analyser
7. Look-ahead scheduler and shared harmony (chord progression in the current mode)
8. First layers: **Drone** (from solar wind and field strength), **Pad** (chord voicing with voice leading), **Arpeggio** (wind-driven pluck)
9. Minimal UI: Tune In button, source badge, volume, per-layer toggles, data readout
10. Unit tests (`node --test`) and a headless-browser smoke test

### Phase 2: parallel expansion (Sonnet 5.5 sub-agents)
Each agent owns separate files so they can work in parallel:
- **Agent A: Deep Space Network voices.** Pure DSN XML parser with tests, simulated DSN fleet, `spacecraft` layer (one bell/FM voice per active downlink; light-time distance → register and echo)
- **Agent B: Solar flare bells and proton texture.** `bells` layer (X-ray class → chime cascades, with flare-onset detection) and `texture` layer (proton flux → filtered-noise breath)
- **Agent C: Visualizer and data panel.** Canvas visualizer (starfield, spectrum ring, a pulse per spacecraft), plus an instrument panel that shows each value and what it is controlling musically

### Phase 3: integration and verification (Opus 5.5)
Register the new layers, review the agents' code, run all tests and the
headless smoke test, render an offline audio sample, write the README.

## 5. Acceptance criteria
- `npm start` serves the app; `npm test` passes
- Works live (proxy) and falls back to simulation without errors when offline
- Every pitch produced comes from the current scale (enforced by tests)
- No clipping: master limiter, conservative gain staging
- Changing data audibly changes mood within about 10 s, but nothing jumps abruptly
