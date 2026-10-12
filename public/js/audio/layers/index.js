// Layer registry. Order = mix order in the UI.
import DroneLayer from './drone.js';
import PadLayer from './pad.js';
import ArpeggioLayer from './arpeggio.js';

export const LAYERS = [DroneLayer, PadLayer, ArpeggioLayer];
