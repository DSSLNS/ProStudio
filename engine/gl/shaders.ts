/**
 * GLSL ES 3.00 shaders. The develop shader is a line-by-line port of
 * developPixel() in engine/color/pipeline.ts — keep the two in sync.
 */

export const FULLSCREEN_VS = /* glsl */ `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

/** Converts the source into a feature map: (luma, linear min channel, Cb, Cr). */
export const FEATURES_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uSize;
out vec4 o;
float toLin(float v){ float a=abs(v); float r = a<=0.04045 ? a/12.92 : pow((a+0.055)/1.055,2.4); return v<0.0?-r:r; }
void main(){
  vec2 uv = gl_FragCoord.xy / uSize;
  vec3 c = texture(uSrc, uv).rgb;
  float y = dot(c, vec3(0.2126,0.7152,0.0722));
  float m = min(toLin(c.r), min(toLin(c.g), toLin(c.b)));
  o = vec4(y, m, c.b - y + 0.5, c.r - y + 0.5); // chroma offset so 8-bit targets also work
}
`;

/** 2× box downsample (one bilinear tap at the centre of each 2×2 block). */
export const DOWNSAMPLE_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uSrcSize;
out vec4 o;
void main(){
  vec2 p = (gl_FragCoord.xy - 0.5) * 2.0 + 1.0;
  o = texture(uTex, p / uSrcSize);
}
`;

/** Separable Gaussian blur (direction set by uDir). */
export const BLUR_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uSize;
uniform vec2 uDir;
uniform float uSigma;
uniform int uRadius;
out vec4 o;
void main(){
  vec2 uv = gl_FragCoord.xy / uSize;
  vec4 acc = texture(uTex, uv);
  float wsum = 1.0;
  float s2 = 2.0 * uSigma * uSigma;
  for (int i = 1; i <= 64; i++) {
    if (i > uRadius) break;
    float w = exp(-float(i*i) / s2);
    vec2 off = uDir * float(i) / uSize;
    acc += w * (texture(uTex, uv + off) + texture(uTex, uv - off));
    wsum += 2.0 * w;
  }
  o = acc / wsum;
}
`;

export const DEVELOP_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler3D;

uniform sampler2D uSrc;
uniform sampler2D uFeatL;
uniform sampler2D uFeatM;
uniform sampler2D uFeatS;
uniform sampler2D uCurves;
uniform sampler3D uLut;
uniform bool uUseFeatures;

uniform mat3 uOutToSrc;     // render pixel → source(region) pixel
uniform vec2 uSrcSize;      // region size in pixels
uniform vec2 uRenderSize;   // render target size
uniform vec2 uTileOffset;   // offset of this tile within the full render
uniform vec2 uFullSize;     // full render size (for vignette/grain)
uniform float uGrainScale;  // full-res pixels per render pixel
uniform bool uPremultiply;
uniform bool uSplitBefore;  // before/after split mode
uniform float uSplitX;      // 0..1 in render space; left of it shows 'before'

uniform vec3 uWb;
uniform float uExposureMul;
uniform float uDehaze;
uniform float uShadows, uHighlights, uWhites, uBlacks;
uniform float uContrast, uBrightness, uGamma;
uniform float uClarity, uTexture, uSharpen;
uniform float uNoiseLum, uNoiseColor;
uniform float uHueShift, uSaturation, uVibrance;
uniform float uHslHue[8];
uniform float uHslSat[8];
uniform float uHslLum[8];
uniform bool uHslActive;
uniform vec3 uGradeTint[4];  // shadows, midtones, highlights, global
uniform float uGradeLum[4];
uniform float uGradeSplit, uGradePower;
uniform vec3 uBal[3];
uniform bool uCurvesActive;
uniform float uLutIntensity;
uniform float uLutSize;
uniform vec3 uLutDomainMin, uLutDomainMax;
uniform float uVigAmount, uVigMid, uVigFeather, uVigRound;
uniform float uGrain;

