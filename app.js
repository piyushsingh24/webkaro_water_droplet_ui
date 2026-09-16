// Rainy Notes — vanilla clone of https://woyeaq6rs2wvq.ok.kimi.link/
// Shader + notes + UI logic ported from original bundle (WebGL2)

const _m = [{scale:1,blur:0},{scale:.5,blur:5},{scale:.25,blur:7}];
const pf = {intensity:.7,speed:1,dropSize:1,trail:1.1,wind:0,mist:.05,refract:1.15,disperse:.5,specular:.8,blur:.7,bright:1,grain:.035,zoom:1.08,scale:1,parallax:1,lightning:0,renderScale:1};

const Qe_base = [
  {id:"tokyo",name:"Tokyo",src:"assets/tokyo-evening.jpg"},
  {id:"neon",name:"Neon",gen:Xm},
  {id:"dusk",name:"Dusk",gen:Lm},
];
const Qe = [...Qe_base];

const Sf = {
  Drizzle:{intensity:.34,speed:.65,dropSize:.8,trail:.55,wind:0,mist:1.05,blur:.78,refract:.85,specular:.7,lightning:0},
  Shower:{intensity:.7,speed:1,dropSize:1,trail:1.1,wind:0,mist:.78,blur:.7,refract:1,specular:.8,lightning:0},
  Downpour:{intensity:.95,speed:1.8,dropSize:1.05,trail:1.35,wind:.14,mist:.52,blur:.62,refract:1.15,specular:.95,lightning:0},
  Storm:{intensity:1,speed:2.4,dropSize:1.2,trail:1.5,wind:.45,mist:.38,blur:.56,refract:1.35,specular:1.15,lightning:9},
  Fogged:{intensity:.14,speed:.55,dropSize:.9,trail:.3,wind:0,mist:1.4,blur:.92,refract:.7,specular:.6,lightning:0}
};

const wm = [
  {title:"Rain",rows:[["intensity","Density",0,1,.01],["speed","Speed",0,3,.01],["dropSize","Drop size",.35,1.8,.01],["trail","Trails",0,1.6,.01],["wind","Wind",-1,1,.01],["scale","Scale",.5,2.2,.01]]},
  {title:"Glass",rows:[["mist","Condensation",0,1.4,.01],["refract","Refraction",0,2.5,.01],["disperse","Dispersion",0,1.5,.01],["specular","Sheen",0,2,.01],["blur","Defocus",0,1,.01]]},
  {title:"Scene",rows:[["zoom","Zoom",1,1.6,.01],["parallax","Parallax",0,2,.01],["bright","Exposure",.4,1.8,.01],["lightning","Lightning",0,20,1],["grain","Grain",0,.12,.002]]},
  {title:"Render",rows:[["renderScale","Resolution",.5,1.25,.05]]}
];
const Qm = [{title:"Size",rows:[["noteSize","Text size",14,64,1]]}];

const jd = "rainy-notes";
const Zd = "rainy-notes:state";
const Vd = "rainy-notes:upload";
const wu = .5;
const Bd = 2600;
const Zu = [
  {id:"white",css:"rgba(255,255,255,.93)"},
  {id:"warm",css:"rgba(255,238,214,.92)"},
  {id:"amber",css:"rgba(247,183,110,.95)"},
  {id:"rose",css:"rgba(255,170,178,.93)"},
  {id:"mint",css:"rgba(163,236,205,.92)"},
  {id:"sky",css:"rgba(160,208,255,.94)"},
  {id:"violet",css:"rgba(198,178,255,.93)"},
  {id:"ink",css:"rgba(20,28,38,.86)"}
];

const Im = `#version 300 es
// Fullscreen triangle. No attributes, no buffers — gl_VertexID does the work.
void main() {
	vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
	gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

const Pm = `#version 300 es
precision highp float;

/* Rain on a window pane.
 *
 * The whole image is one height field h(x,y) standing for the water on the glass.
 * Everything else falls out of it: the surface normal is its gradient, refraction
 * is a lookup offset along that normal, the sheen is a dot product with it, and how
 * blurred the city behind looks is a function of how much water is in the way.
 *
 * Four things had to be true before it read as water rather than as circles.
 *
 *   1. Height is measured in real units, and a drop is a spherical cap — not a
 *      plateau of height 1. A 3px bead and a 20px drop then have the *same* surface
 *      slope, so they refract by the same angle, which is what physics says and
 *      what a plateau-shaped height field gets badly wrong: under that model the
 *      small beads sample halfway across the image and turn to noise.
 *   2. A drop rests before it runs. Water on vertical glass condenses, clings, and
 *      only then accelerates. Constant speed reads as a screensaver.
 *   3. Most of the water never moves at all. The pane is carpeted in standing beads
 *      of every size; the runners are the exception, and their job is to wipe a
 *      corridor through them.
 *   4. What a runner leaves behind is mostly a *gap*, not a bright streak — glass
 *      swept clear of condensation, with a few beads left in it. Continuous streaks
 *      are the single biggest tell of a fake rain shader.
 *
 * Units: one "glass unit" is uPx device pixels (~900 CSS px), so drops keep their
 * physical size when the window resizes — a bigger window gets *more* rain, not
 * bigger rain.
 */

out vec4 fragColor;

uniform vec2  uRes;        // drawing buffer size, device px
uniform float uPx;         // device px per glass unit
uniform float uTime;

uniform sampler2D uBg0;    // scene, sharp
uniform sampler2D uBg1;    // scene, soft
uniform sampler2D uBg2;    // scene, heavy
uniform sampler2D uText;   // notes, as a wipe mask

uniform vec2  uBgScale;    // cover-fit + zoom, screen uv -> texture uv
uniform vec2  uBgOffset;

uniform float uIntensity;  // fraction of lanes carrying a runner
uniform float uSpeed;
uniform float uDropSize;
uniform float uTrail;
uniform float uWind;
uniform float uMist;       // standing condensation
uniform float uRefract;
uniform float uDisperse;
uniform float uSpecular;
uniform float uBlur;       // how out-of-focus the world outside is
uniform float uBright;
uniform float uFlash;      // lightning, driven from JS
uniform float uGrain;

// Water on glass beads up at a contact angle well under 90°, so the cap is flatter
// than a hemisphere. This is the single number that sets "how lens-like" a drop is.
const float FLATTEN = 0.62;

// ── hashes ────────────────────────────────────────────────────────────────────
float h11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }

vec4 h42(vec2 p) {
	vec4 q = fract(p.xyxy * vec4(0.1031, 0.1030, 0.0973, 0.1099));
	q += dot(q, q.wzxy + 33.33);
	return fract((q.xxyz + q.yzzw) * q.zywx);
}

// ── a drop ────────────────────────────────────────────────────────────────────
// Height of a spherical cap of radius \`rad\`, normalised to 1 at the apex. The sqrt
// is what puts the slope where it belongs: flat on top, steepening to the rim, so
// the middle of a drop shows an inverted image and the rim smears the light around it.
float cap(float d2, float rad) {
	float k = 1.0 - d2 / (rad * rad);
	return k > 0.0 ? sqrt(k) : 0.0;
}

// Water on vertical glass is never a circle, and that is the whole difference
// between "rain" and "bubbles". Two deformations, both cheap:
//
//   sag    — the contact line pins near the top while the bulk droops, so even a
//            drop that has never moved is bottom-heavy and slightly tall. Gravity
//            scales with volume and surface tension only with the rim, so big
//            drops sag hard and specks stay round.
//   wobble — a real contact line is pinned by imperfections in the glass, so the
//            outline is a lumpy closed curve. Two crossed sines at about one
//            period per drop are enough; the eye reads "not a circle" long before
//            it reads the harmonic. It perturbs the interior too, which is welcome:
//            a real drop is not a clean lens either.
vec2 sag(vec2 d, float rad) {
	float g = 0.20 * min(1.0, rad * 5.0);
	d.y *= (d.y < 0.0 ? 1.0 - g : 1.0 + g) / 1.09;
	return d;
}

