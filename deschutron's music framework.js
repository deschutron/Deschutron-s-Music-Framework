Object.assign(document.body.style, {backgroundColor: "#100", color: "#ede"});
ac = new AudioContext();
(adest = global_ga = ac.createGain())
	.connect(global_ws = ac.createWaveShaper())
	.connect(ac.destination);
global_ga.gain.value = 1/16;
global_ws.curve = new Float32Array([-1, 1]);
sleep = x => new Promise(resolve => setTimeout(resolve, 1000*x));
nop = x=>x;
movu = (x, y) => x !== undefined ? x : y;
Object.defineProperty(Array.prototype, "f32_biarray", {get() {
	return [x=>x.re, x=>x.im].map(f => new Float32Array(this.map(f)))
}});
Array.prototype.with = function(...xs) {return (
	Object.assign([], this, ...xs)
);};

// Rest
function Rest(length = 1) {this.length = length;}
Rest.from_number = (x, parent = {}) => new Rest([
	x.nl,
	x.note_length,
	parent.nl,
	parent.note_length
].reduce(movu));
Rest.prototype.play = function() {return new Promise(resolve =>
	setTimeout(resolve, 1000*this.length)
);};
// TEST: new Rest().play().then(_=>console.log("done"));
Rest.prototype.change_tempo = function(x) {
	return new Rest(x*this.length);
};
Rest.prototype.change_pitch = function(x) {return this;};
Rest.prototype.change_speed = Rest.prototype.change_tempo;
Rest.prototype.amplify = Rest.prototype.change_pitch;
Rest.prototype.to_number = function() {
	return [].with({nl: this.length});
};
Rest.prototype.toString = function() {
	const dots = function f(x, rv = "") {
		return x < 1 ? rv : f(x - 1, rv + ".");
	}(this.length/.25 - 1);
	return `𝄽${dots}`;
};

// MusicNote
function MusicNote(fr = 440, length = 1, H = [0, 1], P = 1, dest = adest) {
	Object.assign(this, {fr:fr, length:length, H:H, P:P, dest:dest});
}
MusicNote.from_number = (x, parent = {}) => new MusicNote(
	x.mul([x.key, parent.key, 440].reduce(movu)),
	[x.nl, x.note_length, parent.nl, parent.note_length].reduce(movu),
	[x.H, x.timbre, parent.H, parent.timbre].reduce(movu),
	...["P", "dest"].map(k => movu(x[k], parent[k]))
);
MusicNote.prototype.play = function() {return new Promise(resolve => {
	const start_t = ac.currentTime;
	const os = ac.createOscillator();
	const ga = ac.createGain();
	os.connect(ga).connect(this.dest);
	os.frequency.value = this.fr.abs;
	if (this.fr.inputs !== undefined)
		this.fr.inputs.forEach(x => x.connect(os.frequency));
	MusicNote.apply_gain({P: this.P, fr: this.fr.abs}, ga);
	MusicNote.apply_H(this.H.mul(this.fr.sign), os);
	os.onended = resolve;
	os.start();
	os.stop(start_t + this.length);
});};
MusicNote.apply_gain = function({P, fr}, ga, Δt = 0) {
	const t = ac.currentTime + Δt;
	if (P.inputs !== undefined)
		P.inputs.forEach(x => x.connect(ga.gain));
	if (P instanceof Envelope)
		return P.play(ga, fr);
	//ga.gain.value = 440*P/fr;
	const gain_val = 440*P/fr;
	if (P.type === "lin")
		ga.gain.linearRampToValueAtTime(gain_val, t);
	else if (P.type === "exp")
		ga.gain.exponentialRampToValueAtTime(gain_val, t);
	else /* "step" or no value */
		ga.gain.setValueAtTime(gain_val, t);
};
MusicNote.apply_H = function(H, os) {
	if (H instanceof HarmonicMelody)
		return H.play(os);
	const {disableNormalization = false} = H;
	const dno = {disableNormalization: disableNormalization};
	os.setPeriodicWave(ac.createPeriodicWave(...H.f32_biarray, dno));
};
// TEST: new MusicNote(440).play().then(_=>new MusicNote(1.25*440).play()).then(_=>new MusicNote(660).play());
MusicNote.prototype.to_number = function(key = 440) {
	return (this.fr.div(key)).with({
		nl: this.length,
		H: this.H,
		P: this.P,
		dest: this.dest
	});
};
MusicNote.prototype.toString = function() {
	const dots = function f(x, rv = "") {
		return x < 1 ? rv : f(x - 1, rv + ".");
	}(this.length/.25 - 1);
	return `♩${dots}(${this.fr})`;
};
MusicNote.prototype.change_tempo = function(x) {
	return new MusicNote(
		this.fr,
		this.length/x,
		this.H instanceof HarmonicMelody ?
			this.H.change_tempo(x)
		:
			this.H,
		this.P instanceof Envelope ?
			this.P.change_tempo(x)
		:
			this.P,
		this.dest
	);
};
MusicNote.prototype.change_pitch = function(x) {
	return new MusicNote(
		x.mul(this.fr),
		this.length,
		this.H,
		this.P,
		this.dest
	);
};
MusicNote.prototype.change_speed = function(x) {
	return this.change_pitch(x).change_tempo(x);
};
MusicNote.prototype.amplify = function(x) {
	/* TODO: allow complex amplitude factors
	    that change the phase of the note via H. */
	return new MusicNote(
		this.fr,
		this.length,
		this.H.amplify(this.sign),
		this.P instanceof Envelope ?
			this.P.amplify(x.abs)
		:
			x*this.P,
		this.dest
	);
};