out vec4 outColor;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
const float CENTERS[9] = float[9](0.0, 30.0, 60.0, 120.0, 180.0, 225.0, 270.0, 315.0, 360.0);

float toLin(float v){ float a=abs(v); float r = a<=0.04045 ? a/12.92 : pow((a+0.055)/1.055,2.4); return v<0.0?-r:r; }
float toSrgb(float v){ float a=abs(v); float r = a<=0.0031308 ? a*12.92 : 1.055*pow(a,1.0/2.4)-0.055; return v<0.0?-r:r; }
vec3 toLin3(vec3 c){ return vec3(toLin(c.r), toLin(c.g), toLin(c.b)); }
vec3 toSrgb3(vec3 c){ return vec3(toSrgb(c.r), toSrgb(c.g), toSrgb(c.b)); }

vec3 rgb2hsv(vec3 c){
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float d = mx - mn;
  float h = 0.0;
  if (d > 1e-9) {
    if (mx == c.r) h = mod((c.g - c.b) / d, 6.0);
    else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
    else h = (c.r - c.g) / d + 4.0;
    h *= 60.0;
    if (h < 0.0) h += 360.0;
  }
  return vec3(h, mx <= 0.0 ? 0.0 : d / mx, mx);
}
vec3 hsv2rgb(vec3 hsv){
  float hh = mod(mod(hsv.x, 360.0) + 360.0, 360.0) / 60.0;
  float c = hsv.z * hsv.y;
  float x = c * (1.0 - abs(mod(hh, 2.0) - 1.0));
  float m = hsv.z - c;
  vec3 rgb;
  if (hh < 1.0) rgb = vec3(c, x, 0);
  else if (hh < 2.0) rgb = vec3(x, c, 0);
  else if (hh < 3.0) rgb = vec3(0, c, x);
  else if (hh < 4.0) rgb = vec3(0, x, c);
  else if (hh < 5.0) rgb = vec3(x, 0, c);
  else rgb = vec3(c, 0, x);
  return rgb + m;
}
float sCurve(float x, float k){ return x < 0.5 ? 0.5*pow(2.0*x, k) : 1.0 - 0.5*pow(2.0 - 2.0*x, k); }
vec3 toneMasks(float y, float split, float power){
  float ws = pow(clamp(1.0 - y/split, 0.0, 1.0), power);
  float wh = pow(clamp((y - split)/(1.0 - split), 0.0, 1.0), power);
  return vec3(ws, clamp(1.0 - ws - wh, 0.0, 1.0), wh);
}
float curve(int ch, float x){
  float u = (clamp(x,0.0,1.0) * 1023.0 + 0.5) / 1024.0;
  vec4 t = texture(uCurves, vec2(u, 0.5));
  return ch == 0 ? t.r : ch == 1 ? t.g : ch == 2 ? t.b : t.a;
}
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }

vec3 develop(vec3 src, vec4 fl, vec4 fm, vec4 fs, vec2 outUv, vec2 fullPx){
  vec3 c = src;
  float ySrc = dot(c, LUMA);
  float yLarge = fl.r, minLarge = fl.g, yMedium = fm.r, ySmall = fs.r;
  vec2 cbcrMedium = fm.ba - 0.5;

  if (uNoiseLum > 0.0 || uNoiseColor > 0.0) {
    float y = ySrc; float cb = c.b - y; float cr = c.r - y;
    if (uNoiseLum > 0.0) {
      float d = y - ySmall;
      float edge = exp(-(d*d) / (0.0025 + uNoiseLum*0.01));
      y = mix(y, mix(ySmall, yMedium, 0.5*uNoiseLum), uNoiseLum*edge);
    }
    if (uNoiseColor > 0.0) { cb = mix(cb, cbcrMedium.x, uNoiseColor); cr = mix(cr, cbcrMedium.y, uNoiseColor); }
    float r = cr + y; float b = cb + y;
    c = vec3(r, (y - 0.2126*r - 0.0722*b) / 0.7152, b);
  }

  vec3 lin = toLin3(c) * uWb * uExposureMul;

  if (uDehaze > 0.0) {
    float t = max(1.0 - uDehaze*0.95*clamp(minLarge*uExposureMul, 0.0, 1.0), 0.1);
    lin = (lin - 0.95) / t + 0.95;
  } else if (uDehaze < 0.0) {
    float t = 1.0 + uDehaze*0.6;
    lin = lin*t + 0.8*(1.0 - t);
  }

  if (uShadows != 0.0 || uHighlights != 0.0) {
    float yl = toSrgb(toLin(yLarge) * uExposureMul);
    float yp = clamp(toSrgb(max(0.0, dot(lin, LUMA))), 0.0, 1.5);
    float lb = mix(yp, yl, 0.65);
    float ms = pow(1.0 - smoothstep(0.0, 0.6, lb), 2.0);
    float mh = pow(smoothstep(0.4, 1.0, lb), 2.0);
    lin *= exp2(uShadows*1.5*ms + uHighlights*1.3*mh);
  }

  vec3 q = toSrgb3(lin);

  if (uWhites != 0.0 || uBlacks != 0.0) {
    vec3 x = max(q, 0.0);
    vec3 xm = min(x, 1.5);
    x = x * (1.0 + uWhites*0.22*xm*xm);
    vec3 inv = 1.0 - clamp(x, 0.0, 1.0);
    x = x + uBlacks*0.12*inv*inv*inv;
    q = x;
  }
  q = clamp(q, 0.0, 1.0);

  if (uContrast != 0.0) {
    float k = uContrast >= 0.0 ? 1.0 + uContrast : 1.0 + uContrast*0.6;
    q = vec3(sCurve(q.r,k), sCurve(q.g,k), sCurve(q.b,k));
  }
  if (uBrightness != 0.0 || uGamma != 1.0) {
    float e = exp2(-uBrightness*0.8) / uGamma;
    q = pow(q, vec3(e));
  }

  if (uClarity != 0.0 || uTexture != 0.0 || uSharpen != 0.0) {
    float y = dot(q, LUMA);
    float mid = 1.0 - (2.0*y - 1.0)*(2.0*y - 1.0);
    float dY = uClarity*1.2*(ySrc - yLarge)*mid + uTexture*(ySrc - yMedium) + uSharpen*1.5*(ySrc - ySmall);
    q = clamp(q + dY, 0.0, 1.0);
  }

  if (uHueShift != 0.0 || uSaturation != 0.0 || uVibrance != 0.0 || uHslActive) {
    vec3 hsv = rgb2hsv(q);
    float s0 = hsv.y;
    hsv.x += uHueShift;
    if (uHslActive) {
      float h = mod(mod(hsv.x, 360.0) + 360.0, 360.0);
      float dh = 0.0, ds = 0.0, dl = 0.0;
      for (int i = 0; i < 8; i++) {
        float a = CENTERS[i]; float b = CENTERS[i+1];
        if (h >= a && h < b) {
          float t = (h - a) / (b - a);
          t = t*t*(3.0 - 2.0*t);
          int j = i == 7 ? 0 : i + 1;
          dh = (1.0-t)*uHslHue[i] + t*uHslHue[j];
          ds = (1.0-t)*uHslSat[i] + t*uHslSat[j];
          dl = (1.0-t)*uHslLum[i] + t*uHslLum[j];
        }
      }
      hsv.x += dh * s0;
      hsv.y *= 1.0 + ds;
      hsv.z *= exp2(dl*0.8*s0);
    }
    hsv.y *= 1.0 + uSaturation;
    if (uVibrance != 0.0) {
      float dd = mod(hsv.x - 30.0 + 540.0, 360.0) - 180.0;
      float skin = exp(-(dd*dd) / (2.0*18.0*18.0));
      hsv.y *= 1.0 + uVibrance*(1.0 - hsv.y)*(uVibrance > 0.0 ? 1.0 - 0.5*skin : 1.0);
    }
    hsv.y = clamp(hsv.y, 0.0, 1.0);
    q = clamp(hsv2rgb(hsv), 0.0, 1.0);
  }

  {
    vec3 w = toneMasks(dot(q, LUMA), uGradeSplit, uGradePower);
    vec3 add = uGradeTint[3] + w.x*uGradeTint[0] + w.y*uGradeTint[1] + w.z*uGradeTint[2];
    float lum = uGradeLum[3] + w.x*uGradeLum[0] + w.y*uGradeLum[1] + w.z*uGradeLum[2];
    q = clamp((q + add) * (1.0 + lum*0.5), 0.0, 1.0);
  }
  {
    vec3 w = toneMasks(dot(q, LUMA), 0.5, 1.5);
    q = clamp(q + (w.x*uBal[0] + w.y*uBal[1] + w.z*uBal[2])*0.12, 0.0, 1.0);
  }

  if (uCurvesActive) {
    q = vec3(curve(1, curve(0, q.r)), curve(2, curve(0, q.g)), curve(3, curve(0, q.b)));
  }

  if (uLutIntensity > 0.0) {
    vec3 t = clamp((q - uLutDomainMin) / (uLutDomainMax - uLutDomainMin), 0.0, 1.0);
    vec3 coord = (t * (uLutSize - 1.0) + 0.5) / uLutSize;
    vec3 l = texture(uLut, coord).rgb;
    q = clamp(mix(q, l, uLutIntensity), 0.0, 1.0);
  }

  if (uVigAmount != 0.0) {
    float aspect = uFullSize.x / uFullSize.y;
    vec2 d = (outUv - 0.5) * 2.0;
    float rnd = max(uVigRound, 0.0);
    if (aspect > 1.0) d.x *= mix(1.0, aspect, rnd); else d.y *= mix(1.0, 1.0/aspect, rnd);
    float pw = 2.0 + max(-uVigRound, 0.0)*6.0;
    float dist = pow(pow(abs(d.x), pw) + pow(abs(d.y), pw), 1.0/pw);
    float mid = mix(0.3, 1.3, uVigMid);
    float fe = mix(0.05, 1.0, uVigFeather);
    float v = smoothstep(mid - fe*0.5, mid + fe*0.5, dist);
    q = uVigAmount < 0.0 ? q * (1.0 + uVigAmount*v) : mix(q, vec3(1.0), uVigAmount*v);
  }

  if (uGrain > 0.0) {
    float y = dot(q, LUMA);
    float n = (hash(floor(fullPx)) - 0.5) * uGrain * 0.18 * (1.0 - abs(2.0*y - 1.0)*0.6) * inversesqrt(max(uGrainScale, 1.0));
    q = clamp(q + n, 0.0, 1.0);
  }
  return q;
}

