import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = join(root, "public", "brand-kit", "animation");
const frameRoot = mkdtempSync(join(tmpdir(), "libretto-brand-kit-frames-"));
const asciihedronFrameDir = join(frameRoot, "asciihedron");
const logoFrameDir = join(frameRoot, "logo");
const host = "127.0.0.1";
const port = 5198;
const frameRate = 24;
const asciihedronFrameCount = 419;
const asciihedronFrameStepMs = (Math.PI * 2) / 0.00036 / asciihedronFrameCount;
const logoFrameCount = 240;
const logoFrameStepMs = 360 / 0.035 / logoFrameCount;
const size = 1024;

mkdirSync(outputDir, { recursive: true });
mkdirSync(asciihedronFrameDir, { recursive: true });
mkdirSync(logoFrameDir, { recursive: true });

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: ["ignore", "inherit", "inherit"],
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
      }
    });
  });
}

function stopProcessTree(child) {
  if (!child.pid || child.exitCode !== null) {
    return;
  }

  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until Vite is ready.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

const server = spawn(
  "pnpm",
  ["-s", "exec", "vp", "dev", "--host", host, "--port", String(port)],
  {
    cwd: root,
    detached: true,
    stdio: ["ignore", "ignore", "inherit"],
  },
);

try {
  await waitForServer(`http://${host}:${port}/brand-kit.html`);

  const browser = await chromium.launch();
  const page = await browser.newPage({
    deviceScaleFactor: 1,
    viewport: { width: 1280, height: 1280 },
  });

  await page.addInitScript(() => {
    let animationTime = 0;
    let nextFrameId = 1;
    let callbacks = [];

    window.requestAnimationFrame = (callback) => {
      const id = nextFrameId;
      nextFrameId += 1;
      callbacks.push({ callback, id });
      return id;
    };

    window.cancelAnimationFrame = (id) => {
      callbacks = callbacks.filter((entry) => entry.id !== id);
    };

    window.__advanceBrandKitFrame = (deltaMs) => {
      animationTime += deltaMs;
      const pending = callbacks;
      callbacks = [];
      for (const { callback } of pending) {
        callback(animationTime);
      }
    };
  });

  await page.goto(`http://${host}:${port}/brand-kit.html`, {
    waitUntil: "networkidle",
  });

  await page.locator("canvas").waitFor();
  await page.evaluate((canvasSize) => {
    const canvas = document.querySelector("canvas");
    const container = canvas?.parentElement;
    if (!canvas || !container) {
      throw new Error("Solid icosahedron canvas was not mounted.");
    }
    container.style.width = `${canvasSize}px`;
    container.style.height = `${canvasSize}px`;
    container.style.minWidth = `${canvasSize}px`;
    container.style.minHeight = `${canvasSize}px`;
    container.style.maxWidth = `${canvasSize}px`;
    container.style.maxHeight = `${canvasSize}px`;
    canvas.style.width = `${canvasSize}px`;
    canvas.style.height = `${canvasSize}px`;
    canvas.style.minWidth = `${canvasSize}px`;
    canvas.style.minHeight = `${canvasSize}px`;
    canvas.style.maxWidth = `${canvasSize}px`;
    canvas.style.maxHeight = `${canvasSize}px`;
  }, size);
  await page.getByRole("checkbox", { name: "Still" }).uncheck();
  await page.evaluate(() => window.__advanceBrandKitFrame(16));

  for (let frame = 0; frame < logoFrameCount; frame += 1) {
    await page.evaluate((deltaMs) => window.__advanceBrandKitFrame(deltaMs), logoFrameStepMs);
    const dataUrl = await page.evaluate(() => {
      const canvas = document.querySelector("canvas");
      if (!canvas) {
        throw new Error("Solid icosahedron canvas was not mounted.");
      }
      return canvas.toDataURL("image/png");
    });
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
    writeFileSync(
      join(logoFrameDir, `frame-${String(frame).padStart(4, "0")}.png`),
      Buffer.from(base64, "base64"),
    );
  }

  await page.getByRole("button", { name: "Asciihedron" }).click();
  await page.getByRole("checkbox", { name: "Still" }).uncheck();
  await page.locator("canvas").waitFor();
  await page.evaluate((canvasSize) => {
    const canvas = document.querySelector("canvas");
    const container = canvas?.parentElement;
    if (!canvas || !container) {
      throw new Error("Asciihedron canvas was not mounted.");
    }
    container.style.width = `${canvasSize}px`;
    container.style.height = `${canvasSize}px`;
    container.style.minWidth = `${canvasSize}px`;
    container.style.minHeight = `${canvasSize}px`;
    container.style.maxWidth = `${canvasSize}px`;
    container.style.maxHeight = `${canvasSize}px`;
  }, size);

  await page.evaluate(() => window.__advanceBrandKitFrame(16));

  for (let frame = 0; frame < asciihedronFrameCount; frame += 1) {
    await page.evaluate((deltaMs) => window.__advanceBrandKitFrame(deltaMs), asciihedronFrameStepMs);
    const dataUrl = await page.evaluate(() => {
      const canvas = document.querySelector("canvas");
      if (!canvas) {
        throw new Error("Asciihedron canvas was not mounted.");
      }
      return canvas.toDataURL("image/png");
    });
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
    writeFileSync(
      join(asciihedronFrameDir, `frame-${String(frame).padStart(4, "0")}.png`),
      Buffer.from(base64, "base64"),
    );
  }

  await browser.close();

  const asciihedronFramePattern = join(asciihedronFrameDir, "frame-%04d.png");
  const logoFramePattern = join(logoFrameDir, "frame-%04d.png");
  await run("ffmpeg", [
    "-y",
    "-framerate",
    String(frameRate),
    "-i",
    logoFramePattern,
    "-vf",
    "format=yuv420p",
    "-c:v",
    "libx264",
    "-movflags",
    "+faststart",
    "-an",
    join(outputDir, "libretto-icosahedron-logo-loop.mp4"),
  ]);
  await run("ffmpeg", [
    "-y",
    "-framerate",
    String(frameRate),
    "-i",
    asciihedronFramePattern,
    "-vf",
    "format=rgba",
    "-c:v",
    "libvpx-vp9",
    "-pix_fmt",
    "yuva420p",
    "-auto-alt-ref",
    "0",
    "-an",
    join(outputDir, "libretto-asciihedron-loop.webm"),
  ]);
  await run("ffmpeg", [
    "-y",
    "-framerate",
    String(frameRate),
    "-i",
    asciihedronFramePattern,
    "-vf",
    "format=yuv420p",
    "-c:v",
    "libx264",
    "-movflags",
    "+faststart",
    "-an",
    join(outputDir, "libretto-asciihedron-loop.mp4"),
  ]);
  await run("ffmpeg", [
    "-y",
    "-i",
    join(outputDir, "libretto-asciihedron-loop.mp4"),
    "-vcodec",
    "libwebp",
    "-vf",
    "fps=12,scale=512:512:flags=lanczos",
    "-lossless",
    "0",
    "-compression_level",
    "4",
    "-q:v",
    "75",
    "-loop",
    "0",
    "-preset",
    "default",
    "-an",
    "-vsync",
    "0",
    join(outputDir, "libretto-asciihedron-loop.webp"),
  ]);
  await run("ffmpeg", [
    "-y",
    "-i",
    join(outputDir, "libretto-icosahedron-logo-loop.mp4"),
    "-c:v",
    "libvpx-vp9",
    "-pix_fmt",
    "yuva420p",
    "-auto-alt-ref",
    "0",
    "-an",
    join(outputDir, "libretto-icosahedron-logo-loop.webm"),
  ]);
  await run("ffmpeg", [
    "-y",
    "-i",
    join(outputDir, "libretto-icosahedron-logo-loop.mp4"),
    "-vcodec",
    "libwebp",
    "-vf",
    "fps=12,scale=512:512:flags=lanczos",
    "-lossless",
    "0",
    "-compression_level",
    "4",
    "-q:v",
    "78",
    "-loop",
    "0",
    "-preset",
    "default",
    "-an",
    "-vsync",
    "0",
    join(outputDir, "libretto-icosahedron-logo-loop.webp"),
  ]);

  console.log(`Rendered ${join(outputDir, "libretto-asciihedron-loop.webm")}`);
  console.log(`Rendered ${join(outputDir, "libretto-asciihedron-loop.mp4")}`);
  console.log(`Rendered ${join(outputDir, "libretto-asciihedron-loop.webp")}`);
  console.log(`Rendered ${join(outputDir, "libretto-icosahedron-logo-loop.mp4")}`);
  console.log(`Rendered ${join(outputDir, "libretto-icosahedron-logo-loop.webm")}`);
  console.log(`Rendered ${join(outputDir, "libretto-icosahedron-logo-loop.webp")}`);
} finally {
  stopProcessTree(server);
  rmSync(frameRoot, { force: true, recursive: true });
}
