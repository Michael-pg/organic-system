export const VERT = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main(){ vUv = aPos * .5 + .5; gl_Position = vec4(aPos, 0., 1.); }`;

// Pointer influence: a low-res buffer that the cursor paints into and that fades over time.
export const INFLUENCE_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uPrev; uniform vec2 uPtr; uniform float uDown, uDecay, uRadius, uAspect; uniform vec2 uTexel;
in vec2 vUv; out vec4 o;
void main(){
  float p = texture(uPrev, vUv).r * .5 + .125 * (texture(uPrev, vUv + vec2(uTexel.x, 0.)).r + texture(uPrev, vUv - vec2(uTexel.x, 0.)).r
    + texture(uPrev, vUv + vec2(0., uTexel.y)).r + texture(uPrev, vUv - vec2(0., uTexel.y)).r);
  vec2 d = (vUv - uPtr) * vec2(uAspect, 1.);
  float s = uDown * exp(-dot(d, d) / (uRadius * uRadius));
  o = vec4(vec3(max(max(p * uDecay - .003, 0.), s)), 1.);
}`;

export const FRAG = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2D uA, uB, uInf;
uniform sampler2DArray uFlip;
uniform float uMix, uHasFlip, uFlipCount, uFlipLaps, uBinary, uAspect, uFit;
uniform vec2 uRes;
uniform float uPhase, uTime;
// loop
uniform float uLo, uHi, uSoft, uPulse, uBands, uLaps, uBandWidth, uBase;
// look
uniform int uSource, uPattern;
uniform float uCell, uContrast, uLevels, uFlow, uLineW, uAccentMix, uTransparent, uSeed;
uniform vec3 uFigure, uGround, uAccent;
// environment
uniform vec2 uWindDir; uniform float uWind, uGust, uSway, uBreath, uNoiseScale, uTempo;
// hover
uniform int uHover; uniform float uHoverStrength;
out vec4 o;

