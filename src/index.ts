import { defaultFont } from "./font";
import { assert, clamp, getKey, lineToPoints, TextureCache } from "./utils";

/**
 * Utils.
 */
export { assert, clamp };

/**
 * A point in 2D space.
 */
export interface Point {
  x: number;
  y: number;
}

/**
 * An axis aligned rectangle.
 */
export interface Rectangle {
  /**
   * X coordinate of top left of the rectangle.
   */
  x: number;
  /**
   * Y coordinate of top left of the rectangle.
   */
  y: number;
  /**
   * Width of the rectangle.
   */
  w: number;
  /**
   * Height of the rectangle.
   */
  h: number;
}

/**
 * A rectangular slice within an image that defines a sprite.
 *
 * Sprites of this format can be generated by the Aseprite extension in
 * this repo.
 */
export interface Sprite extends Rectangle {
  /**
   * Image url for the sprite.
   */
  url: string;
}

/**
 * A sprite with a "center" region, as defined by Aseprite's slice tool.
 */
export interface NineSliceSprite extends Sprite {
  center: Rectangle;
}

/**
 * A sprite with a "pivot" point, as defined by Aseprite's slice tool.
 */
export interface PivotSprite extends Sprite {
  pivot: Point;
}

/**
 * A keyed collection of sprites.
 */
export interface SpriteSheet {
  [id: string]: Sprite;
}

/**
 * A bitmap font in the format that the engine understands.
 */
export interface Font {
  /**
   * The url of the font's image.
   */
  url: string;
  /**
   * The default width for each glyph, in pixels.
   */
  glyphWidth: number;
  /**
   * The default height for each glyph, in pixels.
   */
  glyphHeight: number;
  /**
   * The height for each line, in pixels.
   */
  lineHeight: number;
  /**
   * Widths for glyphs with variable widths.
   */
  glyphWidthsTable: Record<string, number>;
  /**
   * The number of glyphs that are already colored and should not be recolored
   * when they are rendered. The colored glyph range starts at the beginning of
   * the font.
   *
   * Fonts that are already colored should set this value to Infinity.
   */
  precoloredGlyphs?: number;
}

/**
 * Canvas friendly fill type that can be a color, a gradient object, or a
 * pattern object.
 */
export type Fill = string | CanvasGradient | CanvasPattern;

/**
 * The current drawing state of the engine. This is like an engine specific
 * version of a canvas context, that can be saved/restored on a stack in the
 * same way.
 */
interface DrawState {
  /**
   * The x coordinate of the top left corner of the current view rect.
   */
  x: number;
  /**
   * The y coordinate of the top left corner of the current view rect.
   */
  y: number;
  /**
   * The width of the current view rect.
   */
  w: number;
  /**
   * The height of the current view rect.
   */
  h: number;
  /**
   * The current font.
   */
  font: Font;
  /**
   * The current color/gradient/pattern.
   */
  color: Fill;
  /**
   * The x coordinate of the text cursor.
   */
  textX: number;
  /**
   * The y coordinate of the text cursor.
   */
  textY: number;
  /**
   * The current text shadow color.
   */
  textShadowColor: Fill | undefined;
}

/**
 * A button is either a string representing a key name from a KeyboardEvent
 * (for example `"Enter"`) or the index of a button from a PointerEvent (for
 * example, `0` is a left click/tap).
 *
 * @see {@link Buttons} for an enum of mouse buttons
 */
type Button =
  // A key name from a keyboard event
  | string
  // A button index from a pointer event
  | number;

/**
 * Enumeration of mouse buttons.
 */
export enum Buttons {
  MouseLeft = 0,
  MouseMiddle = 1,
  MouseRight = 2,
  MouseBack = 3,
  MouseForward = 4,
}

/**
 * Internal timer state used by {@see delay}.
 */
interface Timer {
  /**
   * The number of milliseconds this timer should be active for.
   */
  duration: number;
  /**
   * The number of milliseconds that have elapsed on this timer.
   */
  elapsed: number;
  /**
   * The callback to call when the timer has finished.
   */
  done(): void;
}

/**
 * Picks the numeric (tweenable) properties from a given object.
 */