function Envelope(Ps) {
	this.Ps = Ps.map(P =>
		P instanceof Envelope ?
			P
		:
			P.with({
				nl: [
					P.nl, P.note_length, Ps.nl, Ps.note_length, 1
				].reduce(movu),
				type: movu(P.type, Ps.type)
			})
	);
}
/** @param ga the gain node to control.
    @param start the envelope point to start at. (default: 0)
    This method doesn't take a while to execute like the other play methods.
    Instead it passes the job of waiting to the gain node,
    via MusicNote.apply_gain.
 */
Envelope.prototype.play = function(ga, fr, start = 0, Δt = 0) {
	if (start >= this.Ps.length) return;
	let next_Δt = Δt;
	MusicNote.apply_gain({P: this.Ps[start], fr: fr}, ga, Δt);
	next_Δt = Δt + this.Ps[start].nl;
	this.play(ga, fr, start+1, next_Δt);
};
Envelope.prototype.change_tempo = function(x) {
	return new Envelope(this.Ps.map(P =>
		P instanceof Envelope ?
			P.change_tempo(x)
		:
			P.with({nl: P.nl/x})
	));
};
Envelope.prototype.amplify = function(x) {
	return new Envelope(this.Ps.map(P =>
		P instanceof Envelope ?
			P.amplify(x)
		:
			P.mul(x).with(P.extra)
	));
};

function HarmonicMelody(Hs) {
	this.Hs = Hs.map(H =>
		H instanceof HarmonicMelody ?
			H
		: H.nl !== undefined ?
			H
		:
			H.with({nl: [H.note_length, Hs.nl, Hs.note_length, 1].reduce(movu)})
	);
}
HarmonicMelody.prototype.play = async function(os, start = 0) {
	if (start >= this.Hs.length) return;
	MusicNote.apply_H(this.Hs[start], os);
	await sleep(this.Hs[start].nl);
	this.play(os, start+1);
};
HarmonicMelody.prototype.change_tempo = function(x) {
	return new HarmonicMelody(this.Hs.map(H =>
		H instanceof HarmonicMelody ?
			H.change_tempo(x)
		:
			H.with({nl: H.nl/x})
	));
};
/** Doesn't actually apmplify the sound, but can change the phase.
    Named this way for consistency.
    Complex (or -ve) numbers add phase to numbers.
    Complex (or -ve) amplitude factors add phase to harmonies.
 */
HarmonicMelody.prototype.amplify = function(x) {
	return new HarmonicMelody(this.Hs.map(H =>
		H instanceof HarmonicMelody ?
			H.amplify(x)
		:
			H.mul(x).with(H.extra)
	));
};
/** Make multiplying a HarmonicMelody by x the same as
    multiplying its invidual harmony arrays by x,
    since HarmonicMelody stands in for such a type of array. */
HarmonicMelody.prototype.mul = HarmonicMelody.prototype.amplify;
/** In base @param b.
 */
HarmonicMelody.from_number = function(x, b = 10) {
	const digit = x.mod(b);
	if (x.div(b).re < 1..div(b).re) {
		return [];
	}
	return [
		digit.div(b),
		...HarmonicMelody.from_number(x.sub(digit).div(b), b)
	].with(x.extra);
};
HarmonicMelody.from_numbers = (xs, b) => new HarmonicMelody(
	xs
		.map(x => HarmonicMelody.from_number(x, b))
		.with(xs.extra)
);

// Chord
/** @param notes must be an array of things with a .play method,
    e.g. MusicNotes, Rests, Chords and Melodies.
    It will play them all at once.
 */
function Chord(notes = []) {
	this.notes = notes;
}
Chord.from_numbers = (xs, parent = {}) => (
	[Melody, Chord, MusicNote, Rest].some(Y => xs instanceof Y) ? xs :
	!(xs instanceof Array) ? MusicNote.from_number(xs, parent) :
	!xs.length ? Rest.from_number(xs, parent) :
	new Chord(xs.map(x =>
		Melody.from_numbers(x, Object.assign({}, parent, xs))
	))
);
Chord.prototype.play = async function(start = 0) {
	if (start >= this.notes.length) return;
	this.play(start+1);
	await this.notes[start].play();
};
Object.defineProperties(Chord.prototype, {
	length: {get() {return (
		!this.notes.length ? 0 :
		this.notes[0].length
	);}},
	to_numbers: {get() {return (
		(function recur(notes, start) {return (
			start >= notes.length ? [] :
			[
				[
					notes[0].to_numbers,
					notes[0].to_number,
					notes[0]
				].reduce(movu),
				...recur(notes, start+1)
			]
		);})(this.notes, 0)
	);}}
});
Object.assign(Chord.prototype, {
	toString() {return (
		`C(${this.notes.toString()})`
	);},
	change_pitch(x) {
		return new Chord(
			!this.notes.length ? [] :
			[
				this.notes[0].change_pitch(x),
				...new Chord(this.notes.slice(1)).change_pitch(x).notes
			]
		);
	},
	change_tempo(x) {
		return new Chord(
			!this.notes.length ? [] :
			[
				this.notes[0].change_tempo(x),
				...new Chord(this.notes.slice(1)).change_tempo(x).notes
			]
		);
	},
	change_speed(x) {
		return new Chord(
			!this.notes.length ? [] :
			[
				this.notes[0].change_speed(x),
				...new Chord(this.notes.slice(1)).change_speed(x).notes
			]
		);
	},
	amplify(x) {
		return new Chord(
			!this.notes.length ? [] :
			[
				this.notes[0].amplify(x),
				...new Chord(this.notes.slice(1)).amplify(x).notes
			]
		);
	},
	slice(...xs) {
		return new Chord(this.notes.slice(...xs));
	}
});

