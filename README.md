# Cosmic Radio

Listen to space weather and the Deep Space Network as live ambient music.

Cosmic Radio pulls real-time data from spacecraft and instruments (the
DSCOVR and ACE solar-wind monitors at the L1 point, the GOES X-ray and
proton sensors, the planetary Kp index, and the NASA Deep Space Network
antennas talking to Voyager, JWST, Juno and others) and turns it into slow,
evolving music in your browser.

The design rule is that **data never picks a pitch directly**. It steers
key, mode, tempo, density, timbre and texture, and a small music-theory
engine makes sure every note belongs to the current scale. Real changes in
space weather come through as changes in mood: a southward magnetic field
darkens the harmony from Lydian toward Phrygian, a solar flare sets off a
cascade of bells, and a faster solar wind lifts the tempo.

## Run it

```bash
npm start          # http://localhost:8080   (Node 18+, no dependencies)
```

Open the page, press **Tune in**, and give it about 20 seconds to bloom.

- `?sim` starts in simulated mode; `?sim&seed=42` makes the run reproducible.
- When a feed can't be reached, that feed falls back to a realistic simulator
  automatically (the badges show which feeds are live). In simulated mode you
  can trigger a solar flare or a geomagnetic storm on demand.
- Static hosting works too (GitHub Pages and similar): NOAA feeds are then
  fetched directly, since NOAA sends CORS headers. The DSN feed needs the
  bundled proxy (`server.js`), so on static hosting it is simulated.

## How the data becomes music

| Instrument | Measurement | Musical role |
|---|---|---|
| DSCOVR / ACE (L1) | Solar-wind speed | Tempo (56–96 BPM) and filter brightness |
| DSCOVR / ACE | Proton density | How many notes the arpeggio plays |
| DSCOVR / ACE | Plasma temperature | Timbre brightness |
| DSCOVR magnetometer | IMF Bz (north/south) | Mode: Lydian → Ionian → Mixolydian → Dorian → Aeolian → Phrygian |
| DSCOVR magnetometer | Total field Bt | Weight of the drone |
| Ground magnetometers | Kp index | Key (a walk around the circle of fifths) and reverb size |
| GOES XRS | X-ray flux (flare class) | Glass bells; flares set off cascades |
| GOES SEISS | Proton flux | "Solar breath": noise tuned to the chord tones |
| NASA DSN | Active downlinks | One voice per spacecraft. Distance sets the register (Voyager sits deepest), data rate sets how often it plays, light-time sets its echoes, and signal power sets its loudness |

The harmony changes chords every two bars and waits for phrase boundaries
before changing key, so the music modulates the way a composer would rather
than jumping around.

## Layout

```
server.js                 zero-dependency static server + caching feed proxy
public/js/data/           feed config, fetch/fallback hub, parsers, simulator, DSN
public/js/music/          music theory (scales, chords, voice leading) + mapper
public/js/audio/          engine (master chain, reverb, delay), scheduler, harmony
public/js/audio/layers/   drone, pad, arpeggio, spacecraft, bells, texture
public/js/ui/             instrument panel + visualizer
public/js/tools/render.js offline renderer (used by scripts/render-sample.mjs)
docs/BUILD_PLAN.md        the build plan this was made from
```

Adding a sound layer means writing a class that extends `BaseLayer` (see
`layers/arpeggio.js` for an example) and adding it to `layers/index.js`.

## Development

```bash
npm test                                   # unit tests (node:test)
npm run smoke                              # headless Chromium: tunes in and checks that audio flows
node scripts/render-sample.mjs 60 out.wav  # render 60 s offline to a WAV (with a simulated flare and storm)
node scripts/render-sample.mjs 20 pad.wav 7 pad,drone   # solo some layers
```

The smoke test and the renderer use Playwright (`npm i -D playwright`, or a
global install).

## Data credits

NOAA Space Weather Prediction Center (services.swpc.noaa.gov) and NASA/JPL
Deep Space Network Now (eyes.nasa.gov/dsn). Both are public and free, and
neither needs an API key.
