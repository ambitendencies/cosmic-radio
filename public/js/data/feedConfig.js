// Shared by the browser and server.js. Every feed is free and needs no key.

export const FEEDS = {
  plasma: {
    url: 'https://services.swpc.noaa.gov/products/solar-wind/plasma-2-hour.json',
    type: 'json',
    label: 'Solar wind plasma (DSCOVR/ACE @ L1)',
  },
  mag: {
    url: 'https://services.swpc.noaa.gov/products/solar-wind/mag-2-hour.json',
    type: 'json',
    label: 'Interplanetary magnetic field (DSCOVR)',
  },
  xray: {
    url: 'https://services.swpc.noaa.gov/json/goes/primary/xrays-6-hour.json',
    type: 'json',
    label: 'X-ray flux (GOES XRS)',
  },
  protons: {
    url: 'https://services.swpc.noaa.gov/json/goes/primary/integral-protons-6-hour.json',
    type: 'json',
    label: 'Proton flux (GOES SEISS)',
  },
  kp: {
    url: 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json',
    type: 'json',
    label: 'Planetary Kp index',
  },
  dsn: {
    url: 'https://eyes.nasa.gov/dsn/data/dsn.xml',
    type: 'text',
    label: 'NASA Deep Space Network',
    // The DSN feed is aggressively cached upstream; a cache-buster keeps it live.
    cacheBust: true,
  },
};

export const POLL_INTERVAL_MS = 60_000;