type PickNumeric<T extends Record<any, any>> = {
  [K in keyof T as T[K] extends number ? K : never]: T[K];
};

/**
 * Easing functions describe the curve used for tweens. They will
 * be called repeatedly with values from 0 to 1 and they should return
 * a value in the same domain.
 */
export type Easing = (t: number) => number;

/**
 * Internal tween state used by {@see tween}.
 */
interface Tween {
  object: Record<any, any>;
  to: Record<any, number>;
  from: Record<any, number>;
  keys: string[];
  elapsed: number;
  duration: number;
  easing: Easing;
  callback(t: number): void;
  done(): void;
}

/**
 * Settings that can be passed when starting a new game.
 */
interface Config {
  /**
   * Desired canvas width in pixels (defaults to 320).
   */
  width?: number;
  /**
   * Desired canvas height in pixels (defaults to 180).
   */
  height?: number;
  /**
   * The bitmap font to use for rendering text.
   */
  font?: Font;
  /**
   * The max scaling factor for the canvas when attempting to fill the window.
   */
  maxCanvasScale?: number;
  /**
   * A callback function that will be run once per frame.
   */
  loop?(): void;
}

/**
 * Rendering canvas.
 */
export let canvas = document.createElement("canvas");

/**
 * Rendering context.
 */
export let ctx = canvas.getContext("2d")!;

/**
 * Time between the current frame and the previous frame (in milliseconds).
 */
let _delta = 0;

/**
 * Cache of image objects by urls. Allows code that works with image urls
 * to retrieve the underlying image synchronously.
 */
let _images: Record<string, HTMLImageElement> = {};

/**
 * List of promises representing assets that need to be resolved before the
 * game can start.
 */
let _assets: Promise<any>[] = [];

/**
 * List of currently active timers.
 */
let _timers: Timer[] = [];

/**
 * List of currently active tweens.
 */
let _tweens: Tween[] = [];

/**
 * Handle for the current animation frame for the game's loop. Cancelling this
 * animation frame will stop the game.
 */
let _animationFrame: number;

/**
 * The pointer's current position relative to the canvas.
 */
let _pointer: Point = { x: NaN, y: NaN };

/**
 * The set of buttons that are currently pressed down.
 */
let _down = new Set<Button>();

/**
 * The set of buttons that were pressed during this frame.
 */
let _pressed = new Set<Button>();

/**
 * The set of buttons that were released during this frame.
 */
let _released = new Set<Button>();

/**
 * The max scale factor that the canvas can use when attempting to fill the
 * available screen space.
 */
let _maxCanvasScale = Infinity;

/**
 * A stack of drawing states that can be modified with {@link save} and
 * {@link restore}.
 */
let _stack: DrawState[] = [];

/**
 * The current drawing state. See {@link DrawState} for more detail.
 */
let _state: DrawState = {
  x: 0,
  y: 0,
  w: Infinity,
  h: Infinity,
  color: "black",
  textX: 0,
  textY: 0,
  textShadowColor: undefined,
  font: defaultFont,
};

/**
 * ------
 * Assets
 * ------
 */

/**
 * Get a cached image given its url. Every image passed to {@link preload}
 * will be available here when the game starts.
 */
function imageByUrl(url: string): HTMLImageElement {
  let img = _images[url] ||= new Image();
  img.src ||= url;
  return img;
}

/**
 * Preload a spritesheet's image before starting the game.
 */
export function preload(sprites: SpriteSheet): void;

/**
 * Preload a font's image before starting the game.
 */
export function preload(font: Font): void;

/**
 * Preload an arbitrary image url before starting the game.
 */
export function preload(url: string): void;

/**
 * Wait for a promise to resolve before starting the game.
 */
export function preload(font: Font): void;

export function preload(resource: SpriteSheet | Font | string | Promise<any>): void {
  // Handle fonts
  if (
    typeof resource === "object" &&
    "glyphWidth" in resource &&
    "glyphHeight" in resource
  ) {
    resource = (resource as Font).url;
  }

  // Handle spritesheets
  if (typeof resource === "object" && !(resource instanceof Promise)) {
    let keys = Object.keys(resource);
    resource = resource[keys[0]].url;
  }

  // Handle image urls
  if (typeof resource === "string") {
    let img = imageByUrl(resource);
    resource = new Promise((resolve, reject) => {
      img.addEventListener("load", resolve);
      img.addEventListener("error", reject);
    });
  }

  _assets.push(resource as Promise<any>);
}

