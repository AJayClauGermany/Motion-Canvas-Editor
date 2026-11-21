import type {Vec} from './vec';

// Directions (y is up, as in Manim; the renderer flips it for the canvas).
export const ORIGIN: Vec = [0, 0, 0];
export const UP: Vec = [0, 1, 0];
export const DOWN: Vec = [0, -1, 0];
export const RIGHT: Vec = [1, 0, 0];
export const LEFT: Vec = [-1, 0, 0];
export const IN: Vec = [0, 0, -1];
export const OUT: Vec = [0, 0, 1];
export const UL: Vec = [-1, 1, 0];
export const UR: Vec = [1, 1, 0];
export const DL: Vec = [-1, -1, 0];
export const DR: Vec = [1, -1, 0];
export const X_AXIS: Vec = [1, 0, 0];
export const Y_AXIS: Vec = [0, 1, 0];
export const Z_AXIS: Vec = [0, 0, 1];

export const PI = Math.PI;
export const TAU = 2 * Math.PI;
export const DEGREES = TAU / 360;

export const SMALL_BUFF = 0.1;
export const MED_SMALL_BUFF = 0.25;
export const MED_LARGE_BUFF = 0.5;
export const LARGE_BUFF = 1;
export const DEFAULT_MOBJECT_TO_EDGE_BUFFER = MED_LARGE_BUFF;
export const DEFAULT_MOBJECT_TO_MOBJECT_BUFFER = MED_SMALL_BUFF;
export const DEFAULT_STROKE_WIDTH = 4;
export const DEFAULT_FONT_SIZE = 48;
export const DEFAULT_DOT_RADIUS = 0.08;
export const DEFAULT_SMALL_DOT_RADIUS = 0.04;
export const DEFAULT_ARROW_TIP_LENGTH = 0.35;

/** Scene-wide configuration, mirroring Manim's `config`. */
export const config = {
  frameHeight: 8,
  frameWidth: (8 * 16) / 9,
  pixelHeight: 1080,
  pixelWidth: 1920,
  frameRate: 30,
  backgroundColor: '#000000',
  get frame_height() {
    return this.frameHeight;
  },
  get frame_width() {
    return this.frameWidth;
  },
  get pixel_height() {
    return this.pixelHeight;
  },
  get pixel_width() {
    return this.pixelWidth;
  },
  get frame_rate() {
    return this.frameRate;
  },
  get background_color() {
    return this.backgroundColor;
  },
  set background_color(v: string) {
    this.backgroundColor = v;
  },
  /** Pixels per Manim unit. */
  get unit() {
    return this.pixelHeight / this.frameHeight;
  },
};

// Manim Community colour palette.
export const WHITE = '#FFFFFF';
export const GRAY_A = '#DDDDDD';
export const GRAY_B = '#BBBBBB';
export const GRAY_C = '#888888';
export const GRAY_D = '#444444';
export const GRAY_E = '#222222';
export const BLACK = '#000000';
export const LIGHTER_GRAY = GRAY_A;
export const LIGHT_GRAY = GRAY_B;
export const GRAY = GRAY_C;
export const DARK_GRAY = GRAY_D;
export const DARKER_GRAY = GRAY_E;
export const GREY_A = GRAY_A;
export const GREY_B = GRAY_B;
export const GREY_C = GRAY_C;
export const GREY_D = GRAY_D;
export const GREY_E = GRAY_E;
export const GREY = GRAY;
export const LIGHT_GREY = LIGHT_GRAY;
export const DARK_GREY = DARK_GRAY;
export const LIGHTER_GREY = LIGHTER_GRAY;
export const DARKER_GREY = DARKER_GRAY;
export const BLUE_A = '#C7E9F1';
export const BLUE_B = '#9CDCEB';
export const BLUE_C = '#58C4DD';
export const BLUE_D = '#29ABCA';
export const BLUE_E = '#236B8E';
export const PURE_BLUE = '#0000FF';
export const BLUE = BLUE_C;
export const DARK_BLUE = BLUE_E;
export const TEAL_A = '#ACEAD7';
export const TEAL_B = '#76DDC0';
export const TEAL_C = '#5CD0B3';
export const TEAL_D = '#55C1A7';
export const TEAL_E = '#49A88F';
export const TEAL = TEAL_C;
export const GREEN_A = '#C9E2AE';
export const GREEN_B = '#A6CF8C';
export const GREEN_C = '#83C167';
export const GREEN_D = '#77B05D';
export const GREEN_E = '#699C52';
export const PURE_GREEN = '#00FF00';
export const PURE_CYAN = '#00FFFF';
export const PURE_MAGENTA = '#FF00FF';
export const PURE_YELLOW = '#FFFF00';
export const GREEN = GREEN_C;
export const YELLOW_A = '#FFF1B6';
export const YELLOW_B = '#FFEA94';
export const YELLOW_C = '#F7D96F';
export const YELLOW_D = '#F4D345';
export const YELLOW_E = '#E8C11C';
export const YELLOW = YELLOW_C;
export const GOLD_A = '#F7C797';
export const GOLD_B = '#F9B775';
export const GOLD_C = '#F0AC5F';
export const GOLD_D = '#E1A158';
export const GOLD_E = '#C78D46';
export const GOLD = GOLD_C;
export const RED_A = '#F7A1A3';
export const RED_B = '#FF8080';
export const RED_C = '#FC6255';
export const RED_D = '#E65A4C';
export const RED_E = '#CF5044';
export const PURE_RED = '#FF0000';
export const RED = RED_C;
export const MAROON_A = '#ECABC1';
export const MAROON_B = '#EC92AB';
export const MAROON_C = '#C55F73';
export const MAROON_D = '#A24D61';
export const MAROON_E = '#94424F';
export const MAROON = MAROON_C;
export const PURPLE_A = '#CAA3E8';
export const PURPLE_B = '#B189C6';
export const PURPLE_C = '#9A72AC';
export const PURPLE_D = '#715582';
export const PURPLE_E = '#644172';
export const PURPLE = PURPLE_C;
export const PINK = '#D147BD';
export const LIGHT_PINK = '#DC75CD';
export const ORANGE = '#FF862F';
export const LIGHT_BROWN = '#CD853F';
export const DARK_BROWN = '#8B4513';
export const GRAY_BROWN = '#736357';
export const GREY_BROWN = GRAY_BROWN;
export const LOGO_WHITE = '#ECE7E2';
export const LOGO_GREEN = '#87C2A5';
export const LOGO_BLUE = '#525893';
export const LOGO_RED = '#E07A5F';
export const LOGO_BLACK = '#343434';