vec2 wobble(vec2 d, float rad, float seed) {
	// Under one period across the drop, and a displacement gradient (amp * w) well
	// under 1. Go past either and the warp folds the outline over itself: the drops
	// stop being lumpy and turn into starfish.
	// Amplitude grows with the drop: a speck is held round by surface tension, a big
	// drop has more rim to catch on the glass and more weight pulling it out of true.
	float a = 0.085 * min(1.0, rad * 5.0);
	float w = 2.1 / max(rad, 1e-3);
	return d + rad * a * vec2(sin(d.y * w + seed * 12.9), sin(d.x * w * 0.83 + seed * 7.7));
}

// Two drops that touch become one body with a concave neck and a bulge where they
// met — max() would leave two circles and a crease, which is exactly the tell the
// eye picks up. k scales with the taller of the two so a speck landing on a big
// drop is absorbed rather than inflating it.
float smax(float a, float b, float k) {
	float h = clamp(0.5 + 0.5 * (a - b) / k, 0.0, 1.0);
	return mix(b, a, h) + k * h * (1.0 - h);
}

// (height, coverage) pairs: heights merge, coverage unions.
vec2 merge(vec2 a, vec2 b) {
	return vec2(smax(a.x, b.x, 0.42 * max(a.x, b.x) + 1e-7), max(a.y, b.y));
}

// Cells are ~3x taller than wide, so a distance measured in cell space would make
// every drop a 3:1 ellipse. This puts it back into cell-*width* units — which is
// the unit every radius below is written in.
vec2 iso(vec2 d, float aspect) { return vec2(d.x, d.y * aspect); }

// Each beading octave is a lattice with one bead per cell. Stacked square-on they
// stay in phase and the eye picks the grid straight out of the noise, so every
// octave gets its own rotation.
vec2 rot(vec2 p, float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c) * p; }

// The x a drop occupies at height y. Head and trail both read from here — that is
// the only reason a streak stays attached to the drop that made it. \`room\` is
// whatever lateral space is left over after the drop's own radius, so a big drop
// ploughs straight down and a small one meanders: true of real water, and it also
// guarantees nothing ever reaches the cell edge and gets sliced flat.
float pathX(float y, float x0, float sway, float room) {
	float a = y * 7.0 + sway;
	// sin(a + sin(a)) is a sine with its crests sharpened and its troughs flattened.
	// A clean sine reads as a wave; this reads as water picking its way down.
	return 0.5 + x0 + sin(a + sin(a)) * room * (1.0 - y);
}