/**
 * Returns a promise that resolves when all assets have loaded.
 * @internal
 */
async function waitForAssets() {
  await Promise.all(_assets);
}

/**
 * ------
 * Canvas
 * ------
 */

/**
 * Clear the canvas.
 */
export function clear() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

/**
 * Resize the canvas to a specific resolution.
 *
 * @param w Width in pixels
 * @param h Height in pixels
 */
function resize(w: number, h: number) {
  let scaleX = window.innerWidth / w;
  let scaleY = window.innerHeight / h;
  let scale = Math.min(scaleX, scaleY, _maxCanvasScale);
  canvas.width = w;
  canvas.height = h;
  canvas.style.width = `${w * scale}px`;
  canvas.style.height = `${h * scale}px`;
  canvas.style.imageRendering = "pixelated";
  ctx.imageSmoothingEnabled = false;
}

/**
 * @param x The x coordinate in screen space
 * @param y The y coordinate in screen space
 * @returns The point, relative to the canvas.
 */
function screenToCanvas(x: number, y: number): Point {
  let rect = canvas.getBoundingClientRect();
  let scaleX = canvas.width / rect.width;
  let scaleY = canvas.height / rect.height;
  return {
    x: (x - rect.x) * scaleX,
    y: (y - rect.y) * scaleY,
  };
}

/**
 * -----
 * State
 * -----
 */

/**
 * Push a new state onto the drawing stack.
 */
export function save() {
  ctx.save();
  _stack.push(_state);
  _state = { ..._state };
}

/**
 * Pop a state from the drawing stack.
 */
export function restore() {
  ctx.restore();
  if (_stack.length) {
    _state = _stack.pop()!;
  }
}

/**
 * Set the current font.
 */
export function font(font: Font) {
  _state.font = font;
}

/**
 * Set the current drawing color. This can be a CSS color, a
 * {@link CanvasGradient}, or a {@link CanvasPattern}.
 */
export function color(color: Fill) {
  _state.color = color;
}

/**
 * Sets the text cursor position, color and shadow.
 */
export function cursor(
  x: number,
  y: number,
  col = _state.color,
  shadow = _state.textShadowColor,
) {
  _state.textX = x;
  _state.textY = y;
  _state.color = col;
  _state.textShadowColor = shadow;
}

/**
 * -----
 * Views
 * -----
 */

/**
 * Start drawing a new view. Everything after this call will be drawn relative
 * to this view's coordinates (and this view will be relative to it's parent
 * view if nested).
 *
 * Views are a low level utility for building user interfaces and they make it
 * easy to group and reposition elements together.
 *
 * Use {@link local} to convert global coordinates (e.g. the pointer) to view
 * coordinates.
 *
 * Use {@link global} to convert local coordinates (e.g. relative to the view)
 * to global coordinates.
 *
 * Use {@link end} to finish drawing a view and return to the parent view.
 *
 * @param x The x coordinate of the view (relative to parent view)
 * @param y The y coordinate of the view (relative to the parent view)
 * @param w The width of the view
 * @param h The height of the view
 */
export function view(x: number = 0, y: number = 0, w?: number, h?: number) {
  save();
  ctx.translate(x, y);
  _state.x = _state.x + x;
  _state.y = _state.y + y;
  _state.w = w ?? _state.w;
  _state.h = h ?? _state.h;
}

/**
 * Finish drawing the current view.
 * @see {@link view}
 */
export function end() {
  restore();
}

/**
 * Returns the bounds of the current view (in global coordinates).
 */
export function bounds(): Rectangle {
  return { x: _state.x, y: _state.y, w: _state.w, h: _state.h };
}

/**
 * Converts from global coordinates (relative to the canvas) to local
 * coordinates (relative to the current view).
 * @param globalX A global x coordinate
 * @param globalY A global y coordinate
 * @returns Point in local coordinate space
 */
export function local(globalX: number, globalY: number): Point {
  return {
    x: globalX - _state.x,
    y: globalY - _state.y,
  };
}

