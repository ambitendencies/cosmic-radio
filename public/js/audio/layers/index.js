// Layer registry. Order = mix order in the UI.
import DroneLayer from './drone.js';
import PadLayer from './pad.js';
import ArpeggioLayer from './arpeggio.js';
import BellsLayer from './bells.js';
import TextureLayer from './texture.js';
import SpacecraftLayer from './spacecraft.js';

export const LAYERS = [DroneLayer, PadLayer, ArpeggioLayer, SpacecraftLayer, BellsLayer, TextureLayer];