// Melody
/** @param notes must be an array of things with a .play method.
    e.g. MusicNotes, Rests, Chords and Melodies.
    It will play them one by one.
 */
function Melody(notes = []) {
	this.notes = notes;
}
Melody.from_numbers = (xs, parent = {}) => (
	[Melody, Chord, MusicNote, Rest].some(Y => xs instanceof Y) ? xs :
	!(xs instanceof Array) ? MusicNote.from_number(xs, parent) :
	!xs.length ? Rest.from_number(xs, parent) :
	new Melody(xs.map(x =>
		Chord.from_numbers(x, Object.assign({}, parent, xs))
	))
);
Melody.prototype.play = async function(start = 0) {
	if (start >= this.notes.length) return;
	await this.notes[start].play();
	await this.play(start+1);
};
Object.defineProperties(Melody.prototype, {
	length: {get() {return (
		(function recur(notes, start) {
			start >= notes.length ? 0 :
			notes[0].length + recur(notes, start+1)
		})(this.notes, 0)
	);}},
	to_numbers: {get() {return (
		(function recur(notes, start) {return (
			start >= notes.length ? [] :
			[
				[
					notes[0].to_numbers,
					notes[0].to_number,
					notes[0]
				].reduce(movu),
				...recur(notes, start+1)
			]
		);})(this.notes, 0)
	);}},
	toString() {return (
		`M(${this.notes.toString()})`
	);}
});

Object.assign(Melody.prototype, {
	/** @param x is a factor to change the pitch by,
	    e.g. if x is two, then it will go up by an octave.
     */
	change_pitch(x) {
		/* This function works by passing the buck
		   to the things in the Melody. */
		return new Melody(
			!this.notes.length ? [] :
			[
				this.notes[0].change_pitch(x),
				...new Melody(this.notes.slice(1)).change_pitch(x).notes
			]
		);
	},
	change_tempo(x) {
		return new Melody(
			!this.notes.length ? [] :
			[
				this.notes[0].change_tempo(x),
				...new Melody(this.notes.slice(1)).change_tempo(x).notes
			]
		);
	},
	change_speed(x) {
		return new Melody(
			!this.notes.length ? [] :
			[
				this.notes[0].change_speed(x),
				...new Melody(this.notes.slice(1)).change_speed(x).notes
			]
		);
	},
	amplify(x) {
		return new Melody(
			!this.notes.length ? [] :
			[
				this.notes[0].amplify(x),
				...new Melody(this.notes.slice(1)).amplify(x)
			]
		);
	},
	slice(...xs) {
		// It would be nice to change this to a lazy function,
		// but this will work well enough for most things:
		return new Melody(this.notes.slice(...xs));
	}
});

// TEST: Melody.from_numbers([1,1.25,1.5,[3..with({nl:.5}),1.25,1.5],2]).play()


inc = x => x.inc;
function range(start, ended, step = 1) {return (
	step === 0 ?
		(_=>start).ible()
	: ended.sub(start).div(step).re <= 0 ?
		nop.ible(0, _=>false)   /* like [] */
	:
		[start, ...range(start.add(step), ended, step)]
);}

function n_from(start, n = 0, step = 1, k = 0) {return (
	step === 0 ?
		(_=>start).ible()
	: k >= n ?
		nop.ible(0, _=>false)
	:
		[start, ...n_from(start.add(step), n, step, k + 1)]
);}