/**
 * Converts from local coordinates (relative to the current view) to global
 * coordinates (relative to the canvas).
 * @param localX A local x coordinate
 * @param localY A local y coordinate
 * @returns Point in global coordinate space
 */
export function global(localX: number, localY: number): Point {
  return {
    x: localX + _state.x,
    y: localY + _state.y,
  };
}

/**
 * Returns true if the pointer is over a given rectangle in _local_ coordinate
 * space.
 * @param x The x coordinate for left of the rectangle, in pixels.
 * @param y The y coordinate for the top of the rectangle, in pixels.
 * @param w The width of the rectangle, in pixels.
 * @param h The height of the rectangle, in pixels.
 */
export function over(x: number, y: number, w: number, h: number): boolean {
  let { x: px, y: py } = local(_pointer.x, _pointer.y);
  return px >= x && py >= y && px < x + w && py < y + h;
}

/**
 * ------
 * Timers
 * ------
 */

/**
 * Returns a promise that resolves after a certain amount of time has elapsed.
 */
export function delay(ms: number): Promise<void> {
  return new Promise(done => _timers.push({ duration: ms, elapsed: 0, done }));
}

/**
 * Updates the internal state of all timers.
 */
function updateTimers() {
  for (let timer of _timers) {
    timer.elapsed += _delta;
    if (timer.elapsed >= timer.duration) {
      timer.done();
    }
  }

  _timers = _timers.filter(timer => timer.elapsed < timer.duration);
}

/**
 * -----
 * Input
 * -----
 */

/**
 * Returns the current position of the mouse pointer in integer coordinates
 * relative to the canvas.
 */
export function pointer(): Point {
  return { x: _pointer.x, y: _pointer.y };
}

/**
 * Returns true if the button in question is currently down.
 */
export function down(btn: Button = Buttons.MouseLeft): boolean {
  return _down.has(btn);
}

/**
 * Returns true if the button in question was pressed during this frame.
 */
export function pressed(btn: Button = Buttons.MouseLeft): boolean {
  return _pressed.has(btn);
}

/**
 * Returns true if the button in question was released during this frame.
 */
export function released(btn: Button = Buttons.MouseLeft): boolean {
  return _released.has(btn);
}

function onResize() {
  resize(canvas.width, canvas.height);
}

function onPointerMove(event: PointerEvent) {
  let { x, y } = screenToCanvas(event.clientX, event.clientY);
  _pointer.x = Math.floor(x);
  _pointer.y = Math.floor(y);
}

function onPointerDown(event: PointerEvent) {
  _down.add(event.button);
  _pressed.add(event.button);
}

function onPointerUp(event: PointerEvent) {
  _down.delete(event.button);
  _released.add(event.button);
}

function onKeyDown(event: KeyboardEvent) {
  _down.add(event.key);
  _pressed.add(event.key);
}

function onKeyUp(event: KeyboardEvent) {
  _down.delete(event.key);
  _released.add(event.key);
}

/**
 * Reset input state (usually done at the start of each frame).
 */
function updateInputs() {
  _pressed.clear();
  _released.clear();
}

/**
 * ------
 * Tweens
 * ------
 */

/**
 * Linear easing at a constant speed.
 */
export let easeLinear: Easing = t => t;

/**
 * Eases in and out slowly.
 */
export let easeInOut: Easing = t =>
  (t *= 2) < 1 ? 0.5 * t * t : -0.5 * (--t * (t - 2) - 1);

/**
 * Eases out beyond the end then pulls back.
 */
export let easeOutBack: Easing = t =>
  --t * t * ((1.70158 + 1) * t + 1.70158) + 1;

/**
 * @param object Object to tween
 * @param to Values to tween to
 * @param duration Length of tween in milliseconds
 * @param easing Easing timing function
 * @param callback Callback called once per frame with the tween value.
 * @returns A promise that resolves when the tween is done.
 */
export function tween<
  Target extends Record<any, any>,
  Props extends PickNumeric<Target>,