// Smooth value noise. Only used at very low frequency, to make condensation patchy.
float vnoise(vec2 p) {
	vec2 i = floor(p), f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	float a = h11(dot(i, vec2(1.0, 57.0)));
	float b = h11(dot(i + vec2(1.0, 0.0), vec2(1.0, 57.0)));
	float c = h11(dot(i + vec2(0.0, 1.0), vec2(1.0, 57.0)));
	float d = h11(dot(i + vec2(1.0, 1.0), vec2(1.0, 57.0)));
	return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// ── runners ───────────────────────────────────────────────────────────────────
// Returns (height in glass units, water coverage, glass swept clear).
// A drop must never touch its cell's edge: nothing outside the cell is evaluated,
// so any overhang would be sliced off flat. Hence |x0| + sway + rad < 0.5, and wind
// applied as a shear of the whole field rather than as motion inside a cell.
vec3 runners(vec2 p, vec2 cells, float t, float sd, float rest) {
	float aspect = cells.x / cells.y;

	vec2 g = p * cells;
	// Without a per-lane offset every drop in a row rests at the same height and
	// the pane bands horizontally.
	g.y += h11(floor(g.x) * 1.73 + sd * 9.13) * 17.0;

	vec2 id = floor(g);
	vec2 f  = fract(g);
	vec4 r  = h42(id + vec2(sd * 37.13, sd * 11.71));
	if (r.w > uIntensity) return vec3(0.0);

	// The cell's clock. Its fractional part is where this drop is in its life; its
	// integer part is the *generation* number, and that turns out to matter more
	// than anything else in this function.
	//
	// A cell holds one drop at a time, so when a drop runs off, another forms. If
	// every generation shares the cell's single hash, the replacement is identical
	// to the drop that just left — same place, same size — and the pane stops
	// reading as weather and starts reading as lamps blinking in fixed positions.
	// *That*, not the parking, is what makes big drops look frozen. Re-hashing per
	// generation gives each new drop its own place, size and sway.
	float tt   = t * mix(0.24, 0.58, r.y) * uSpeed + r.z * 7.13;
	float ph   = fract(tt);
	vec4  q    = h42(id * 1.7 + vec2(floor(tt) * 13.31 + sd * 5.0, floor(tt) * 7.77));

	// \`rest\` is the share of the cycle spent parked, and it is what lets one layer
	// be "big drops that mostly sit" and another "small drops that mostly run",
	// out of the same code.
	float s    = clamp((ph - rest) / (1.0 - rest), 0.0, 1.0);
	float y0   = mix(0.52, 0.92, q.x);        // where this generation condensed
	float y    = mix(y0, 0.08, s * s);
	// Growth is fast relative to the wait: a drop reaches its size in the first
	// third of its parked time and then just sits there. Spreading the growth over
	// the whole rest period leaves most of the pane permanently half-formed.
	float grow = smoothstep(0.0, rest * 0.35, ph);
	float amp  = grow * (1.0 - smoothstep(0.86, 1.0, s));

	float x0   = (q.y - 0.5) * 0.18;
	float sway = q.w * 29.0;
	// Hard-capped, not just scaled: at the top of the Drop size range an uncapped
	// radius would overhang the cell and every big drop would show a flat chord
	// where its neighbour was never evaluated. The cap makes the largest drops
	// saturate while the small ones keep growing, so the slider still reads.
	// The 1.15 is the wobble's overshoot — the budget is spent on the lumpy outline,
	// not the nominal radius.
	// r.y squared, not cubed: a cube pins almost every drop at the bottom of its
	// range, and with several layers of it the whole pane turns to grit.
	float rad  = min(mix(0.14, 0.36, q.z * q.z) * uDropSize, 0.33) * mix(0.55, 1.0, grow);
	float unit = 1.0 / cells.x;                    // one cell width, in glass units

	float room = max(0.0, 0.47 - abs(x0) - rad * 1.15);

	// Head. Bottom-heavy and lumpy even at rest, stretched further along travel
	// while it is moving.
	vec2 d = iso(f - vec2(pathX(y, x0, sway, room), y), aspect);
	d.y /= 1.0 + s * 0.45;
	d = wobble(sag(d, rad), rad, r.x + sd);
	float hc   = cap(dot(d, d), rad) * amp;
	float head = smoothstep(0.0, 0.16, hc);

	// The rest only exists above the head, and only once it has moved.
	// smoothstep with edge0 > edge1 is undefined in GLSL, not a descending ramp —
	// every falling edge below is written as 1 - smoothstep for that reason.
	// The trail ends where this drop actually started, not at the top of the cell.
	float behind = smoothstep(0.0, 0.02, f.y - y)
	             * (1.0 - smoothstep(y0 - 0.05, y0 + 0.01, f.y)) * step(0.002, s);
	float fresh  = 1.0 - clamp((f.y - y) / max(1e-3, y0 - y), 0.0, 1.0);
	float slat   = f.x - pathX(f.y, x0, sway, room);   // signed: beads sit on one side
	float lat    = abs(slat);

	// The corridor: glass wiped clear. This, not a bright line, is what the eye
	// reads as "something ran down here".
	float swath = (1.0 - smoothstep(rad * 0.4, rad * 2.4, lat)) * behind * mix(0.4, 1.0, fresh) * amp;

	// Beads left in the corridor. One sub-cell along the path may hold one bead, so
	// the streak is a chain of droplets rather than a drawn stroke.
	float nb   = 11.0 + 9.0 * q.y;
	float ty   = f.y * nb;
	float br   = h11(floor(ty) * 1.37 + q.y * 53.0 + sd * 7.0);
	float brad = rad * (0.18 + 0.40 * br) * mix(0.25, 1.0, fresh);
	vec2  bd   = iso(vec2(slat - (br - 0.5) * rad * 0.7, (fract(ty) - 0.5) / nb), aspect);
	bd = wobble(sag(bd, brad), brad, br + sd);
	float bc   = cap(dot(bd, bd), brad) * behind * step(0.36, br) * amp * uTrail;

	// The ribbon still joined to the drop. It dries over a fixed distance rather
	// than over the length of the cell, so a long streak trails off into beads —
	// and it is a rounded section, not a ridge, or it refracts as a hairline scratch.
	float fw   = max(1e-4, rad * mix(0.10, 0.55, fresh) * exp(-(f.y - y) * 4.5));
	float film = cap(lat * lat, fw) * behind * amp * uTrail;

	float height = max(hc * rad, max(bc * brad, film * fw)) * unit * FLATTEN;
	float water  = max(head, smoothstep(0.0, 0.16, max(bc, film)));
	return vec3(height, water, max(swath, water));
}

// ── standing water ────────────────────────────────────────────────────────────
// Most of the water on a real pane never goes anywhere: beads from a millimetre
// down to specks, everywhere, slowly breathing. They are what makes the glass feel
// cold — and they are what a runner is *for*, since it wipes them out of its path.
vec2 beading(vec2 p, float cells, vec2 radRange, float cover, float t, float sd) {
	vec2 g  = p * cells;
	vec2 id = floor(g);
	vec2 f  = fract(g);
	vec4 r  = h42(id + vec2(sd * 17.31, sd * 91.77));
	if (r.z > cover) return vec2(0.0);
	// Size has to come off a different component than presence, or thinning the
	// field out would also shrink whatever survives — at low condensation you get
	// fewer drops, not a pane of specks.
	float sz  = fract(r.z * 7.31 + r.x * 3.17);
	vec2  c   = vec2(0.36) + 0.28 * r.xy;
	// A sawtooth here would snap every bead back to its smallest size once a cycle;
	// staggered across the field that is a constant faint popping.
	float rad = mix(radRange.x, radRange.y, sz * sz)
	          * mix(0.5, 1.0, 0.5 + 0.5 * sin(t * 0.07 + r.w * 6.2832));
	vec2  d   = wobble(sag(f - c, rad), rad, r.x + sd);
	float k   = cap(dot(d, d), rad);
	return vec2(k * rad / cells * FLATTEN, smoothstep(0.0, 0.16, k));
}

// ── the pane ──────────────────────────────────────────────────────────────────
// (height, clarity, standing-water coverage, total water coverage)
vec4 pane(vec2 p, float t, float wipe) {
	// Wind tilts the lanes rather than pushing drops sideways inside them, which
	// keeps heads and trails attached and keeps everything clear of the cell edges.
	p.x += uWind * 0.55 * p.y + sin(p.y * 5.3) * 0.012;

	// Lanes are *very* tall — a cell is the whole distance a drop gets to travel, and
	// a runner that only crosses a fifth of the pane never reads as one. The cost is
	// that there are few big cells on screen at a time, which is also what a real
	// window looks like: long streaks are rare, small ones are everywhere.
	//
	// The \`rest\` ladder is the important part. Water on vertical glass stays put
	// only until its own weight beats the contact line holding it, and that
	// threshold is a *size*: past a couple of millimetres nothing stays. So the big
	// layer is not a separate kind of thing that sits forever — it is a runner that
	// parks for four fifths of its life and then goes. Every large drop on this pane
	// is on its way somewhere, which is the whole difference between rain and
	// bubble wrap.
	vec3 a = runners(p, vec2( 9.0,  1.3), t * 0.52, 1.0, 0.78);
	vec3 b = runners(p, vec2(17.0,  3.0), t * 0.82, 2.0, 0.64);
	vec3 c = runners(p, vec2(27.0,  6.0), t * 1.15, 3.0, 0.50);
	vec3 d = runners(p, vec2(44.0, 13.0), t * 1.50, 4.0, 0.36);

	vec2 run = merge(merge(vec2(a.x, a.y), vec2(b.x, b.y)),
	                 merge(vec2(c.x, c.y), vec2(d.x, d.y)));
	float clear = max(max(max(a.z, b.z), max(c.z, d.z)), wipe);

	// Five octaves with deliberately *overlapping* size bands, merged rather than
	// max'd. That is what produces the pattern condensation actually makes: not a
	// field of separate circles but clusters of unequal drops fused along their
	// contact lines, with a few big irregular bodies where several have run together.
	//
	// uMist buys *more* glass covered, not taller drops. Scaling height instead
	// leaves the same sparse field refracting harder, which reads as a greasy pane
	// rather than a cold one.
	// Condensation is never even. Where the glass is a touch colder, or where a drop
	// ran an hour ago, it beads differently — so the coverage is modulated by a very
	// low-frequency noise. An evenly-seeded field is the other big tell, after
	// perfect circles: it reads as a texture rather than as weather.
	float uneven = mix(0.58, 1.26, vnoise(p * 1.35 + 11.0)) * mix(0.78, 1.12, vnoise(p * 3.1));
	// Standing water is now *only* the small stuff — the sizes that really do stay
	// pinned. Anything bigger has to come from a runner layer, so that it moves.
	float cv = clamp(uMist, 0.0, 1.4) * uneven;
	vec2 m = beading(rot(p, 0.37), 24.0, vec2(0.17, 0.30), 0.44 * cv, t, 5.0);
	m = merge(m, beading(rot(p, 1.94), 38.0, vec2(0.16, 0.31), 0.66 * cv, t, 9.0));
	m = merge(m, beading(rot(p, 0.91), 60.0, vec2(0.16, 0.32), 0.86 * cv, t, 4.0));
	m = merge(m, beading(rot(p, 2.63), 94.0, vec2(0.17, 0.33), 1.00 * cv, t, 6.0));

	m *= 1.0 - smoothstep(0.0, 0.45, clear);

	// Runners merge with the standing water too — a drop sliding past a bead pulls
	// it in instead of passing over it like a decal.
	vec2 all = merge(run, m);
	return vec4(all.x, clamp(max(run.y, clear), 0.0, 1.0), m.y, clamp(all.y, 0.0, 1.0));
}

// ── scene, at three focal depths ──────────────────────────────────────────────
vec3 scene(vec2 uv, float b) {
	uv = clamp(uv, 0.0015, 0.9985);
	b = clamp(b, 0.0, 1.0);
	vec3 s = texture(uBg0, uv).rgb;
	vec3 m = texture(uBg1, uv).rgb;
	vec3 h = texture(uBg2, uv).rgb;
	return b < 0.5 ? mix(s, m, b * 2.0) : mix(m, h, b * 2.0 - 1.0);
}

void main() {
	vec2 uv = gl_FragCoord.xy / uRes;
	vec2 p  = (gl_FragCoord.xy - 0.5 * uRes) / uPx;
	float t = uTime;

	float wipe = texture(uText, uv).r;

	vec4  P = pane(p, t, wipe);
	float e = 1.7 / uPx;
	float hx = pane(p + vec2(e, 0.0), t, wipe).x;
	float hy = pane(p + vec2(0.0, e), t, wipe).x;
	vec2  n  = vec2(hx - P.x, hy - P.x) / e;

	// The cap's slope runs to infinity at the rim. Left alone that samples halfway
	// across the picture and reads as noise, so it saturates instead.
	float nl = length(n);
	n *= 1.0 / (1.0 + nl * 0.22);

	// Refraction. The gradient points uphill, so stepping against it looks *through*
	// the drop the way a lens does — the image inside inverts, the rim smears.
	vec2 off = -n * uRefract * 0.075 * (uPx / uRes.y);
	vec2 buv = (uv + off - 0.5) * uBgScale + 0.5 + uBgOffset;

	// Water in the way clears the fog; bare cold glass and beading scatter it.
	float blur = clamp(mix(uBlur, 0.0, P.y) + P.z * 0.25, 0.0, 1.0);

	vec3 col = scene(buv, blur);

	// A drop is a bad lens: it splits the light it bends.
	if (uDisperse > 0.001) {
		float k = uDisperse * 0.12 * smoothstep(0.05, 0.5, P.w);
		col.r = scene(buv + off * k, blur).r;
		col.b = scene(buv - off * k, blur).b;
	}

	vec3 N = normalize(vec3(-n, 1.0));
	vec3 H = normalize(vec3(-0.34, 0.50, 0.80) + vec3(0.0, 0.0, 1.0));
	float ndh = max(dot(N, H), 0.0);

	// A tight glint on the drop shoulders, and a broad sheen over anything wet.
	col += (pow(ndh, 220.0) * 2.2 + pow(ndh, 6.0) * 0.10 * P.w)
	     * uSpecular * vec3(0.74, 0.85, 1.0);

	// Water is not perfectly clear, and a rim seen at a glancing angle is dark.
	col *= 1.0 - smoothstep(0.35, 2.2, nl) * 0.30;
	col = mix(col, col * vec3(0.88, 0.94, 1.05), P.z * 0.45);

	// Lightning lands hardest on the water, which is what makes it read as coming
	// from outside — but it must not flatten the picture, so it is a lift, not a wash.
	col += uFlash * (0.06 + 0.26 * P.w) * vec3(0.62, 0.74, 0.98);
	col *= uBright;

	vec2 q = uv - 0.5;
	col *= 1.0 - 0.42 * pow(clamp(dot(q, q) * 2.0, 0.0, 1.0), 1.35);

	col += (h11(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)) + fract(t) * 91.3) - 0.5) * uGrain;

	fragColor = vec4(max(col, 0.0), 1.0);
}
`;

// Helpers
function Lu(gl){ const t=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,t); gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([0,0,0,255])); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR); return t; }
function Dm(){ const c=document.createElement("canvas"); c.width=c.height=2; const x=c.getContext("2d"); x.fillStyle="#000"; x.fillRect(0,0,2,2); return c; }
function Om(gl, vsSrc, fsSrc){ const vs=Hd(gl,gl.VERTEX_SHADER,vsSrc), fs=Hd(gl,gl.FRAGMENT_SHADER,fsSrc); const p=gl.createProgram(); gl.attachShader(p,vs); gl.attachShader(p,fs); gl.linkProgram(p); if(!gl.getProgramParameter(p,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); gl.deleteShader(vs); gl.deleteShader(fs); return p; }
function Hd(gl,type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){ const log=gl.getShaderInfoLog(s); const m=/ERROR: \d+:(\d+)/.exec(log); const ctx=m? "\n"+src.split("\n").slice(Math.max(0,+m[1]-3),+m[1]+2).join("\n"):""; throw new Error(log+ctx);} return s; }
function Mm(t){ if(t>1.6) return 0; const a=Math.exp(-t*26)*.85, b=Math.exp(-Math.abs(t-.14)*34), c=Math.exp(-Math.max(0,t-.2)*5.5)*.2; return Math.min(1,a+b+c); }

function xm(canvas, shaders){
  const gl = canvas.getContext("webgl2",{alpha:false,antialias:false,depth:false,stencil:false,powerPreference:"high-performance",preserveDrawingBuffer:false});
  if(!gl) throw new Error("WebGL2 is not available in this browser.");
  const prog = Om(gl, shaders.vert, shaders.frag);
  gl.useProgram(prog);
  const loc={}; const n=gl.getProgramParameter(prog,gl.ACTIVE_UNIFORMS);
  for(let i=0;i<n;i++){ const name=gl.getActiveUniform(prog,i).name; loc[name]=gl.getUniformLocation(prog,name); }
  const vao=gl.createVertexArray(); gl.bindVertexArray(vao);
  const texBg=[Lu(gl),Lu(gl),Lu(gl)], texText=Lu(gl);
  texBg.forEach((t,i)=>{ gl.activeTexture(gl.TEXTURE0+i); gl.bindTexture(gl.TEXTURE_2D,t); });
  gl.activeTexture(gl.TEXTURE0+3); gl.bindTexture(gl.TEXTURE_2D,texText);
  gl.uniform1i(loc.uBg0,0); gl.uniform1i(loc.uBg1,1); gl.uniform1i(loc.uBg2,2); gl.uniform1i(loc.uText,3);
  const params={...pf};
  let aspect=16/9;
  let pointer={x:0,y:0}, smooth={x:0,y:0};
  let flash=0, nextFlash=Infinity, flashAge=0, timeAcc=0, last=performance.now(), fpsVal=0, fpsAcc=0, fpsCount=0;
  function setBackground(img){
    const w=img.naturalWidth||img.width, h=img.naturalHeight||img.height;
    aspect=w/h;
    const scaleDown=Math.min(1,2200/Math.max(w,h));
    _m.forEach((m,i)=>{
      const pw=Math.max(4,Math.round(w*scaleDown*m.scale)), ph=Math.max(4,Math.round(h*scaleDown*m.scale));
      const c=document.createElement("canvas"); c.width=pw; c.height=ph;
      const ctx=c.getContext("2d"); const blur=m.blur*2;
      if(m.blur) ctx.filter=`blur(${m.blur}px)`;
      ctx.drawImage(img,-blur,-blur,pw+blur*2,ph+blur*2);
      gl.activeTexture(gl.TEXTURE0+i); gl.bindTexture(gl.TEXTURE_2D,texBg[i]);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,c);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
    });
  }
  function setTextMask(c){
    gl.activeTexture(gl.TEXTURE0+3); gl.bindTexture(gl.TEXTURE_2D,texText);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,c);
  }
  setTextMask(Dm());
  function resize(){
    const dpr=Math.min(window.devicePixelRatio||1,2)*params.renderScale;
    const w=Math.max(1,Math.round(canvas.clientWidth*dpr)), h=Math.max(1,Math.round(canvas.clientHeight*dpr));
    if(canvas.width!==w||canvas.height!==h){ canvas.width=w; canvas.height=h; gl.viewport(0,0,w,h); }
    return dpr;
  }
  function frame(now){
    const dt=Math.min(.1,(now-last)/1e3); last=now; timeAcc+=dt; fpsAcc+=dt; fpsCount++; if(fpsAcc>.5){ fpsVal=fpsCount/fpsAcc; fpsAcc=0; fpsCount=0; }
    const dpr=resize();
    const W=canvas.width, H=canvas.height;
    if(params.lightning>0){
      if(nextFlash===Infinity) nextFlash=timeAcc+Math.random()*4;
      if(timeAcc>nextFlash){ flashAge=0; nextFlash=timeAcc+60/params.lightning*(.5+Math.random()); }
      flashAge+=dt; flash=Mm(flashAge);
    } else { flash=0; nextFlash=Infinity; }
    smooth.x+=(pointer.x - smooth.x)*Math.min(1,dt*3);
    smooth.y+=(pointer.y - smooth.y)*Math.min(1,dt*3);
    const screenAspect=W/H;
    let bgScaleX, bgScaleY; if(aspect>screenAspect){ bgScaleX=screenAspect/aspect; bgScaleY=1; } else { bgScaleX=1; bgScaleY=aspect/screenAspect; }
    bgScaleX/=params.zoom; bgScaleY/=params.zoom;
    const parallax=Math.min((1-bgScaleX)/2,(1-bgScaleY)/2,.05)*params.parallax;
    gl.uniform2f(loc.uRes,W,H);
    const glassPx=Math.min(1e3,Math.max(440,Math.min(canvas.clientWidth,canvas.clientHeight)));
    gl.uniform1f(loc.uPx, glassPx*dpr*params.scale);
    gl.uniform1f(loc.uTime,timeAcc);
    gl.uniform2f(loc.uBgScale,bgScaleX,bgScaleY);
    gl.uniform2f(loc.uBgOffset,-smooth.x*parallax,-smooth.y*parallax);
    gl.uniform1f(loc.uIntensity,params.intensity);
    gl.uniform1f(loc.uSpeed,params.speed);
    gl.uniform1f(loc.uDropSize,params.dropSize);
    gl.uniform1f(loc.uTrail,params.trail);
    gl.uniform1f(loc.uWind,params.wind);
    gl.uniform1f(loc.uMist,params.mist);
    gl.uniform1f(loc.uRefract,params.refract);
    gl.uniform1f(loc.uDisperse,params.disperse);
    gl.uniform1f(loc.uSpecular,params.specular);
    gl.uniform1f(loc.uBlur,params.blur);
    gl.uniform1f(loc.uBright,params.bright);
    gl.uniform1f(loc.uFlash,flash);
    gl.uniform1f(loc.uGrain,params.grain);
    gl.drawArrays(gl.TRIANGLES,0,3);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return {
    params,
    setBackground,
    setTextMask,
    setPointer(x,y){ pointer.x=x; pointer.y=y; },
    get fps(){ return fpsVal; }
  };
}

// Background generators
function wd(w,h){ const c=document.createElement("canvas"); c.width=w; c.height=h; return {c, x:c.getContext("2d")}; }
function bf(ctx, x,y,r, col, a){ const g=ctx.createRadialGradient(x,y,0,x,y,r); g.addColorStop(0,`rgba(${col[0]},${col[1]},${col[2]},${a})`); g.addColorStop(.62,`rgba(${col[0]},${col[1]},${col[2]},${a*.78})`); g.addColorStop(.88,`rgba(${col[0]},${col[1]},${col[2]},${a*1.15})`); g.addColorStop(1,`rgba(${col[0]},${col[1]},${col[2]},0)`); ctx.fillStyle=g; ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill(); }
function Qd(ctx,w,h,a){ const g=ctx.createRadialGradient(w/2,h/2,Math.min(w,h)*.2,w/2,h/2,Math.max(w,h)*.78); g.addColorStop(0,"rgba(0,0,0,0)"); g.addColorStop(1,`rgba(0,0,0,${a})`); ctx.fillStyle=g; ctx.fillRect(0,0,w,h); }
const Ld = s => () => (s = s*1664525+1013904223>>>0)/4294967296;
function Xm(w=1800,h=1150){ const {c,x}=wd(w,h), r=Ld(20260818), g=x.createLinearGradient(0,0,0,h); g.addColorStop(0,"#050a14"); g.addColorStop(.42,"#0a1526"); g.addColorStop(.72,"#13233a"); g.addColorStop(1,"#0a1120"); x.fillStyle=g; x.fillRect(0,0,w,h); const cols=[[255,176,92],[255,214,150],[120,200,255],[255,120,110],[176,150,255],[140,255,214]]; const layers=[{n:620,y:[.44,.72],rad:[2,9],a:[.3,.7]},{n:260,y:[.52,.88],rad:[8,26],a:[.16,.42]},{n:46,y:[.4,.95],rad:[34,96],a:[.05,.13]}]; for(const L of layers) for(let i=0;i<L.n;i++){ const X=r()*w, Y=(L.y[0]+r()*(L.y[1]-L.y[0]))*h, R=L.rad[0]+r()*(L.rad[1]-L.rad[0]), A=L.a[0]+r()*(L.a[1]-L.a[0]); bf(x,X,Y,R,cols[r()*cols.length|0],A); } for(let i=0;i<9;i++){ const y=(.6+r()*.34)*h, gg=x.createLinearGradient(0,y,w,y+(r()-.5)*90); gg.addColorStop(0,"rgba(255,190,120,0)"); gg.addColorStop(.5,`rgba(255,190,120,${.05+r()*.06})`); gg.addColorStop(1,"rgba(255,190,120,0)"); x.fillStyle=gg; x.fillRect(0,y-12,w,24+r()*22); } Qd(x,w,h,.55); return c; }
function Lm(w=1800,h=1150){ const {c,x}=wd(w,h), r=Ld(770311), g1=x.createLinearGradient(0,0,0,h*.63); g1.addColorStop(0,"#1b1b3a"); g1.addColorStop(.45,"#4a3358"); g1.addColorStop(.78,"#a05a4c"); g1.addColorStop(1,"#e0894f"); x.fillStyle=g1; x.fillRect(0,0,w,h*.63); bf(x,w*.68,h*.63-26,w*.34,[255,196,128],.3); bf(x,w*.68,h*.63-26,w*.12,[255,232,190],.4); const g2=x.createLinearGradient(0,h*.63,0,h); g2.addColorStop(0,"#7a4a44"); g2.addColorStop(.3,"#2c2740"); g2.addColorStop(1,"#0e0e1c"); x.fillStyle=g2; x.fillRect(0,h*.63,w,h-h*.63); for(const L of [{ink:"#2a2340",hMax:.17,step:46,lit:.1},{ink:"#14111f",hMax:.27,step:68,lit:.22}]){ let cur=-40; while(cur<w+40){ const W=L.step*(.5+r()), H=h*L.hMax*(.35+r()*.65); x.fillStyle=L.ink; x.fillRect(cur,h*.63-H,W,H+8); for(let Y=h*.63-H+10; Y<h*.63-8; Y+=13) for(let X=cur+5; X<cur+W-6; X+=11) if(r()<=L.lit){ x.fillStyle=`rgba(255,196,128,${.25+r()*.5})`; x.fillRect(X,Y,4,6);} cur+=W+3+r()*12; } } for(let i=0;i<200;i++){ const X=r()*w, Y=h*.63+r()*(h-h*.63)*.8; x.fillStyle=`rgba(255,${170+r()*60|0},110,${.04+r()*.09})`; x.fillRect(X,Y,2+r()*5,8+r()*40); } Qd(x,w,h,.5); return c; }

// Note helpers
function qd(){ return {id:Math.random().toString(36).slice(2,9), text:"", updated:Date.now()}; }
const Rm = `WebKaro — Digital Experiences That Drive Real Growth
We partner with startups & growing businesses to design websites, SaaS platforms & digital products that create measurable impact
250+ Projects | 40+ Clients | 4.9/5 Rating
Website Design · Custom Software · Growth
Visit our main website — tap the button`;
function Nm(){ return {id:Math.random().toString(36).slice(2,9), text:Rm, updated:Date.now()}; }
function Cm(t){ const line=t.split("\n").find(s=>s.trim()); if(!line) return "Untitled"; const m=line.trim(); return m.length>30? m.slice(0,29)+"…":m; }
function Hm(t){ const lines=t.split("\n"), i=lines.findIndex(s=>s.trim()); return i<0?"": lines.slice(i+1).join("\n").replace(/^\n+/,""); }
function jm(id){ return (Zu.find(x=>x.id===id)||Zu[0]).css; }
function Bm(el){ return el.innerText.replace(/\r\n?/g,"\n").replace(/\n$/,""); }
function qm(k){ try{ return JSON.parse(localStorage.getItem(k)||"null"); }catch{ return null; } }
function Ym(){ const d=document.createElement("div"); return d.contentEditable="plaintext-only", d.contentEditable==="plaintext-only"; }
function Gm(el){ el.focus(); const r=document.createRange(); r.selectNodeContents(el); r.collapse(false); const s=getSelection(); s.removeAllRanges(); s.addRange(r); }

function Um({layer,sheet,onMask,onChange}){
  const c=document.createElement("canvas"), ctx=c.getContext("2d");
  let notes=[], active=null, fontSize=17, colour=Zu[0].id, needs=true, ticking=false, ready=false;
  const fire=()=>{ ready && onChange && onChange(); };
  if(!Ym()){ sheet.contentEditable="true"; sheet.addEventListener("paste",e=>{ e.preventDefault(); document.execCommand("insertText",false,e.clipboardData.getData("text")); }); }
  const cur=()=> notes.find(n=>n.id===active);
  function create(text=""){ const n={id:Math.random().toString(36).slice(2,9), text, updated:Date.now()}; notes.unshift(n); active=n.id; renderSheet(); save(); fire(); sheet.focus(); return n; }
  function select(id){ if(id===active || !notes.some(n=>n.id===id)) return; active=id; renderSheet(); save(); fire(); sheet.focus(); }
  function remove(id){ const i=notes.findIndex(n=>n.id===id); if(i<0) return; notes.splice(i,1); if(active===id){ if(!notes.length) notes.push(qd()); active=notes[Math.min(i,notes.length-1)].id; renderSheet(); } save(); fire(); }
  function renderSheet(){ const n=cur(); sheet.textContent=n? n.text:""; sheet.classList.toggle("empty",!sheet.textContent); sheet.scrollTop=0; schedule(); }
  sheet.addEventListener("input",()=>{ const n=cur(); if(!n) return; n.text=Bm(sheet); n.updated=Date.now(); sheet.classList.toggle("empty",!n.text); save(); schedule(); fire(); });
  sheet.addEventListener("keydown",e=>{ if(e.key==="Escape"){ e.preventDefault(); sheet.blur(); return; } e.stopPropagation(); });
  layer.addEventListener("pointerdown",e=>{ if(e.target===layer){ e.preventDefault(); Gm(sheet); }});
  function gather(){
    const out=[], rect=sheet.getBoundingClientRect();
    const walker=document.createTreeWalker(sheet, NodeFilter.SHOW_TEXT);
    const range=document.createRange();
    let node; while((node=walker.nextNode()) && out.length<Bd){
      const text=node.nodeValue;
      for(let i=0;i<text.length && out.length<Bd; i++){
        const isSurrogate=text.charCodeAt(i)>=55296 && text.charCodeAt(i)<=56319 ? 2:1;
        const ch=text.substr(i,isSurrogate); if(isSurrogate) i++;
        if(!ch.trim()) continue;
        const start=Math.max(0,i-isSurrogate+1);
        try{ range.setStart(node,start); range.setEnd(node,start+ch.length); }catch{ continue; }
        const r=range.getBoundingClientRect();
        if(!r.height) continue;
        if(r.bottom<rect.top+2 || r.top>rect.bottom-2) continue;
        // baseline offset
        const m=ctx.measureText("Mg"); const asc=m.fontBoundingBoxAscent||fontSize*.8, des=m.fontBoundingBoxDescent||fontSize*.2;
        const y=r.top + (r.height - asc - des)/2 + asc;
        out.push({ch, x:r.left, y});
      }
    }
    return out;
  }
  function draw(){
    const W=Math.max(2,Math.round(layer.clientWidth*wu)), H=Math.max(2,Math.round(layer.clientHeight*wu));
    if(c.width!==W||c.height!==H){ c.width=W; c.height=H; }
    ctx.setTransform(1,0,0,1,0,0); ctx.filter="none"; ctx.fillStyle="#000"; ctx.fillRect(0,0,W,H);
    ctx.scale(wu,wu); ctx.textBaseline="alphabetic";
    const glyphs=gather();
    if(glyphs.length){
      const sans=getComputedStyle(document.documentElement).getPropertyValue("--sans").trim();
      ctx.font=`300 ${fontSize}px ${sans||"sans-serif"}`;
      const blurs=[{blur:fontSize*.5,alpha:.42},{blur:fontSize*.135,alpha:1}];
      for(const {blur,alpha} of blurs){
        ctx.filter=`blur(${blur}px)`; ctx.fillStyle=`rgba(255,255,255,${alpha})`;
        for(const g of glyphs) ctx.fillText(g.ch,g.x,g.y);
      }
    }
    ctx.filter="none";
    onMask(c);
  }
  function schedule(){ needs=true; if(!ticking){ ticking=true; requestAnimationFrame(()=>{ ticking=false; if(needs){ needs=false; draw(); } }); } }
  function save(){ try{ localStorage.setItem(jd, JSON.stringify({notes:notes.map(({id,text,updated})=>({id,text,updated})), activeId:active, fontSize, colour})); }catch{} }
  function load(){ const data=qm(jd); if(data){ notes=(data.notes||[]).filter(n=>typeof n.text==="string"); active=data.activeId; if(data.fontSize) fontSize=data.fontSize; if(data.colour) colour=data.colour; } else { notes.push(Nm()); }
    if(!notes.length) notes.push(qd()); if(!notes.some(n=>n.id===active)) active=notes[0].id;
  }
  function applyStyle(){ document.documentElement.style.setProperty("--note-size",fontSize+"px"); document.documentElement.style.setProperty("--note-color",jm(colour)); schedule(); }
  function setFontSize(v){ fontSize=v; applyStyle(); save(); }
  function setColour(v){ colour=v; applyStyle(); save(); fire(); }
  addEventListener("resize",schedule);
  document.fonts?.ready.then(schedule);
  load(); applyStyle(); renderSheet(); ready=true;
  return {
    create, select, remove,
    setFontSize, setColour,
    list:()=> notes.map(n=>({id:n.id, title:Cm(n.text), body:Hm(n.text), updated:n.updated, active:n.id===active})),
    get fontSize(){ return fontSize; },
    get colour(){ return colour; }
  };
}

// Misc helpers
function Vm(v,step){ if(step>=1) return String(Math.round(v)); if(step>=.01) return v.toFixed(2); return v.toFixed(3); }
function Km(params, bg){ try{ localStorage.setItem(Zd, JSON.stringify({params, background:bg, panelOpen:!document.body.classList.contains("panel-closed")})); }catch{} }
function Yd(ts){ const s=(Date.now()-ts)/1e3; if(s<60) return "just now"; if(s<3600) return Math.floor(s/60)+"m ago"; if(s<86400) return Math.floor(s/3600)+"h ago"; if(s<604800) return Math.floor(s/86400)+"d ago"; return new Date(ts).toLocaleDateString(); }
function Jm(k){ try{ return JSON.parse(localStorage.getItem(k)||"null"); }catch{ return null; } }
function km(obj, defaults){ const out={}; if(!obj) return out; for(const k of Object.keys(defaults)) if(typeof obj[k]==="number" && isFinite(obj[k])) out[k]=obj[k]; return out; }
function Vu(src){
  // Try with anonymous CORS first (needed for cross-origin), fallback to no-crossOrigin for local/file:// or servers without CORS headers
  return new Promise((res,rej)=>{
    const tryLoad = (useCrossOrigin)=>{
      const i=new Image();
      if(useCrossOrigin) i.crossOrigin="anonymous";
      i.onload=()=>res(i);
      i.onerror=()=>{
        if(useCrossOrigin){
          // retry without CORS for same-origin / file://
          const j=new Image();
          j.onload=()=>res(j);
          j.onerror=()=>rej(new Error("Could not load "+src));
          j.src=src;
        } else rej(new Error("Could not load "+src));
      };
      i.src=src;
    };
    // For data: URLs, blob: and same-origin relative paths, try without CORS first if src is relative and we are file://
    if(src.startsWith("data:") || src.startsWith("blob:")){
      tryLoad(false);
    } else {
      tryLoad(true);
    }
  });
}
function Wm(img, max, q){ const s=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight)); const c=document.createElement("canvas"); c.width=Math.round(img.naturalWidth*s); c.height=Math.round(img.naturalHeight*s); c.getContext("2d").drawImage(img,0,0,c.width,c.height); return c.toDataURL("image/jpeg",q); }
const thumbCache=new Map();
async function Fm(bg){
  if(thumbCache.has(bg.id)) return thumbCache.get(bg.id);
  const src = await (bg.source || (bg.gen? Promise.resolve(bg.gen()): Vu(bg.src)));
  const c=document.createElement("canvas"); c.width=150; c.height=100;
  const w=src.naturalWidth||src.width, h=src.naturalHeight||src.height;
  const scale=Math.max(c.width/w, c.height/h);
  c.getContext("2d").drawImage(src,(c.width-w*scale)/2,(c.height-h*scale)/2,w*scale,h*scale);
  const url=c.toDataURL("image/jpeg",.7);
  thumbCache.set(bg.id,url); return url;
}
function Zm(params){ return Object.keys(Sf).find(k=> Object.entries(Sf[k]).every(([kk,v])=> Math.abs(params[kk]-v)<1e-6 ))||null; }
function av(id){ return Qe.find(x=>x.id===id); }
function nv(bg){ return bg.source || (bg.source = bg.gen? Promise.resolve(bg.gen()): Vu(bg.src)); }

// App bootstrap
const savedState = Jm(Zd) || {};
const customSrc = localStorage.getItem(Vd);
if(customSrc){ Qe.push({id:"custom", name:"Yours", src:customSrc, custom:true}); }

let glass=null, notesMgr=null;
let currentBg = Qe.some(b=>b.id===savedState.background) ? savedState.background : "tokyo";
let rev=0;
let presetName=null;
let savedFlashTimer=0;
const thumbs={};

const pane = document.getElementById("pane");
const notesLayer = document.getElementById("notes");
const sheet = document.getElementById("sheet");
const openBtn = document.getElementById("open");
const closeBtn = document.getElementById("close");
const presetRow = document.getElementById("preset-row");
const bgsEl = document.getElementById("bgs");
const fileInput = document.getElementById("file");
const effectRows = document.getElementById("effect-rows");
const textRows = document.getElementById("text-rows");
const filesEl = document.getElementById("files");
const filesCountEl = document.getElementById("files-count");
const gCountEl = document.getElementById("g-count");
const swatchesEl = document.getElementById("swatches");
const savedEl = document.getElementById("saved");
const fpsEl = document.getElementById("fps");
const cardsEl = document.getElementById("cards");
const galleryEl = document.getElementById("gallery");
const failEl = document.getElementById("fail");
const failMsg = document.getElementById("fail-msg");

// panel accordion
document.querySelectorAll(".acc-h").forEach(btn=>{
  btn.addEventListener("click",()=>{
    const sec=btn.closest(".acc");
    const isOpen=sec.classList.contains("open");
    document.querySelectorAll(".acc").forEach(s=>{ s.classList.remove("open"); s.querySelector(".acc-h")?.setAttribute("aria-expanded","false"); });
    if(!isOpen){ sec.classList.add("open"); btn.setAttribute("aria-expanded","true"); }
  });
});

function flashSaved(){
  savedEl.classList.add("flash");
  clearTimeout(savedFlashTimer);
  savedFlashTimer=setTimeout(()=> savedEl.classList.remove("flash"), 900);
}
function persist(){
  if(glass) Km(glass.params, currentBg);
}
function detectPreset(){
  presetName = Zm(glass.params);
  updateChips();
}
function updateChips(){
  [...presetRow.children].forEach(ch=> ch.classList.toggle("on", ch.dataset.preset===presetName));
}
function buildChips(){
  presetRow.innerHTML="";
  ["Drizzle","Shower","Downpour","Storm","Fogged"].forEach(name=>{
    const b=document.createElement("button");
    b.className="chip"+(presetName===name?" on":"");
    b.dataset.preset=name;
    b.textContent=name;
    b.addEventListener("click",()=>{
      Object.assign(glass.params, Sf[name]);
      rev++;
      refreshSliders();
      detectPreset();
      persist();
      flashSaved();
    });
    presetRow.appendChild(b);
  });
}
function buildBgs(){
  bgsEl.innerHTML="";
  Qe.forEach(bg=>{
    const btn=document.createElement("button");
    btn.className="bg"+(bg.id===currentBg?" on":"");
    btn.dataset.id=bg.id;
    btn.title=bg.name;
    if(thumbs[bg.id]) btn.style.backgroundImage=`url(${thumbs[bg.id]})`;
    const span=document.createElement("span"); span.textContent=bg.name;
    btn.appendChild(span);
    btn.addEventListener("click",()=> setBackground(bg.id));
    bgsEl.appendChild(btn);
  });
  const add=document.createElement("button");
  add.className="bg add"; add.title="Use your own photo"; add.textContent="+";
  add.addEventListener("click",()=> fileInput.click());
  bgsEl.appendChild(add);
}
function createSliderRow([key,label,min,max,step]){
  const row=document.createElement("div"); row.className="row";
  const lab=document.createElement("label"); lab.htmlFor="c-"+key; lab.textContent=label;
  const val=document.createElement("span"); val.className="val";
  const input=document.createElement("input"); input.type="range"; input.id="c-"+key; input.min=min; input.max=max; input.step=step;
  const getVal=()=> key==="noteSize"? notesMgr.fontSize : glass.params[key];
  val.textContent=Vm(getVal(),step);
  input.value=String(getVal());
  input.addEventListener("input",e=>{
    const v=parseFloat(e.target.value);
    val.textContent=Vm(v,step);
    if(key==="noteSize") notesMgr.setFontSize(v);
    else glass.params[key]=v;
    detectPreset();
    persist();
    flashSaved();
  });
  // keep in sync on external changes
  input._update=()=>{ const v=getVal(); input.value=String(v); val.textContent=Vm(v,step); };
  row.append(lab,val,input);
  return row;
}
let sliderInputs=[];
function buildSliders(){
  effectRows.innerHTML=""; textRows.innerHTML=""; sliderInputs=[];
  wm.forEach(sec=>{
    const div=document.createElement("div"); div.className="sec";
    const h2=document.createElement("h2"); h2.textContent=sec.title; div.appendChild(h2);
    sec.rows.forEach(r=>{
      const row=createSliderRow(r);
      div.appendChild(row);
      sliderInputs.push(row.querySelector("input"));
    });
    effectRows.appendChild(div);
  });
  Qm.forEach(sec=>{
    const div=document.createElement("div"); div.className="sec";
    const h2=document.createElement("h2"); h2.textContent=sec.title; div.appendChild(h2);
    sec.rows.forEach(r=>{
      const row=createSliderRow(r);
      div.appendChild(row);
      sliderInputs.push(row.querySelector("input"));
    });
    textRows.appendChild(div);
  });
}
function refreshSliders(){
  sliderInputs.forEach(inp=> inp._update && inp._update());
}
function buildSwatches(){
  swatchesEl.innerHTML="";
  Zu.forEach(c=>{
    const b=document.createElement("button");
    b.className="sw"+(c.id===notesMgr.colour?" on":"");
    b.style.background=c.css;
    b.title=c.id; b.setAttribute("aria-label","Text colour "+c.id);
    b.addEventListener("click",()=>{
      notesMgr.setColour(c.id);
      [...swatchesEl.children].forEach(x=> x.classList.remove("on"));
      b.classList.add("on");
      flashSaved();
    });
    swatchesEl.appendChild(b);
  });
}
function renderFiles(){
  const list=notesMgr.list();
  filesEl.innerHTML="";
  list.forEach(n=>{
    const div=document.createElement("div"); div.className="file"+(n.active?" on":"");
    const btn=document.createElement("button"); btn.className="fname";
    const t=document.createElement("span"); t.className="ft"; t.textContent=n.title;
    const d=document.createElement("span"); d.className="fd"; d.textContent=Yd(n.updated);
    btn.append(t,d);
    btn.addEventListener("click",()=>{ notesMgr.select(n.id); });
    const del=document.createElement("button"); del.className="fdel"; del.title="Delete note"; del.setAttribute("aria-label","Delete note"); del.textContent="×";
    del.addEventListener("click",()=>{ notesMgr.remove(n.id); });
    div.append(btn,del);
    filesEl.appendChild(div);
  });
  const countTxt=list.length+(list.length===1?" note":" notes");
  filesCountEl.textContent=countTxt;
  gCountEl.textContent=countTxt;
  // gallery cards
  cardsEl.innerHTML="";
  list.forEach(n=>{
    const card=document.createElement("button"); card.className="card"+(n.active?" on":"");
    const ct=document.createElement("span"); ct.className="c-t"; ct.textContent=n.title;
    const cb=document.createElement("span"); cb.className="c-b"; cb.textContent=n.body;
    const cd=document.createElement("span"); cd.className="c-d"; cd.textContent=Yd(n.updated);
    const cx=document.createElement("button"); cx.className="c-x"; cx.title="Delete note"; cx.setAttribute("aria-label","Delete note"); cx.textContent="×";
    cx.addEventListener("click",e=>{ e.stopPropagation(); notesMgr.remove(n.id); });
    card.append(ct,cb,cd,cx);
    card.addEventListener("click",()=>{ notesMgr.select(n.id); setGallery(false); });
    cardsEl.appendChild(card);
  });
  const newCard=document.createElement("button"); newCard.className="card new";
  const b=document.createElement("b"); b.textContent="+";
  const s=document.createElement("span"); s.textContent="New note";
  newCard.append(b,s);
  newCard.addEventListener("click",()=>{ notesMgr.create(); setGallery(false); });
  cardsEl.appendChild(newCard);
  // refresh swatches selection if colour changed elsewhere
  if(notesMgr){
    [...swatchesEl.children].forEach((el,i)=> el.classList.toggle("on", Zu[i].id===notesMgr.colour));
  }
}
function setGallery(open){
  const isOpen = typeof open==="boolean"? open : !document.body.classList.contains("gallery");
  document.body.classList.toggle("gallery", isOpen);
  galleryEl.setAttribute("aria-hidden", String(!isOpen));
}
function setPanel(open){
  const shouldOpen = typeof open==="boolean"? open : document.body.classList.contains("panel-closed");
  document.body.classList.toggle("panel-closed", !shouldOpen);
  persist();
}
async function setBackground(id, doPersist=true){
  const bg=av(id); if(!bg||!glass) return;
  currentBg=id;
  glass.setBackground(await nv(bg));
  [...bgsEl.children].forEach(el=> el.classList.toggle("on", el.dataset.id===id));
  if(doPersist){ persist(); detectPreset(); }
}
async function handleUpload(file){
  if(!file || !/^image\//.test(file.type)) return;
  const img=await Vu(URL.createObjectURL(file));
  const dataUrl=Wm(img,2200,.82);
  let bg=Qe.find(x=>x.custom);
  if(!bg){ bg={id:"custom", name:"Yours", custom:true}; Qe.push(bg); }
  bg.src=dataUrl; bg.source=Vu(dataUrl);
  try{ localStorage.setItem(Vd,dataUrl); }catch{}
  // update thumbs
  thumbs["custom"]="";
  thumbCache.delete("custom");
  const thumb=await Fm(bg).catch(()=>null);
  if(thumb) thumbs["custom"]=thumb;
  buildBgs();
  setBackground("custom");
}

// Init
try{
  glass = xm(pane, {vert:Im, frag:Pm});
  Object.assign(glass.params, km(savedState.params, pf));
  notesMgr = Um({layer:notesLayer, sheet, onMask: c=> glass.setTextMask(c), onChange: ()=>{ renderFiles(); flashSaved(); }});
  presetName = Zm(glass.params);
  // apply panel open state
  if(savedState.panelOpen) document.body.classList.remove("panel-closed");
  // build UI
  buildChips();
  buildSwatches();
  buildSliders();
  buildBgs();
  // load background thumbs
  Promise.all(Qe.map(async bg=>{
    try{ const t=await Fm(bg); thumbs[bg.id]=t; }catch{}
  })).then(()=>{
    document.querySelectorAll(".bg").forEach(el=>{
      const id=el.dataset.id;
      if(thumbs[id]) el.style.backgroundImage=`url(${thumbs[id]})`;
    });
  });
  setBackground(currentBg,false);
  renderFiles();

  // events
  openBtn.addEventListener("click",()=> setPanel(true));
  closeBtn.addEventListener("click",()=> setPanel(false));
  document.getElementById("reset").addEventListener("click",()=>{
    Object.assign(glass.params, pf);
    rev++; refreshSliders(); detectPreset(); persist(); flashSaved();
  });
  document.getElementById("new-note").addEventListener("click",()=> notesMgr.create());
  fileInput.addEventListener("change",e=> handleUpload(e.target.files?.[0]));
  document.getElementById("g-close").addEventListener("click",()=> setGallery(false));
  galleryEl.addEventListener("pointerdown",e=>{
    if(e.target.id==="gallery"||e.target.id==="cards") setGallery(false);
  });

  // fps
  setInterval(()=>{ fpsEl.textContent=Math.round(glass.fps)+" fps"; },500);

  // keyboard
  addEventListener("pointermove",e=>{
    glass.setPointer(e.clientX/innerWidth*2-1, e.clientY/innerHeight*2-1);
  },{passive:true});
  addEventListener("keydown",e=>{
    if(e.metaKey||e.ctrlKey||e.altKey) return;
    const k=e.key.toLowerCase();
    if(k==="h"){ document.body.classList.toggle("hide-ui"); e.preventDefault(); }
    else if(k==="p"||k==="`"){ setPanel(); e.preventDefault(); }
    else if(k==="s"){ setGallery(); e.preventDefault(); }
    else if(k==="escape"){ setGallery(false); }
  });
  // drag & drop
  let dragDepth=0;
  addEventListener("dragenter",e=>{ e.preventDefault(); if(++dragDepth===1) document.body.classList.add("dragging-file"); });
  addEventListener("dragover",e=> e.preventDefault());
  addEventListener("dragleave",()=>{ if(--dragDepth<=0){ dragDepth=0; document.body.classList.remove("dragging-file"); } });
  addEventListener("drop",e=>{ e.preventDefault(); dragDepth=0; document.body.classList.remove("dragging-file"); handleUpload(e.dataTransfer?.files[0]); });

  // handle resize for mask redraw
  addEventListener("resize",()=>{ /* xm handles canvas, notesMgr handles mask via its own listener */ });

} catch(err){
  console.error(err);
  failMsg.textContent=String(err.message||err);
  failEl.style.display="grid";
}