τ = 2*Math.PI;
dobo = document.body;
Complex = class Complex {
	constructor(re, im = 0) {
		this.re = Number(re);
		this.im = im;
	}
	static from(re, im = 0) {
		if (!im) return (
			Number(re)
		);
		return new Complex(re, im);
	}
	static fromString(str, im = 0) {
		return str
			.split("+")
			.map(x => x.trim())
			.map(x =>
				/i/.test(x) ?
					Complex.from(0, +x.replace("i", "") + (""+x === "i"))
				:
					Complex.from(+x, 0)
			)
			.reduce((x, y) => x.add(y));
	}
	static store(...xs) {
	}
	get abs() {
		return Math.hypot(this.re, this.im);
	}
	get sign() {
		return Complex.from(this.re/this.abs, this.im/this.abs);
	}
	get arg() {return (
		!this.sign ? Complex.from(NaN, NaN) :
		(({nore, noim} = this.sign) =>
			(noim < 0)*(τ/2) + Math.acos(nore)
		)()
	);}
	get cis() {
		return this.mul(i).exp;
	}
	get exp() {
		/*const getter =
			Object.getOwnPropertyDescriptor(Complex.prototype, "exp").get;
		const cachee = ({x: this, f: getter});
		if (Complex.cache.includes(cachee))
			return Complex.cache.get(cachee);*/

		const ci = Math.cos(this.im);
		const si = (x =>
			x.abs <= Math.sin(τ).abs ? 0 :
			x
		)(
			Math.sin(this.im)
		);
		return Math.exp(this.re)
			.mul(Complex.from(ci, si));


		/*return Complex.cache.load({x: this, g_name: "exp"}, _=>{
			const ci = Math.cos(this.im);
			const si = (x =>
				x.abs <= Math.sin(τ).abs ? 0 :
				x
			)(Math.sin(this.im));
			return Math.exp(this.re)
				.mul(Complex.from(ci, si));
		});*/
	}
	get cos() {
		return (this.mul(i).exp) .add (this.mul(i).neg.exp)
		                         .div(2);
	}
	get sin() {
		return (this.mul(i).exp) .sub (this.mul(i).neg.exp)
		                      .div(2,i);
	}
	get log() {
		return Complex.from(Math.log(this.abs), this.arg);
	}
	get inc() {
		return Complex.from(this.re + 1, this.im);
	}
	get dec() {
		return Complex.from(this.re - 1, this.im);
	}
	add(...them) {return (
		!them.length ? this :
		((w = them.reduce((x, y) => x.add(y))) =>
			Complex.from(this.re + w.re, this.im + w.im)
		)()
	);}
	mul(...them) {
		if (them[0] instanceof Array) return (
			them[0].scamul(this).mul(...them.slice(1))
		);
		if (!them.length) return this;
		const w = them.reduce((x, y) => x.mul(y));
		const z = this;
		return Complex.from(z.re*w.re - z.im*w.im, z.re*w.im + z.im*w.re);
	}
	get neg() {
		return Complex.from(-this.re, -this.im);
	}
	get conj() {
		return Complex.from(this.re, -this.im);
	}
	get inv() {
		const {re, im} = this;
		const k = re*re + im*im;
		return Complex.from(re/k, -im/k);
	}
	sub(...them) {
		const w = them.reduce((rv, x) => rv.add(x), 0);
		return this.add(w.neg);
	}
	div(...them) {
		const w = them.reduce((rv, x) => rv.mul(x), 1);
		if (w === undefined)
			throw `Can't div ${this} by ...${them}.`;
		return this.mul(w.inv);
	}
	toString() {
		return `${this.re}+${this.im}i`;
	}
	apply(thisArg, xs) {
		return this.call(...xs);
	}
	call(thisArg, ...xs) {
		return this.mul(...xs);
	}
	sqrt(n = 0) {
		return ((-1)**n).mul(
			Math.sqrt(this.abs),
			(this.arg/2).cis
		);
	}
	pow(...them) {
		if (!them.length) return this;
		if (them.length >= 2) return (
			this.pow(them[0]).pow(them.slice(1))
		);
		const that = them[0];
		return (
			that === -1 ? this.inv
			: that === 0 ? 1
			: that === 1 ? this
			: that === 2 ? this.mul(this)
			: !that.im && !this.im ?
				Math.pow(this.re, that.re)
			:
				that.mul(this.log).exp
		);
	}
	mod(that = 1) {return (
		that === 0 ?
			Complex.from(NaN, NaN)
		: this === 0 ?
			0
		: that.sign === 1 && this.sign === 1 ?
			this%that
		: /*((
			step = that.sign,
			para = this.div(step).re,
			perp = this.div(step).im
		) =>
			(para%1).add(perp).mul(step)
		)()*/
		this.sub(this.floor(that))
	);}
	floor(that = 1) {return (
		this === 0 ?
			0
		: that === 1 ?
			this.im === 0 ?
				Math.floor(this)
			:
				Math.floor(this.re)
		: ((
			step = that.sign,
			para = this.div(that).re,
			perp = this.div(that).im
		) =>
			Math.floor(para).mul(that)
		)()
	);}
	sfloor(that = 1) {return (
		that.sign === 1 ?
			this.abs.floor(that).mul(this.sign)
		:
			undefined
	);}
	smod(that = 1) {return (
		that.sign === 1 ?
			!this.im ?
				this % that
			:
				(this.abs%that).mul(this.sign)
		:
			undefined
	);}
	ceil(that = 1) {return (
		that === 1 && this.im === 0 ?
			Math.ceil(this)
		:
			this.floor(that).add(that)
	);}
	round(that = 1) {return (
		that === 1 && this.im === 0 ?
			Math.round(this)
		:
			this.add(that.div(2)).floor(that)
	);}
	cmp(...them) {return (
		them.every(that =>
			that.re === this.re &&
			that.im === this.im
		)
	);}
	with(...them) {return (
		Object.assign(Complex.from(+this.re, +this.im), this, ...them)
	);}
	get extra() {
		const rv = Object.assign({}, this);
		delete rv.re;
		delete rv.im;
		return rv;
	}
	get isNaN() {
		return isNaN(this.re) || isNaN(this.im);
	}
	get isFinite() {
		return isFinite(this.re) && isFinite(this.im);
	}
	trim_im(ε = 1) {
		return C(this.re, this.im.abs < ε ? 0 : this.im);
	}
};
Complex.cache = Object.assign([], {
	load({x, f, g_name, f_name, ys = []}, value_f) {
		 if (f === undefined) return this.load(
			{x: x, f: (
				f_name !== undefined ?
					Complex.prototype[f_name]
				:
					Object.getOwnPropertyDescriptor(
						Complex.prototype,
						g_name
					).get
			), ys},
			value_f
		);
		let rv;
		const includes = this.some(z =>
			z.x.cmp(x) && z.f === f ? ((rv = z.value),true) :
			false
		);
		if (includes) return rv;
		return (
			this[this.length] = {x:x, f:f, ys:ys, value: value_f.bind(x)(...ys)}
		).value;
	}
});
Complex.i = new Complex(0, 1);
i = Complex.i;
C = Complex.from;
Object.defineProperties(Number.prototype, {
	re:   {get() {return Number(this);}},
	im:   {value: 0},
	abs:  {get() {return Math.abs(this);}},
	sign: {get() {return Math.sign(this);}},
	arg:  {get() {
		const s = Math.sign(this);
		return (
			s === 1 ?
				0
			: s === -1 ?
				τ/2
			:
				NaN
		);
	}},
	cis:  {get() {return Complex.from(
		Math.cos(this),
		Math.sin(this)
	);}},
	exp: {get() {return Math.exp(this);}},
	log: {get() {return (
		this >= 0 ? Math.log(this) :
		Complex.from(Math.log(this.abs), this.arg)
	);}},
	inc: {get() {return this + 1;}},
	dec: {get() {return this - 1;}},
	add: {value: Complex.prototype.add},
	mul: {value: Complex.prototype.mul},
	neg: {get() {return -this;}},
	conj: {get() {return this;}},
	inv: {get() {return 1/this;}},
	sub: {value: Complex.prototype.sub},
	div: {value: Complex.prototype.div},
	apply: {value: Complex.prototype.apply},
	call: {value: Complex.prototype.call},
	sqrt: {value(n = 0) {return ((-1)**n).mul(
		this >= 0 ? Math.sqrt(this) :
		Complex.from(0, Math.sqrt(-this))
	);}},
	pow: {value: Complex.prototype.pow},
	mod: {value: Complex.prototype.mod},
	floor: {value: Complex.prototype.floor},
	ceil: {value: Complex.prototype.ceil},
	sfloor: {value: Complex.prototype.sfloor},
	smod: {value: Complex.prototype.smod},
	cmp: {value() {return +this === +that;}},
	isNaN: {get() {return isNaN(this);}},
	isFinite: {get() {return isFinite(this);}},
	round: {value: Complex.prototype.round},
	with: {value: function(...them) {
		return Object.assign(+this, this, ...them);
	}},
	cos: {get() {return Math.cos(this);}},
	sin: {get() {return Math.sin(this);}},
	extra: {get() {return Object.assign({}, this);}},
	trim_im: {value() {return +this;}}
});

