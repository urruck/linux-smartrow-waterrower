// Capacitor et ses greffons, chargés par des <script> classiques (www/lib/,
// copiés de node_modules par construire_www.mjs) : pas d'outil d'assemblage,
// la construction ne demande que Node.js (utile pour F-Droid).
const g = window;
export const { Capacitor, registerPlugin } = g.capacitorExports;
export const { App } = g.capacitorApp;
export const { BleClient } = g.capacitorCommunityBluetoothLe;
export const { KeepAwake } = g.capacitorKeepAwake;
export const { TextToSpeech } = g.capacitorTextToSpeech;
export const { Directory, Encoding, Filesystem } = g.capacitorFilesystemPluginCapacitor;
export const { Share } = g.capacitorShare;
/** Course à pied : greffon propre à l'application (android/…/CourseGpsPlugin.java). */
export const CourseGps = registerPlugin("CourseGps");
