'use strict';

//ES6 needs url's to identify modules, so we're going to use AMD instead
//here we'll fudge `define()` so it'll work with <script>-tag's ids
(() => {
	let modules = new Map();
	function getModule(id) {
		if (!modules.get(id)) {
			let module = {id, dependencies:[]};
			module.require = new Promise((resolve, reject) => {
				module.publish = resolve;
				module.error = reject;
			});
			modules.set(id, module);
		}
	  	return modules.get(id);
	}
	
	function immute(obj) {
		return {...obj};
	}
	
	function require({require}) {
		return require;
	}
	
	window.define = async ([x, y, ...dependencies], module) => {
		let id = document.currentScript.id;
		let container = getModule(id);
		let {publish, error} = container;
		container.dependencies = dependencies.map(getModule);
		delete container.publish;
		delete container.error;
		let success;
		
		function done(good, result) {
			((good) ? publish : error)(result);
			container.done = true;
		}

		success = false;
		try {
			if (!publish)
				throw `Module '${id}' is being registered twice`;
			
			let trace = [id];
			function circular({dependencies, id, done}) {
				trace.push(id);
				if (container.id == id)
					throw `Module '${container.id}' depends on itself via ${trace.map((id) => (`'${id}'`)).join(' -> ')}`;
				if (!done)
					dependencies.forEach(circular);
				trace.pop();
			}
			container.dependencies.forEach(circular);
			success = true;
		}
		finally {
			if (!success)
				done(false, `Error during setup for module '${id}'`);
		}
		
		success = false;
		try {
			if (dependencies.length)
				console.info(`Module '${id}' waiting for ${container.dependencies.map(({done, id}) => (`'${id}'${(done) ? '*' : ''}`)).join(', ')}`);
			dependencies = await Promise.all(container.dependencies.map(require));
			console.info(`Running module '${id}'`);
			success = true;
		}
		finally {
			if (!success)
				done(false, `Module '${id}' has a broken dependency`);
		}

		success = false;
		try {
			let exports = {};
			module(null, exports, ...dependencies.map(immute));
			done(true, exports);
			success = true;
		}
		finally {
			if (!success)
				done(false, `Module '${id}' failed to execute`);
		}
	};
})();