exp = (x, ...ys) => x.mul(...ys).exp;
log_and_return = x => (console.log(x, ""),x);
Object.defineProperties(Array.prototype, {
	extra: {get() {
		return Object.keys(this)
			.filter(k => isNaN(+k) || k < 0 || k%0)
			.reduce((rv, k) => Object.assign(rv, {[k]: this[k]}), {});
	}},
	neg: {get() {
		return this.scamul(-1);
	}},
	re: {get() {
		return this.map(x => x.re);
	}},
	im: {get() {
		return this.map(x => x.im);
	}},
	mean: {get() {
		return this.Σ.div(this.length);
	}},
	Σ: {get() {return (
		!this.length ? this.length :
		this.reduce((x, y) => x.add(y))
	);}},
	ℱ: {get() {return ((N = this.length, scale = 1/N.sqrt()) =>
		this.map((_, k) =>
			this.map((x_n, n) =>
				x_n.mul(exp(-k*n/N,τ,i))
			).Σ.mul(scale)
		)
	)();}},
	iℱ: {get() {return ((N = this.length, scale = 1/N.sqrt()) =>
		this.map((_, k) =>
			this.map((x_n, n) =>
				x_n.mul(exp(k*n/N,τ,i))
			).Σ.mul(scale)
		)
	)();}},
	T: {get() {return (
		!this.length ? []
		: this.length === 1 ?
			!(this[0] instanceof Array) ? this :
			this[0]
		:
			this.map((x,i,L) =>
				!x.map ? x :
				x.map((_,j) =>
					L[j][i]
				)
			)
	);}},
	backwards: {get() {return (
		Object.assign([], this).reverse()
	);}}
});

Object.assign(Array.prototype, {
	scamul(...them) {
		if (!them.length) return this;
		const y = them.reduce((rv, x) => rv.mul(x));
		return this.map(x => x.mul(y));
	},
	dotmul(...them) {
		if (!them.length) return (
			this
		);
		if (them.length >= 2) return (
			this.dotmul(them[0]).dotmul(...them.slice(1))
		);
		const that = them[0];
		return this
			.map((x, n) => this[n].mul(that[n]))
			.reduce((rv, x) => x.add(y));
	},
	mul(that) {
		if (that instanceof Array) return undefined;
		return this.scamul(that);
	},
	html_table(hs) {return (
		`<table>\n${
			hs.length ?
				`\t<thead><th>${
					hs.map(h => (""+h).html_encode).join("</th><th>")
				}</th></thead>`
			:
				""
		}\t<tr><td>${
			this.map(x =>
				x instanceof Array ?
					x.map(y => (""+y).html_encode).join("</td><td>")
				:
					(""+x).html_encode
			).join("</td></tr>\n\t<tr><td>")
		}</td></tr>\n</table>`
	);},
	plot() {return `<svg width="${this.length}px" height="500px">\n\t${
		this.map((y, x) =>
			x === 0 ? "" :
			`<line
				x1="${x-1}" x2="${x}"
				y1="${250 - this[x-1].round()}" y2="${250 - y.round()}"
				style="stroke:currentcolor;stroke-width:1"
			/>`.replace("\n\t\t", " ")
		).join("")
		}</svg>`;
	}
});

Float32Array.prototype.toString = Array.prototype.toString;

Object.defineProperties(String.prototype, {
	html_encode: {get() {return (
		this
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/  /g, " &nbsp;")
			.replace(/\n /g, "\n&nbsp;")
			.replace(/\t/g, "&nbsp;".repeat(4))
			.replace(/\n/g, "<br/>")
	);}}
});
Object.assign(String.prototype, {
	map: Array.prototype.map,
	reduce: Array.prototype.reduce
});

msdest = ac.createMediaStreamDestination();
recorder = new MediaRecorder(msdest.stream);
recording = [];
recorder.ondataavailable = x => recording.push(x.data);
adest.connect(msdest);
recorder.onstop = x => {
	const url = URL.createObjectURL(new Blob(
		recording,
		{"type": "audio/ogg; codecs=opus"}
	));
	dobo.innerHTML += `<a href=${url}>recording at ${url}</a><br/>`;
	recording = [];
};

