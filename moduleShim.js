'use strict';

let immute = (obj) => ({...obj});
let require = ({require}) => (require);

//ES6 needs url's to identify modules, so we're going to use AMD instead
//here we'll fudge `define()` so it'll work with <script>-tag's ids
class Module {
	static modules = new Map();
	static get = (id) => {
		if (!this.modules.get(id))
			this.modules.set(id, new Module(id));
	  	return this.modules.get(id);
	};

	constructor(id) {
		this.id = id;
		this.dependencies = [];
		this.require = new Promise((resolve, reject) => {
			this.publish = resolve;
			this.error = reject;
		});
		//there is no way to tell if a Promise has been fulfilled
		this.done = false;
	}

	init(dependencies) {
		let {publish, error} = this;
		if (!publish)
			throw `Module '${this.id}' is being registered twice`;
		this.dependencies = dependencies.map(Module.get);
		delete this.publish;
		delete this.error;
		return {publish, error};
	}

	circular() {
		let trace = [];
		let circular = ({dependencies, id, done}) => {
			trace.push(id);
			if (trace.length > 1 && id == this.id)
				throw `Module '${this.id}' depends on itself via ${trace.map((id) => (`'${id}'`)).join(' -> ')}`;
			if (!done)
				dependencies.forEach(circular);
			trace.pop();
		};
		circular(this);
	}
}
	
window.define = async ([x, y, ...dependencies], module) => {
	let id = document.currentScript.id;
	let container = Module.get(id);
	let publish, error;

	//making sure nomatter how we were 'done' the state is recorded
	let done = (good, result) => {
		((good) ? publish : error)(result);
		container.done = true;
	};
	//a way of attempting a function, and should it throw, both
	//letting the exception bubble -and- 'capture' it at the same time
	let attempt = async (what, error) => {
		let success = false;
		try {
			await what();
			success = true;
		}
		finally {
			if (!success)
				done(false, error);
		}
	};

	await attempt(() => {
		({publish, error} = container.init(dependencies));
		container.circular();
	}, `Error during setup for module '${id}'`);
	
	await attempt(async () => {
		if (dependencies.length)
			console.info(`Module '${id}' waiting for ${container.dependencies.map(({done, id}) => (`'${id}'${(done) ? '*' : ''}`)).join(', ')}`);
		dependencies = await Promise.all(container.dependencies.map(require));
	}, `Module '${id}' has a broken dependency`);

	await attempt(() => {
		console.info(`Running module '${id}'`);
		let exports = {};
		//non-standard behaviour; returning an object becomes the export
		done(true, module(null, exports, ...dependencies.map(immute)) || exports);
	}, `Module '${id}' failed to execute`);
};