float h3(vec3 p){ p = fract(p * vec3(.1031, .1030, .0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
// value noise, periodic in z so that anything driven by the loop phase repeats exactly
float vn(vec3 p, float per){ vec3 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  float z0 = mod(i.z, per), z1 = mod(i.z + 1., per);
  float a = mix(mix(h3(vec3(i.xy, z0)), h3(vec3(i.xy + vec2(1, 0), z0)), f.x), mix(h3(vec3(i.xy + vec2(0, 1), z0)), h3(vec3(i.xy + vec2(1, 1), z0)), f.x), f.y);
  float b = mix(mix(h3(vec3(i.xy, z1)), h3(vec3(i.xy + vec2(1, 0), z1)), f.x), mix(h3(vec3(i.xy + vec2(0, 1), z1)), h3(vec3(i.xy + vec2(1, 1), z1)), f.x), f.y);
  return mix(a, b, f.z); }
float bayer2(vec2 a){ a = floor(a); return fract(a.x / 2. + a.y * a.y * .75); }
float bayer4(vec2 a){ return bayer2(.5 * a) * .25 + bayer2(a); }
float bayer8(vec2 a){ return bayer4(.5 * a) * .25 + bayer2(a); }

vec2 fitScale(){ float ca = uRes.x / uRes.y; bool wide = ca > uAspect;
  if (uFit > .5) wide = !wide; // cover
  return wide ? vec2(ca / uAspect, 1.) : vec2(1., uAspect / ca); }

// field, age, wide blur at a point in bake space
vec3 bake(vec2 uv){
  if (uv.x < 0. || uv.y < 0. || uv.x > 1. || uv.y > 1.) return vec3(0.);
  vec3 s = mix(texture(uA, uv).rgb, texture(uB, uv).rgb, uMix);
  if (uHasFlip > .5) { float l = fract(uPhase * uFlipLaps) * uFlipCount, l0 = floor(l);
    float f = mix(texture(uFlip, vec3(uv, l0)).r, texture(uFlip, vec3(uv, mod(l0 + 1., uFlipCount))).r, l - l0);
    s.r = mix(s.r, f, uMix); }
  return s; }

// how much of the form is visible at this age, for the current point in the loop
float visible(float age){
  float v = (1. - smoothstep(uHi - uSoft, uHi + uSoft, age)) * smoothstep(uLo - uSoft, uLo + uSoft, age);
  if (uPulse > .5) { float x = abs(fract(age * uBands - uPhase * uLaps) - .5) * 2.;
    v = mix(uBase, 1., 1. - smoothstep(uBandWidth, uBandWidth + uSoft * 4. + .02, x)); }
  return v; }

// x: form value, y: age, z: wide value. Environment and hover are applied here.
vec3 organism(vec2 uv){
  float z = uPhase * uTempo;
  float n1 = vn(vec3(uv * uNoiseScale, z), uTempo), n2 = vn(vec3(uv * uNoiseScale + 17.3, z), uTempo);
  float gust = .5 + .5 * sin(6.28318 * (uPhase * uTempo - dot(uv, uWindDir) * uGust));
  vec2 p = uv + (vec2(n1, n2) - .5) * uSway + uWindDir * uWind * gust * (.4 + n1);
  float inf = texture(uInf, uv).r;
  if (uHover == 3) { vec2 e = vec2(.012, 0.);
    vec2 g = vec2(texture(uInf, uv + e.xy).r - texture(uInf, uv - e.xy).r, texture(uInf, uv + e.yx).r - texture(uInf, uv - e.yx).r);
    p += g * sin(inf * 14. - uTime * 6.) * .08 * uHoverStrength; }
  vec3 s = bake(p);
  float age = s.g, f = s.r, wide = s.b;
  if (uHover == 1) { age -= inf * uHoverStrength * .6; f = min(1., f * (1. + inf * uHoverStrength) + inf * wide * uHoverStrength * .5); }
  if (uHover == 2) { age += inf * uHoverStrength * .6; f *= 1. - min(1., inf * uHoverStrength); wide *= 1. - min(1., inf * uHoverStrength); }
  float vis = visible(age);
  float n3 = vn(vec3(uv * uNoiseScale * 2. + 5.1, z), uTempo);
  float val = f * vis + (n3 - .5) * uBreath * min(1., wide * 3.) * vis;
  return vec3(val, age, wide * vis); }

void main(){
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  // each pattern samples the organism once per cell, so the grid stays crisp while the form moves underneath
  vec2 cs = vec2(uCell);
  if (uPattern == 0) cs = vec2(1.);
  if (uPattern == 5) cs = vec2(uCell * 3.);
  if (uPattern == 6) cs = vec2(1., uCell * 2.);
  vec2 cell = floor(px / cs), pc = (cell + .5) * cs, scale = fitScale();
  vec2 uv = (pc / uRes - .5) * scale + .5;
  vec3 s = organism(uv);
  float tone = s.x, age = s.y;

  if (uSource != 0) {
    // contour-style sources need the local slope of the value they trace
    vec2 e = scale / uRes * max(cs, vec2(1.5));
    int ch = uSource == 3 ? 0 : 2;
    float c = uSource == 3 ? s.x : s.z;
    vec2 g = vec2(organism(uv + vec2(e.x, 0.))[ch] - organism(uv - vec2(e.x, 0.))[ch], organism(uv + vec2(0., e.y))[ch] - organism(uv - vec2(0., e.y))[ch]) / (2. * max(cs, vec2(1.5)));
    float slope = max(length(g), 1e-5), lw = max(uLineW, max(cs.x, cs.y)) * .5;
    if (uSource == 1) { float x = c * uLevels - uPhase * uFlow, fr = fract(x), d = min(fr, 1. - fr) / (slope * uLevels);
      tone = (1. - smoothstep(lw, lw + 1., d)) * smoothstep(.03, .09, c); }
    else if (uSource == 2) { float band = step(.5, fract(age * uLevels - uPhase * uFlow));
      tone = smoothstep(.2, .4, s.x) * mix(.3, .95, band); }
    else { float d = abs(c - .5) / slope; tone = 1. - smoothstep(lw, lw + 1., d); }
  }

  float v = clamp((tone - .5) * uContrast + .5, 0., 1.), a;
  if (uSource == 1 || uSource == 3) v = tone;
  if (uPattern == 0) a = v;
  else if (uPattern == 1) a = step(h3(vec3(cell, uSeed)), v - 1e-4);
  else if (uPattern == 2) a = step(bayer4(cell) + .03125, v);
  else if (uPattern == 3) a = step(bayer8(cell) + .0078, v);
  else if (uPattern == 4) a = step(.5, v);
  else if (uPattern == 5) a = step(length(fract(px / cs) - .5), sqrt(v) * .72 - .02);
  else a = step(abs(fract(px.y / cs.y) - .5), v * .5 - .01);
  if (uBinary > .5 && uSource == 0 && uPattern != 0 && uPattern < 5) a = step(.5, tone);

  vec3 fig = mix(uFigure, uAccent, uAccentMix * clamp(age, 0., 1.));
  o = uTransparent > .5 ? vec4(fig * a, a) : vec4(mix(uGround, fig, a), 1.);
}`;