Object.assign(Function.prototype, {
	/**
	   f(start), f(step(start)), f(step²(start)), f(step³(start)), ...
	   until !continues(stepⁿ(start)).
	 */
	iterable(start_param, continues, step) {
		const start = arguments.length ? start_param : 0;
		return new FunctionIterable(this, start, continues, step);
	},
	/**
	   start, f(start), f²(start), f³(start), ...
	   until !continues(fⁿ(start)).
	 */
	recursive_iterable(start_param, continues) {
		const start = arguments.length ? start_param : 0;
		return new FunctionIterable(nop, start, continues, this);
	},
	map(that, this_this_arg = {}, that_this_arg = {}) {
		const [f, g] = [this, that];
		return function(...xs) {
			return f.call(this_this_arg, g.call(that_this_arg, ...xs));
		};
	},
	comp(that, this_this_arg = {}, that_this_arg = {}) {
		const [f, g] = [this, that];
		return function(...xs) {
			return f.call(this_this_arg, g.call(that_this_arg, ...xs));
		};
	},
	/**
	   Makes a function that is a cons-pair of a starting value @param first,
	   and this function.
	   (first . this function)
		@param first is the first value.
		@param start is the index on which the first value sits.
		By default, @param start is zero.
	 */
	cons(first, start_param, this_arg,
		dec = x => x === undefined ? undefined : x.dec
	) {
		const start =
			arguments.length >= 3 ? start_param :
			0;
		const bound_this =
			this_arg !== undefined ? this.bind(this_arg) :
			this;
		return (x, ...ys) =>
			x === start ? first :
			bound_this(dec(x), ...ys);
	}
});
Function.prototype.ible = Function.prototype.iterable;
Function.prototype.rible = Function.prototype.recursive_iterable;
cons = (start, rest, ...xs) => rest.cons(start, ...xs);