>(
  object: Target,
  to: Partial<Props>,
  duration: number,
  easing: Easing = easeLinear,
  callback: (t: number) => void = () => {},
): Promise<void> {
  return new Promise(resolve => {
    let keys = Object.keys(to);
    let from: Tween["from"] = {};

    for (let key of keys) {
      from[key] = object[key];
    }

    _tweens.push({
      object,
      to: to as Tween["to"],
      from,
      keys,
      duration,
      elapsed: 0,
      easing,
      callback,
      done: resolve,
    });
  });
}

/**
 * Updates the state of active tweens.
 */
function updateTweens() {
  for (let tween of _tweens) {
    tween.elapsed += _delta;
    let t = clamp(0, 1, tween.elapsed / tween.duration);
    let k = tween.easing(t);

    for (let key of tween.keys) {
      let from = tween.from[key];
      let to = tween.to[key];
      let value = from + (to - from) * k;
      tween.object[key] = value;
    }

    tween.callback(t);

    if (tween.elapsed >= tween.duration) {
      tween.done();
    }
  }

  _tweens = _tweens.filter(tween => tween.elapsed < tween.duration);
}

/**
 * -------
 * Drawing
 * -------
 */

/**
 * Fills a rectangle.
 * @param col The color/fill to fill the rectangle with.
 */
export function fillRect(x: number, y: number, w: number, h: number, col = _state.color) {
  ctx.save();
  ctx.fillStyle = col;
  ctx.fillRect(x | 0, y | 0, w | 0, h | 0);
  ctx.restore();
}

/**
 * Strokes a rectangle.
 * @param col The color/fill to stroke the line with.
 */
export function strokeRect(x: number, y: number, w: number, h: number, col = _state.color) {
  ctx.save();
  ctx.strokeStyle = col;
  ctx.strokeRect((x | 0) + 0.5, (y | 0) + 0.5, w | 0, h | 0);
  ctx.restore();
}

/**
 * Strokes a single pixel line between two points.
 * @param col The color/fill to stroke the line with.
 */
export function line(x1: number, y1: number, x2: number, y2: number, col = _state.color) {
  let points = lineToPoints(x1, y1, x2, y2);
  ctx.save();
  ctx.fillStyle = col;
  ctx.beginPath();
  for (let { x, y } of points) {
    ctx.rect(x, y, 1, 1);
  }
  ctx.fill();
  ctx.restore();
}

/**
 * Cache of stamps we've already rendered before.
 */
let _stampTextureCache = new TextureCache();

/**
 * Draws a monochromatic 5x5 bit pattern. Useful for drawing particles, icons,
 * and other assets that can be defined in code.
 *
 * @param pattern The first 25 bits of this number are treated as pixels in a 5x5 grid.
 * @param x The x coordinate to draw at.
 * @param y The y coordinate to draw the pattern at.
 * @param col The color to fill the pattern with.
 * @see https://0x55.netlify.app An editor for these kinds of patterns
 */
export function stamp(pattern: number, x: number, y: number, col = _state.color) {
  let key = `${pattern}/${getKey(col)}`;

  let rect = _stampTextureCache.findOrCreate(key, () => {
    let canvas = document.createElement("canvas");
    canvas.width = canvas.height = 5;
    let ctx = canvas.getContext("2d")!;

    ctx.beginPath();

    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        let bit = (pattern >> x + y * 5) & 1;
        if (bit) ctx.rect(x, y, 1, 1);
      }
    }

    ctx.fillStyle = col;
    ctx.fill();
    return canvas;
  });

  ctx.drawImage(
    _stampTextureCache.canvas,
    rect.x,
    rect.y,
    rect.w,
    rect.h,
    x,
    y,
    rect.w,
    rect.h,
  );
}

/**
 * -------
 * Sprites
 * -------
 */

/**
 * Draws a sprite at the given coordinates.
 */
