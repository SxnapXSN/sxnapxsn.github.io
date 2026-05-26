import { useEffect, useRef } from "react";
import { Mesh, Program, Renderer, Triangle, Vec2 } from "ogl";

const vertex = `
attribute vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const fragment = `
#ifdef GL_ES
precision mediump float;
#endif

uniform vec2 uResolution;
uniform float uTime;
uniform float uHueShift;
uniform float uNoise;
uniform float uScan;
uniform float uWarp;
uniform float uLightMode;
uniform vec3 uThemeColor;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

mat2 rotate2d(float a) {
  float s = sin(a);
  float c = cos(a);
  return mat2(c, -s, s, c);
}

vec3 hueShift(vec3 color, float hue) {
  const vec3 k = vec3(0.57735, 0.57735, 0.57735);
  float cosAngle = cos(hue);
  return color * cosAngle + cross(k, color) * sin(hue) + k * dot(k, color) * (1.0 - cosAngle);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution.xy) / min(uResolution.x, uResolution.y);
  vec2 p = uv;

  float t = uTime * 0.32;
  float radius = length(p);
  float angle = atan(p.y, p.x);
  float iris = smoothstep(0.8, 0.12, radius);

  p *= rotate2d(sin(t) * 0.18);
  p += vec2(
    sin(p.y * 3.2 + t * 1.8),
    cos(p.x * 2.8 - t * 1.2)
  ) * uWarp * 0.11;

  float folds = 0.0;
  folds += noise(p * 2.0 + t);
  folds += noise(p * 4.4 - t * 0.8) * 0.5;
  folds += noise(p * 8.5 + vec2(t * 0.4, -t)) * 0.25;

  float veil = sin(angle * 3.0 + radius * 9.0 - t * 2.4) * 0.5 + 0.5;
  float ring = smoothstep(0.38, 0.34, abs(radius - 0.44));
  float scan = sin(gl_FragCoord.y * 1.4 + uTime * 5.0) * 0.5 + 0.5;

  vec3 theme = max(uThemeColor, vec3(0.08));
  vec3 darkA = mix(vec3(0.006, 0.006, 0.01), theme * 0.12, 0.7);
  vec3 darkB = mix(vec3(0.025, 0.018, 0.028), theme * 0.42, 0.82);
  vec3 lightA = mix(vec3(0.92, 0.92, 0.94), theme, 0.16);
  vec3 lightB = mix(vec3(0.74, 0.74, 0.78), theme, 0.3);

  vec3 base = mix(darkA, darkB, folds * iris + ring * 0.35 + veil * 0.12);
  vec3 lightBase = mix(lightA, lightB, folds * 0.25 + ring * 0.15);
  vec3 color = mix(base, lightBase, uLightMode);

  color += theme * ring * (1.0 - uLightMode) * 0.3;
  color += theme * ring * uLightMode * 0.18;
  color *= 1.0 - (scan * scan * uScan);
  color += (hash(gl_FragCoord.xy + uTime) - 0.5) * uNoise;
  color = hueShift(color, radians(uHueShift));

  float vignette = smoothstep(1.08, 0.18, radius);
  color *= mix(0.58, 1.15, vignette);

  gl_FragColor = vec4(color, 1.0);
}
`;

export default function DarkVeil({
  hueShift = 0,
  noiseIntensity = 0.05,
  scanlineIntensity = 0.12,
  speed = 0.8,
  warpAmount = 0.42,
  resolutionScale = 0.86,
  lightMode = false,
  themeColor = [255, 47, 125],
  className = ""
}) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return undefined;

    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return undefined;
    canvas.style.display = "block";

    let renderer;
    let frame = 0;

    try {
      renderer = new Renderer({
        alpha: true,
        dpr: Math.min(window.devicePixelRatio || 1, 1.25),
        canvas
      });
    } catch {
      return undefined;
    }

    const gl = renderer.gl;
    gl.clearColor(0, 0, 0, 0);
    const geometry = new Triangle(gl);
    const program = new Program(gl, {
      vertex,
      fragment,
      uniforms: {
        uTime: { value: 0 },
        uResolution: { value: new Vec2() },
        uHueShift: { value: hueShift },
        uNoise: { value: noiseIntensity },
        uScan: { value: scanlineIntensity },
        uWarp: { value: warpAmount },
        uLightMode: { value: lightMode ? 1 : 0 },
        uThemeColor: { value: [themeColor[0] / 255, themeColor[1] / 255, themeColor[2] / 255] }
      }
    });
    const mesh = new Mesh(gl, { geometry, program });

    const resize = () => {
      const width = Math.max(1, parent.clientWidth);
      const height = Math.max(1, parent.clientHeight);
      const renderWidth = Math.max(1, Math.floor(width * resolutionScale));
      const renderHeight = Math.max(1, Math.floor(height * resolutionScale));
      renderer.setSize(renderWidth, renderHeight);
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      program.uniforms.uResolution.value.set(renderWidth, renderHeight);
    };

    const started = performance.now();
    let lastFrameTime = started;
    let slowFrameCount = 0;
    const loop = () => {
      const now = performance.now();
      const delta = now - lastFrameTime;
      lastFrameTime = now;
      if (delta > 180) slowFrameCount += 1;
      if (slowFrameCount > 8) {
        canvas.style.display = "none";
        return;
      }

      program.uniforms.uTime.value = ((now - started) / 1000) * speed;
      program.uniforms.uHueShift.value = hueShift;
      program.uniforms.uNoise.value = noiseIntensity;
      program.uniforms.uScan.value = scanlineIntensity;
      program.uniforms.uWarp.value = warpAmount;
      program.uniforms.uLightMode.value = lightMode ? 1 : 0;
      program.uniforms.uThemeColor.value = [themeColor[0] / 255, themeColor[1] / 255, themeColor[2] / 255];
      renderer.render({ scene: mesh });
      frame = requestAnimationFrame(loop);
    };

    resize();
    window.addEventListener("resize", resize);
    loop();

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      renderer?.gl?.getExtension("WEBGL_lose_context")?.loseContext?.();
    };
  }, [hueShift, noiseIntensity, scanlineIntensity, speed, warpAmount, resolutionScale, lightMode, themeColor]);

  return <canvas ref={canvasRef} className={`darkveil-canvas ${className}`} aria-hidden="true" />;
}