FunctionIterable = class FunctionIterable {
	constructor(f, start /* = 0 */, continues = _=>true, step = inc) {
		//let n = 0;
		Object.assign(this, {
			f: f,
			start: arguments.length >= 2 ? start : 0,
			continues: continues,
			step: step,
			loaded_length: 0,
			auto_eval_limit: 65536
		});
		const itor = this[Symbol.iterator]();
		const add_index = n => Object.defineProperties(this, {
			[n]: {get() {
				delete this[n];
				const {done, value} = itor.next();
				if (!done) {
					this[n] = value;
					add_index(n + 1);
					this.loaded_length = n + 1;
					//n++;
				} else {
					this.length = n;
					this.loaded_length = n;
				}
				return value;
			}, enumerable: true, configurable: true}
		});
		add_index(0);
	}
	[Symbol.iterator]() {return {
		f: this.f,
		start: this.start,
		step: this.step,
		continues: this.continues,
		next() {
			if (!this.continues(this.start)) return (
				{done: true}
			);
			const rv = this.f(this.start);
			this.start = this.step(this.start);
			return {value: rv, done: false};
		}
	};}
	at(n) {
		if (n < this.loaded_length) return (
			this[n]
		);
		if (this.length !== undefined && n >= this.length) return (
			undefined
		);
		const ignoree = this.at(n - 1);
		return this[n];
	}
	continues_at(n) {
		if (n < this.loaded_length) return (
			true
		);
		if (this.length !== undefined && n >= this.length) return (
			false
		);
		const ignoree = this.at(n);
		return this.continues_at(n);
	}
	map(g, this_arg) {
		return this.f.map(g, this_arg)
			.iterable(this.start, this.continues, this.step);
	}
	forEach(g, this_arg) {
		return [...this].forEach(g, this_arg);
	}
	reduce(g, start) {
		let o = Object(this);
		let len = this.length;
		let [rv, k] = arguments.length >= 2 ?
			[start, 0]
		:
			[this[0], 1];
		const limit = this.auto_eval_limit;
		while (o.length === undefined || k < o.length) {
			if (o.length === undefined && k >= limit) {
				throw `Passed limit (${limit} items) ` + 
					`on reducing a non-fully-calculated iterator.`;
			}
			const ov = o[k];
			if (o.length !== undefined && k >= o.length)
				break;
			rv = g(rv, ov, k, o);
			k++;
		}
		return rv;
	}
	slice(start = 0, end) {
		if (arguments.length < 2) return (
			!start ?
				this
			: start === 1 ?
				this.rest
			: start < 1 ?
				undefined
			: start > 1 ?
				this.slice(start - 1).rest
			:
				undefined
		);
		const rv = [];
		let ov;
		for (let n = 0; n < end; n++) {
			ov = this[n];
			if (n >= this.length)
				break;
			if (n >= start)
				rv.push(ov);
		}
		return rv;
	}
	take(n = 0) {
		return this.slice(0, n);
	}
	get rest() {
		return this.f.iterable(
			this.step(this.start),
			this.continues,
			this.step
		);
	}
	fill(x) {
		return this.map(_=>x);
	}
	/*cons(...xs) {
		const [first, start_param, this_arg, dec_param] = xs;
		const start = xs.length >= 2 ? start_param : this.start;
		return this.f.cons(...xs).iterable(
			start,
			x => x === start ? true : this.continues(x),
			this.step
		);
	}*/
	cons(first) {
		return new PrefixedIterable(first, this);
	}
	static get empty() {return nop.ible(0, _=>false);}
	scamul(x) {
		return this.map(y => y.mul(x));
	}
	mul(x) {
		return x.mul(this);
	}
	dotmul(...them) {
		return [...this].dotmul(...them);
	}
	/*
	add(that) {
		return (n => this.at(n).add(that[n])).ible(
			0,
			n =>
				this.length === undefined ||
				n < this.length ||
				that.length === undefined ||
				n < that.length,
		);
	}*/
	get f32_biarray() {
		return [x=>x.re, x=>x.im].map(f => new Floar32Array(this.map(f)));
	}
	with(...xs) {
		return Object.assign(
			new FunctionIterator(this.f, this.start, this.continues, this.step),
			...xs
		);
	}
	get extra() {
		return Object.keys(this).filter(k =>
			(isNaN(+k) || k < 0 || k %0) &&
			!["f", "start", "continues", "step", "length", "loaded_length"]
				.includes(k)
		).reduce((rv, k) => Object.assign(rv, {[k]: this[k]}), {});
	}
	get neg() {
		return this.scamul(-1);
	}
	get re() {
		return this.map(x => x.re);
	}
	get im() {
		return this.map(x => x.im);
	}
	get mean() {
		const Σ = this.Σ;
		return Σ.div(this.length);
	}
	get Σ() {return (
		!this.length ? this.length :
		this.reduce((x, y) => x.add(y))
	);}
	get ℱ() {
		const Σ = this.Σ;
		const N = this.length;
		return this.map((_,k) =>
			this.map((x_n, n) =>
				x_n.mul(exp(-k,n/N,τ,i))
			).Σ.div(N.sqrt())
		);
	}
	get backwards() {
		return [...this].reverse();
	}
	plot(...xs) {
		return [...this].plot(...xs);
	}
	toString() {
		return this.length === 0 ?
			"FI()"
		: this.length === 1 ?
			`FI(${this[0]})`
		:
			`FI(${this[0]}, ...)`;
	}
	/*some(f, this_arg) {
		const bound_f =
			this_arg !== undefined ? f.bind(this_arg) :
			f;
		const het_roi = n => (
			this.length !== undefined && n >= this.length :
			false;
		const limit = this.auto_eval_limit;
		return function recur(n = 0) {
			if (this.length === undefined && n >= limit)
				throw "I've hit my limit!";
			return het_roi(n) ? false :
				bound_f(n) || recur(n + 1);
		}();
	}
	every(f, this_arg) {
		const bound_f =
			this_arg !== undefined ? f.bind(this_arg) :
			f;
		return function recur(n = 0) {
			if (this.length === undefined) {
				if (n >= limit)
					throw "I've hit my limit!";
			} else
				return false;
			return bound_f(n) || recur(n + 1);
		}();
	}*/
};
PrefixedIterable = class PrefixedIterable {
	constructor(first, rest) {
		this.first = first;
		this.rest = rest;
		const itor = this[Symbol.iterator]();
		const add_index = n => Object.defineProperties(this, {
			[n]: {get() {
				delete this[n];
				const {done, value} = itor.next();
				if (!done) {
					this[n] = value;
					add_index(n + 1);
				} else
					this.length = n;
				return value;
			}, enumerable: true, configurable: true}
		});
		add_index(0);
	}
	*[Symbol.iterator]() {
		yield this.first;
		yield* this.rest;
	}
	cons(first) {
		return new PrefixedIterable(first, this);
	}
	map(f, this_arg) {
		const bound_f =
			this_arg !== undefined ? f.bind(this_arg) :
			f;
		const g = (x, k, L) =>
			k === 0 ? bound_f(this.first, k, L) :
			bound_f(x, k, L);
		return g.iterable(0, this.continues, 1);
	}
	continues_at(x) {
		return (
			x === 0 ? true :
			this.rest.continues_at(x - 1)
		);
	}
	continues(n) {
		return this.continues_at(n);
	}
	at(n) {
		return (
			n === 0 ? this.first :
			this.rest.at(n)
		);
	}
	f(x) {
		return this.at(x);
	}
	map(g, this_arg) {
		return bind(this.at, this).map(g, this_arg)
			.iterable(0, this.continues_at, 1);
	}
	forEach(g, this_arg) {
		return [...this].forEach(g, this_arg);
	}
	reduce(g, start) {
		let o = Object(this);
		let len = this.length;
		let [rv, k] =
			arguments.length >= 2 ?
				[start, 0]
			:
				[this[0], 1];
		const limit = this.auto_eval_limit;
		while (o.length === undefined || k < o.length) {
			if (o.length === undefined && k >= limit) {
				throw `Passed limit (${limit} items) ` + 
					`on reducing a non-fully-calculated iterator.`;
			}
			const ov = o[k];
			if (o.length !== undefined && k >= o.length)
				break;
			rv = g(rv, ov, k, o);
			k++;
		}
		return rv;
	}
	/** Unlike Array.prototype.slice, this one doesn't support negative indices.
	 */
	slice(start = 0, end) {
		if (end === undefined) return (
			start >= 1 ?
				this.rest.slice(start - 1)
			: !start ?
				this
			:
				undefined
		);
		if (start >= 1) return (
			this.rest.slice(start - 1, end - 1)
		);
		const rv = [];
		let ov;
		for (let n = 0; n < end; n++) {
			ov = this[n];
			if (n >= this.length)
				break;
			if (n >= start)
				rv.push(ov);
		}
		return rv;
	}
	take(n = 0) {
		return this.slice(0, n);
	}
	fill(x) {
		return (_=>x).ible(0, bind(this.continues_at, this));
	}
	mul(that) {
		if (that instanceof Array) return undefined;
		return this.scamul(that);
	}
	dotmul(...them) {
		return [...this].dotmul(...them);
	}
	scamul(...xs) {
		return this.rest.scamul(...xs).cons(this.first.mul(...xs));
	}
	get Σ() {
		return [...this].Σ;
	}
	get backwards() {
		return [...this].backwards;
	}
	get ℱ() {
		return [...this].ℱ;
	}
	get re() {
		return this.rest.re.cons(this.first.re);
	}
	get im() {
		return this.rest.im.cons(this.first.im);
	}
	get mean() {
		return [...this].mean;
	}
};