export function draw(sprite: Sprite, x: number, y: number, w = sprite.w, h = sprite.h) {
  let { x: sx, y: sy, w: sw, h: sh } = sprite;
  let img = imageByUrl(sprite.url);
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

/**
 * Draws a 9-slice sprite.
 */
export function draw9Slice(
  sprite: NineSliceSprite,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  let { x: sx, y: sy, w: sw, h: sh } = sprite;
  let { x: cx, y: cy, w: cw, h: ch } = sprite.center;

  // Column/row sizes
  let left = cx;
  let top = cy;
  let right = sw - cw - cx;
  let bottom = sh - ch - cy;

  // Minimum dimensions (anything smaller creates rendering glitches)
  w = Math.max(w, left + right) | 0;
  h = Math.max(h, top + bottom) | 0;

  let sx0 = sx;
  let sx1 = sx0 + left;
  let sx2 = sw - right;
  let sy0 = sy;
  let sy1 = sy0 + top;
  let sy2 = sy0 + sh - bottom;
  let dx0 = x;
  let dx1 = dx0 + left;
  let dx2 = dx0 + w - right;
  let dy0 = y;
  let dy1 = dy0 + top;
  let dy2 = dy0 + h - bottom;
  let dcw = w - left - right;
  let dch = h - top - bottom;
  let img = imageByUrl(sprite.url);

  ctx.drawImage(img, sx0, sy0, left, top, dx0, dy0, left, top); // top left
  ctx.drawImage(img, sx2, sy0, right, top, dx2, dy0, right, top); // top right
  ctx.drawImage(img, sx0, sy2, left, bottom, dx0, dy2, left, bottom); // bottom left
  ctx.drawImage(img, sx2, sy2, right, bottom, dx2, dy2, right, bottom); // bottom right
  ctx.drawImage(img, sx1, sy0, cw, top, dx1, dy0, dcw, top); // top
  ctx.drawImage(img, sx1, sy2, cw, bottom, dx1, dy2, dcw, bottom); // bottom
  ctx.drawImage(img, sx0, sy1, left, ch, dx0, dy1, left, dch); // left
  ctx.drawImage(img, sx2, sy1, right, ch, dx2, dy1, right, dch); // right
  ctx.drawImage(img, sx1, sy1, cw, ch, dx1, dy1, dcw, dch); // center
}

/**
 * ----
 * Text
 * ----
 */

/**
 * Measure a string of text. Respects linebreaks, but does no wrapping.
 * @param text The text to measure.
 * @returns The rectangle size required to render this text.
 */
export function measure(text: string, font = _state.font): Rectangle {
  let { glyphWidth, lineHeight, glyphWidthsTable } = font;
  let lineWidth = 0;
  let boxWidth = 0;
  let boxHeight = lineHeight;

  for (let i = 0; i < text.length; i++) {
    let char = text[i];
    if (char === "\n") {
      boxWidth = Math.max(boxWidth, lineWidth);
      boxHeight += lineHeight;
      lineWidth = 0;
    } else {
      lineWidth += glyphWidthsTable[char] ?? glyphWidth;
    }
  }

  // Ensure that the final line fits in the box
  boxWidth = Math.max(boxWidth, lineWidth);

  return { x: 0, y: 0, w: boxWidth, h: boxHeight };
}

/**
 * Cache of text that we've already rendered before.
 */
let _textTextureCache = new TextureCache();

/**
 * Writes text to the canvas using a bitmap font.
 *
 * @param text String of text to write.
 * @param x X coordinate to start writing to.
 * @param y Y coordinate to start writing from.
 * @param color The text color/fill.
 * @param shadow The text shadow color.
 */
export function write(
  text: string,
  x = _state.textX,
  y = _state.textY,
  color = _state.color,
  shadow = _state.textShadowColor,
) {
  let { font } = _state;
  let cursorX = x;
  let cursorY = y;
  let precolorIndex = font.precoloredGlyphs || 0;
  let image = precolorIndex === Infinity ? imageByUrl(font.url) : tint(color);
  let imageShadow = tint(shadow || "transparent");

  for (let i = 0; i < text.length; i++) {
    let char = text[i];

    if (char === "\n") {
      cursorX = x;
      cursorY += font.lineHeight;
      continue;
    }

    let code = char.charCodeAt(0);
    let gw = font.glyphWidth;
    let gh = font.glyphHeight;
    let sx = (code % 16) * gw;
    let sy = ((code / 16) | 0) * gh;
    let dx = cursorX;
    let dy = cursorY;

    if (shadow) {
      ctx.drawImage(imageShadow, sx, sy, gw, gh, dx + 1, dy, gw, gh);
      ctx.drawImage(imageShadow, sx, sy, gw, gh, dx, dy + 1, gw, gh);
      ctx.drawImage(imageShadow, sx, sy, gw, gh, dx + 1, dy + 1, gw, gh);
    }

    // Glyphs below the precolor index are considered to be colored already.
    let img = code < precolorIndex ? imageByUrl(_state.font.url) : image;
    ctx.drawImage(img, sx, sy, gw, gh, dx, dy, gw, gh);

    cursorX += font.glyphWidthsTable[char] ?? gw;
  }

  _state.textX = cursorX + (font.glyphWidthsTable[" "] ?? font.glyphWidth);
  _state.textY = cursorY;
}

/**
 * Writes a line of text to the canvas using a bitmap font.
 *
 * @param text String of text to write.
 * @param x X coordinate to start writing to.
 * @param y Y coordinate to start writing from.
 * @param color The text color/fill.
 * @param shadow The text shadow color.
 */
export function writeLine(
  text: string,
  x = _state.textX,
  y = _state.textY,
  color = _state.color,
  shadow = _state.textShadowColor,
) {
  write(text, x, y, color, shadow);
  _state.textX = x;
  _state.textY += _state.font.lineHeight;
}

/**
 * A cache of recolored font images.
 */
let _tintCanvasCache: Record<string, HTMLCanvasElement> = {};

/**
 * Creates a recolored version of the current font's image.
 */
function tint(col: Fill): HTMLCanvasElement {
  let key = `tint:${_state.font.url}/${getKey(col)}`;
  let canvas = _tintCanvasCache[key];

  if (!canvas) {
    canvas = document.createElement("canvas");
    let ctx = canvas.getContext("2d")!;
    let img = imageByUrl(_state.font.url);
    canvas.width = img.width;
    canvas.height = img.height;

    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = col;
    ctx.fillRect(0, 0, img.width, img.height);
    ctx.drawImage(img, 0, 0);
    ctx.globalCompositeOperation = "destination-atop";
    ctx.drawImage(img, 0, 0);

    _tintCanvasCache[key] = canvas;
  }

  return canvas;
}

/**
 * ----
 * Loop
 * ----
 */

/**
 * Returns the number of milliseconds between the current frame and the
 * previous frame.
 */
export function delta() {
  return _delta;
}

/**
 * Called once per frame to update internal state.
 * @internal
 */
export function _update(dt: number) {
  _delta = dt;
  updateTweens();
  updateTimers();
  updateInputs();
}

/**
 * Resets all internal state, useful for testing.
 * @internal
 */
export function _reset() {
  _images = {};
  _state = _stack[0] || _state;
  _stack = [];
  _assets = [];
  _tweens = [];
  _tintCanvasCache = {};
  _stampTextureCache.clear();
  _textTextureCache.clear();
  _down.clear();
  _pressed.clear();
  _released.clear();
  cancelAnimationFrame(_animationFrame);
  removeEventListeners();
  clear();
}

/**
 * Adds internal event listeners.
 */
function addEventListeners() {
  window.addEventListener("resize", onResize);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
}

/**
 * Removes internal event listeners.
 */
function removeEventListeners() {
  window.removeEventListener("resize", onResize);
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerdown", onPointerDown);
  window.removeEventListener("pointerup", onPointerUp);
  window.removeEventListener("keydown", onKeyDown);
  window.removeEventListener("keyup", onKeyUp);
}

/**
 * Calls {@see _update} and the callback function once per frame.
 * @internal
 */
function startLoop(callback: () => void) {
  let lastFrameTime = 0;

  function loop(time: number) {
    _animationFrame = requestAnimationFrame(loop);
    lastFrameTime = lastFrameTime || time;
    let delta = time - lastFrameTime;
    lastFrameTime = time;
    save();
    callback();
    restore();
    _update(delta);
  }

  requestAnimationFrame(loop);
}

/**
 * Call once to configure, wait for assets to load, then start the update loop.
 */
export async function start({
  width = 320,
  height = 180,
  maxCanvasScale = Infinity,
  font = defaultFont,
  loop,
}: Config = {}) {
  _state.font = font;
  _maxCanvasScale = maxCanvasScale;
  resize(width, height);
  preload(font);
  await waitForAssets();
  addEventListeners();
  if (loop) startLoop(loop);
}