void main(){
  vec2 p = vec2(gl_FragCoord.x, uRenderSize.y - gl_FragCoord.y) + uTileOffset;
  vec3 s = uOutToSrc * vec3(p, 1.0);
  vec2 sp = s.xy / s.z;
  vec2 uv = sp / uSrcSize;
  if (s.z <= 0.0 || uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) { outColor = vec4(0.0); return; }
  vec4 src = texture(uSrc, uv);
  vec4 fl = uUseFeatures ? texture(uFeatL, uv) : vec4(0.0);
  vec4 fm = uUseFeatures ? texture(uFeatM, uv) : vec4(0.0);
  vec4 fs = uUseFeatures ? texture(uFeatS, uv) : vec4(0.0);
  if (!uUseFeatures) {
    float y = dot(src.rgb, LUMA);
    float m = min(toLin(src.r), min(toLin(src.g), toLin(src.b)));
    fl = vec4(y, m, src.b - y + 0.5, src.r - y + 0.5); fm = fl; fs = fl;
  }
  vec2 outUv = p / uFullSize;
  vec3 rgb = (uSplitBefore && outUv.x < uSplitX) ? src.rgb : develop(src.rgb, fl, fm, fs, outUv, p * uGrainScale);
  float a = src.a;
  outColor = uPremultiply ? vec4(rgb * a, a) : vec4(rgb, a);
}
`;
