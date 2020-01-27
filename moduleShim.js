'use strict';

let immute = (obj) => ({...obj});
let require = ({require}) => (require);

//ES6 needs url's to identify modules, so we're going to use AMD instead
//here we'll fudge `define()` so it'll work with <script>-tag's ids
class Module {
	static modules = new Map();
	static get = (id) => {
		id = TypeScript.normalisePath(id).replace(/\.(ts|tsx|js|d\.ts)$/, '');
		if (!id)
			throw 'Empty dependency';
		if (!this.modules.get(id))
			this.modules.set(id, new Module(id));
	  	return this.modules.get(id);
	};
	static valid = (name) => (name != 'require' && name != 'exports');

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
		this.dependencies = dependencies
			.filter(Module.valid)
			.map((url) => {
				if (!/^\//.test(url)) {
					let folder = this.id.match(/^(.*\/)[^/]+$/);
					if (folder)
						url = folder[1] + TypeScript.normalisePath(url);
				}
				return url;
			})
			.map(Module.get)
		;
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

let info = (document.currentScript.hasAttribute('data-log')) ?
	console.info :
	() => {}
;
	
window.define = async (dependencies, module) => {
	let container = (document.currentScript.id) ?
		Module.get(document.currentScript.id) :
		new Module('<anonymous>')
	;

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
	}, `Error during setup for module '${container.id}'`);
	
	let imports;
	await attempt(async () => {
		if (container.dependencies.length)
			info(`Module '${container.id}' waiting for ${container.dependencies.map(({done, id}) => (`'${id}'${(done) ? '*' : ''}`)).join(', ')}`);
		imports = await Promise.all(container.dependencies.map(require));
	}, `Module '${container.id}' has a broken dependency`);

	let exports = {};
	imports = dependencies.reduce(
		({index, output}, val) => {
			switch (val) {
			case 'require':
				output.push(null);
				break;
			case 'exports':
				output.push(exports);
				break;
			default:
				output.push(immute(imports[index++]));
			}
			return {index, output};
		},
		{index:0, output:[]}
	).output;
	await attempt(() => {
		info(`Running module '${container.id}'`);
		//non-standard behaviour; returning an object becomes the export
		done(true, module(...imports) || exports);
	}, `Module '${container.id}' failed to execute`);
};