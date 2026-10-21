import vm from "node:vm";
import * as esbuild from "esbuild";
import { Window } from "happy-dom";

export type SmokeResult = {
  passed: boolean;

  errors: string[];

  drawCalls: number;

  loopStarted: boolean;

  durationMs: number;
};

const FRAMES = 60;
const FRAME_INTERVAL_MS = 1000 / 60;

const REAL_DRAW_METHODS = new Set([
  "fillRect",
  "strokeRect",
  "fillText",
  "strokeText",
  "fill",
  "stroke",
  "drawImage",
  "putImageData",
]);

export async function runSmoke(files: Readonly<Record<string, string>>): Promise<SmokeResult> {
  const started = Date.now();
  const errors: string[] = [];

  let bundleJs: string;
  try {
    bundleJs = await bundleAsIife(files);
  } catch (e) {
    return {
      passed: false,
      errors: [`bundle: ${e instanceof Error ? e.message : String(e)}`],
      drawCalls: 0,
      loopStarted: false,
      durationMs: Date.now() - started,
    };
  }

  const ctxCalls: string[] = [];
  let backgroundFillStyle: unknown = null;
  const isBackgroundFill = (args: unknown[], fillStyle: unknown): boolean =>
    args[0] === 0 &&
    args[1] === 0 &&
    typeof args[2] === "number" &&
    typeof args[3] === "number" &&
    fillStyle === backgroundFillStyle;

  const fakeCtx = makeCanvas2DMock(ctxCalls);

  const window = new Window({ url: "http://localhost/" });

  const canvas = window.document.createElement("canvas");
  canvas.id = "canvas";
  (canvas as unknown as { getContext: (type: string) => unknown }).getContext = (type: string) => {
    if (type === "2d") return fakeCtx;
    return null;
  };
  window.document.body.appendChild(canvas);

  let currentTime = 0;
  const rafQueue: Array<(now: number) => void> = [];
  let rafCalls = 0;
  const requestAnimationFrame = (cb: (now: number) => void): number => {
    rafCalls += 1;
    rafQueue.push(cb);
    return rafQueue.length;
  };
  const cancelAnimationFrame = (): void => {};

  const sandboxConsole = {
    ...console,
    error: (...args: unknown[]) => errors.push(`console.error: ${args.map(String).join(" ")}`),
    warn: (...args: unknown[]) => errors.push(`console.warn: ${args.map(String).join(" ")}`),
  };

  (fakeCtx as { __onFillStyleSet?: (v: unknown) => void }).__onFillStyleSet = (v) => {
    if (backgroundFillStyle === null) backgroundFillStyle = v;
  };

  const context = vm.createContext({
    window,
    document: window.document,
    navigator: window.navigator,
    console: sandboxConsole,
    requestAnimationFrame,
    cancelAnimationFrame,
    performance: { now: () => currentTime },
    setTimeout: (cb: () => void, ms = 0) => setTimeout(cb, ms),
    clearTimeout: (id: NodeJS.Timeout) => clearTimeout(id),
    HTMLCanvasElement: window.HTMLCanvasElement,
    Image: window.Image,
    Math,
    Date,
    JSON,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Symbol,
    Error,
    Promise,
    Map,
    Set,
    WeakMap,
    WeakSet,
    globalThis: undefined as unknown,
  });
  (context as { globalThis: unknown }).globalThis = context;
  (context as { self: unknown }).self = context;

  try {
    vm.runInContext(bundleJs, context, { timeout: 5000 });
  } catch (e) {
    errors.push(`eval: ${e instanceof Error ? e.message : String(e)}`);
    return {
      passed: false,
      errors,
      drawCalls: ctxCalls.length,
      loopStarted: rafCalls > 0,
      durationMs: Date.now() - started,
    };
  }

  await new Promise<void>((resolve) => setImmediate(resolve));

  const INPUT_FRAME = 10;
  for (let i = 0; i < FRAMES; i++) {
    currentTime += FRAME_INTERVAL_MS;
    if (i === INPUT_FRAME) {
      dispatchSyntheticInputs(window, canvas);
    }
    const cbs = rafQueue.splice(0, rafQueue.length);
    for (const cb of cbs) {
      try {
        cb(currentTime);
      } catch (e) {
        errors.push(`frame ${i}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  const bgFillCount = (fakeCtx as { __backgroundFillCount?: number }).__backgroundFillCount ?? 0;
  const realDrawCount = ctxCalls.reduce((n, name) => n + (REAL_DRAW_METHODS.has(name) ? 1 : 0), 0);
  const drawCalls = Math.max(0, realDrawCount - bgFillCount);

  const loopStarted = rafCalls > 0;
  if (drawCalls === 0) {
    errors.push(
      loopStarted
        ? "loop ran but no drawing calls recorded - black canvas"
        : "no draws AND no rAF scheduled - page never rendered anything",
    );
  }
  const passed = errors.length === 0 && drawCalls > 0;

  return {
    passed,
    errors,
    drawCalls,
    loopStarted,
    durationMs: Date.now() - started,
  };
}

function dispatchSyntheticInputs(window: any, canvas: any): void {
  try {
    const keyDown = new window.KeyboardEvent("keydown", {
      key: "ArrowRight",
      code: "ArrowRight",
      keyCode: 39,
      bubbles: true,
    });
    window.dispatchEvent(keyDown);
    window.document.dispatchEvent(keyDown);
    const keyUp = new window.KeyboardEvent("keyup", {
      key: "ArrowRight",
      code: "ArrowRight",
      keyCode: 39,
      bubbles: true,
    });
    window.dispatchEvent(keyUp);
    window.document.dispatchEvent(keyUp);
    const mouseTargets = [canvas, window, window.document];
    const mouseInitFields = { bubbles: true, clientX: 400, clientY: 300 };
    for (const type of ["mousedown", "click", "mouseup"]) {
      const ev = new window.MouseEvent(type, mouseInitFields);
      for (const t of mouseTargets) t.dispatchEvent(ev);
    }
    const pointerInitFields = {
      ...mouseInitFields,
      pointerId: 1,
      pointerType: "mouse",
    };
    for (const type of ["pointerdown", "pointerup"]) {
      const Ev =
        (window as { PointerEvent?: typeof window.MouseEvent }).PointerEvent ?? window.MouseEvent;
      const ev = new Ev(type, pointerInitFields);
      for (const t of mouseTargets) t.dispatchEvent(ev);
    }
    const mouseMove = new window.MouseEvent("mousemove", mouseInitFields);
    for (const t of mouseTargets) t.dispatchEvent(mouseMove);
  } catch {
  }
}

export async function bundleAsIife(files: Readonly<Record<string, string>>): Promise<string> {
  const result = await esbuild.build({
    entryPoints: ["main.ts"],
    bundle: true,
    write: false,
    format: "iife",
    target: "es2022",
    plugins: [virtualFsPlugin(files)],
    logLevel: "silent",
  });
  if (result.errors.length > 0) {
    throw new Error(result.errors.map((e) => e.text).join("; "));
  }
  const out = result.outputFiles?.[0]?.text;
  if (!out) throw new Error("esbuild produced no output");
  return out;
}

function virtualFsPlugin(files: Readonly<Record<string, string>>): esbuild.Plugin {
  return {
    name: "virtual-fs",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.path.startsWith(".") || !args.importer) {
          const resolved = args.path.startsWith(".")
            ? normalizeImport(args.path, args.importer)
            : args.path;
          const candidates = [resolved, `${resolved}.ts`, `${resolved}/index.ts`];
          for (const c of candidates) {
            if (c in files) return { path: c, namespace: "virtual" };
          }
          return {
            errors: [
              {
                text: `Cannot resolve "${args.path}" from "${args.importer || "<entry>"}"`,
              },
            ],
          };
        }
        return { path: args.path, external: true };
      });
      build.onLoad({ filter: /.*/, namespace: "virtual" }, (args) => {
        const loader = args.path.endsWith(".json") ? "json" : "ts";
        return { contents: files[args.path], loader };
      });
    },
  };
}

function normalizeImport(spec: string, importer: string): string {
  const importerDir = importer.includes("/") ? importer.slice(0, importer.lastIndexOf("/")) : "";
  const joined = importerDir ? `${importerDir}/${spec}` : spec;
  const parts = joined.split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "" || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return out.join("/");
}

const NOOP_GRADIENT = Object.freeze({ addColorStop: () => {} });
const NOOP_PATTERN = Object.freeze({ setTransform: () => {} });
const EMPTY_TEXT_METRICS = Object.freeze({
  width: 0,
  actualBoundingBoxAscent: 0,
  actualBoundingBoxDescent: 0,
  actualBoundingBoxLeft: 0,
  actualBoundingBoxRight: 0,
  fontBoundingBoxAscent: 0,
  fontBoundingBoxDescent: 0,
  alphabeticBaseline: 0,
  emHeightAscent: 0,
  emHeightDescent: 0,
  hangingBaseline: 0,
  ideographicBaseline: 0,
});

function emptyImageData(
  width: number,
  height: number,
): {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  colorSpace: string;
} {
  const w = Math.max(0, Math.floor(width));
  const h = Math.max(0, Math.floor(height));
  return {
    data: new Uint8ClampedArray(w * h * 4),
    width: w,
    height: h,
    colorSpace: "srgb",
  };
}

const CANVAS2D_RETURN_VALUE_METHODS: Record<string, (...args: unknown[]) => unknown> = {
  createLinearGradient: () => NOOP_GRADIENT,
  createRadialGradient: () => NOOP_GRADIENT,
  createConicGradient: () => NOOP_GRADIENT,
  createPattern: () => NOOP_PATTERN,
  measureText: () => EMPTY_TEXT_METRICS,
  getImageData: (_x, _y, w, h) => emptyImageData(Number(w ?? 0), Number(h ?? 0)),
  createImageData: (...args) => {
    if (args.length === 1 && args[0] && typeof args[0] === "object" && "width" in args[0]) {
      const src = args[0] as { width: unknown; height?: unknown };
      return emptyImageData(Number(src.width), Number(src.height ?? 0));
    }
    return emptyImageData(Number(args[0] ?? 0), Number(args[1] ?? 0));
  },
  isPointInPath: () => false,
  isPointInStroke: () => false,
};

function makeCanvas2DMock(calls: string[]): unknown {
  let fillStyleSink: unknown = null;
  let bgFillCount = 0;
  const stub = new Proxy(
    {
      __backgroundFillCount: 0,
      __onFillStyleSet: undefined as ((v: unknown) => void) | undefined,
    },
    {
      get(target, prop) {
        if (prop === "__backgroundFillCount") return bgFillCount;
        if (prop === "__onFillStyleSet")
          return (target as { __onFillStyleSet?: (v: unknown) => void }).__onFillStyleSet;
        if (prop === "fillStyle" || prop === "strokeStyle" || prop === "lineWidth")
          return fillStyleSink;
        if (prop === "canvas") return { width: 720, height: 1280 };
        const name = String(prop);
        const valueProducer = CANVAS2D_RETURN_VALUE_METHODS[name];
        return (...args: unknown[]) => {
          calls.push(name);
          if (
            name === "fillRect" &&
            args[0] === 0 &&
            args[1] === 0 &&
            typeof args[2] === "number" &&
            typeof args[3] === "number"
          ) {
            bgFillCount += 1;
          }
          return valueProducer ? valueProducer(...args) : undefined;
        };
      },
      set(_target, prop, value) {
        if (prop === "fillStyle") {
          const onSet = (stub as unknown as { __onFillStyleSet?: (v: unknown) => void })
            .__onFillStyleSet;
          if (onSet) onSet(value);
        }
        fillStyleSink = value;
        return true;
      },
    },
  );
  return stub;
}