HMel = HarmonicMelody;
Enve = Envelope;

songs = {};
songs.sub_melody_test = Melody.from_numbers([
	1, 2, 3, [
		[4,6,7,8,9],
		[5,[],4,[],3]
	],[],8
].with({key:220, nl:.125}));
songs.xeb = Melody.from_numbers(
		[
			//  0    1    2    3    4    5    6    7    8    9    a    b    c    d    e    f
			    1,   2,[3,1.5],1,   1, 1.5,1.2,[2,3,4,5,6],7,4,   3,   4,[2,3,4],[],1.2, 1.5,
			    1,   2,[3,1.5],1,   1, 1.5,1.2,[2,3,4,5,6],7,4,   3,   4,[2,3,4],[],1.2, 1.5,
			    3,   3,   3,   3,   3,   3,   3, 3,[1.5,3],[1.2,3],[2,3],[6,3],1.5,1.2,2,  6,
			  1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5,   1,   2,[3,1.5],1,   1, 1.5, 1.2, [2,3,4,5,6],
			    7,   4,   3,   6,[1.5,3,4.5],...[1,1].map(x => x.with({nl: .1875})),
			    1,   2,[3,1.5],1,   1, 1.5,1.2,[2,3,4,5,6],7,4,   3,   4,[2,3,4],[],
				1,  [], 1.5,  [],   1,  [], 1.2,  [],   1,  [],   3,  [],   3,   [],1.2,  [],
				1,  [], 1.5,  [],   1,  [], 1.2,  [],   1,  [],   3,  [],   3,   [],1.2,  [],
				1,   1, 1.5, 1.5,   1,   1, 1.2, 1.2,   1,   1,   3,   3,   3,    3,1.2, 1.2,
				1,   1, 1.5, 1.5,   1,   1, 1.2, 1.2,   1,   1,   3,   4,   6,    3,1.2, 1.2,
			...[1,      1.5,        1,      1.2,        1,        3,        6,      1.2]
				.map(x => x.with({H: [0,1,-1,1,-1,1,-1], nl: 0.25})),
			...[1,   1, 1.5, 1.5,   1,   1, 1.2, 1.2,   1,   1,   3,   4,   6,   12, 12,  12]
				.map(x => x.with({H: [0,1,-1,1,-1,1,-1]})),
			    6,  12,   3,  12,   6,  12,   1.5, 12,  6,  12,   3,  12, 1.5,   12,
			   ...[9,6,4.5,3,1.5,1.125,.75,.5625,.375,.28125,.1875].map(x => x.with({nl: 0.0625})),
			   .375.with({nl: .5}), [],
			   .5625.with({nl: .25}), .75.with({nl: .5}),
			   1.125.with({nl: .25}), 1.5.with({nl: .5}),
   			    1,   2,[3,1.5],1,   1, 1.5,1.2,[2,3,4,5,6],7,4,   3,   4,[2,3,4],[],1.2, 1.5,
			    1,   2,[3,1.5],1,   1, 1.5,1.2,[2,3,4,5,6],7,4,   3,   4,[2,3,4],[],1.2, 1.5,
				3,   3,   3,   3,   3,   3,   3, 3,[1.5,3],[1.2,3],[2,3],[6,3],1.5,1.2,2,  6,
			  1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5,   1,   2,[3,1.5],1,   1, 1.5, 1.2, [2,3,4,5,6],
			    7,   4,   3,   6,[1.5,3,4.5],...[1,1].map(x => x.with({nl: .1875})),
			    1,   2,[3,1.5],1,   1, 1.5,1.2,[2,3,4,5,6],7,4,   3,   4,[2,3,4]
		].with({nl:.125, key:220, timbre: [0,1,.25,.0625,.015625,]})
	);

// Example uses:

// songs.xeb.play();

// Melody.from_numbers([1,[],1,[],1,[],1.2,1.5,1,[],1,[],1,1.2,1.8,1.5, 1,[],1,[],1,[],1.2,1.5,1,[],1,[],1,1.5,1.22,1.8].with({nl:.25})).play()

/*
Melody.from_numbers(
    [1, 1.2, 1.5, 1.2].with({
        H: new HarmonicMelody(
            Array(8).fill()
                .map((_,x) => ((-1)**x).with({nl:.03125*(x+1)}))
                .map(x => [0,1*x,.5,.25*x,.125,.0625*x].with({nl:x.nl}))
        ),
        key:220,
        nl: .5
    })
).play()
*/

/*
Melody.from_numbers([1,[],1,[],1,[],1.2,1.5,1,[],1,[],1,1.2,1.8,1.5, 1,[],1,[],1,[],1.2,1.5,1,[],1,[],1,1.5,1.22,1.8,1.75.with({nl:.05}),1.7,1.6,1.3,1.5,1.2,1.3,1.4,1.5].with({nl:.25,  key:110,       H: new HarmonicMelody(
            Array(4).fill()
                .map((_,x) => ((-1)**x).with({nl:.03125*(x+1)}))
                .map(x => [0,1*x,.5,.25*x,.125,.0625*x].with({nl:x.nl}))
        )})).play()
*/
// Melody.from_numbers([1,1.2,1.5,1.2,1,[[.8,.9,.85,1.1]].with({nl:.25}),.75].with({key: 13.25, nl:.5, H: [0,1,1,11,1,1,1,11,1]})).play()

// Melody.from_numbers([1, 1.2, 1.4, ...range(1.5, 1.25, -.025).map(x => x.with({nl:.0625})), 2].with({nl:.125})).play()
