import { useEffect, useRef } from "react";

const VERTEX = `
attribute vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

const FRAGMENT = `
precision mediump float;
uniform vec2 uResolution;
uniform float uDprY;
uniform float uTime;

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  uv.y = 1.0 - uv.y;

  // ── Vignette (lsKSWR) ──
  vec2 v = uv;
  v *= 1.0 - v.yx;
  float vig = pow(v.x * v.y * 15.0, 0.25);

  // Green glow: bright at center, fading to edges
  vec3 greenGlow = vec3(0.15, 1.0, 0.45) * vig * vig * vig * 0.45;

  // Corner/edge darkness
  float darkness = (1.0 - vig) * 0.75;

  // ── Scanlines (CSS-pixel spaced, scrolling) ──
  float periodCss = 8.0;
  float yCss = gl_FragCoord.y / uDprY + uTime * 12.0;
  float phase = mod(yCss, periodCss);

  // Bright phosphor core near start of cycle
  float core = 1.0 - smoothstep(0.5, 2.0, phase);
  // Dark gap in second half
  float darkGap = smoothstep(periodCss * 0.45, periodCss * 0.45 + 1.0, phase);

  vec3 phosphor = vec3(0.1, 1.0, 0.3);
  float brightAlpha = core * 0.06;
  float darkAlpha = darkGap * 0.15;

  // ── Combine ──
  vec3 col = greenGlow + phosphor * brightAlpha;
  float alpha = max(darkness, darkAlpha) + brightAlpha;

  gl_FragColor = vec4(col, alpha);
}`;

export function CRTShader({ className = "" }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: false,
    });
    if (!gl) return;

    function compile(type: number, src: string) {
      const s = gl!.createShader(type)!;
      gl!.shaderSource(s, src);
      gl!.compileShader(s);
      if (!gl!.getShaderParameter(s, gl!.COMPILE_STATUS)) {
        console.error("CRTShader:", gl!.getShaderInfoLog(s));
      }
      return s;
    }

    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error("CRTShader link:", gl.getProgramInfoLog(prog));
      return;
    }
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );

    const aPos = gl.getAttribLocation(prog, "aPosition");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, "uResolution");
    const uDprY = gl.getUniformLocation(prog, "uDprY");
    const uTime = gl.getUniformLocation(prog, "uTime");

    const parent = canvas.parentElement;
    if (!parent) return;

    let animId: number;
    const start = performance.now();

    function render() {
      const rect = parent!.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio, 2);
      const w = Math.round(rect.width * dpr);
      const h = Math.round(rect.height * dpr);

      if (canvas!.width !== w || canvas!.height !== h) {
        canvas!.width = w;
        canvas!.height = h;
      }

      const t = (performance.now() - start) / 1000;

      gl!.viewport(0, 0, w, h);
      gl!.uniform2f(uRes!, w, h);
      gl!.uniform1f(uDprY!, dpr);
      gl!.uniform1f(uTime!, t);
      gl!.clearColor(0, 0, 0, 0);
      gl!.clear(gl!.COLOR_BUFFER_BIT);
      gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);

      animId = requestAnimationFrame(render);
    }

    render();

    return () => cancelAnimationFrame(animId);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={`pointer-events-none absolute inset-0 z-[22] h-full w-full ${className}`}
    />
  );
}
