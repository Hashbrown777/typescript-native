'use strict';
//cant use module because it breaks for local file

class TypeScript {
	constructor({
		version  = 'release-3.8',
		app      = 'application',
		compiler = `https://raw.githubusercontent.com/microsoft/TypeScript/${version}/lib/typescriptServices.js`
	}) {
		//TODO shouldn't need this soon
		this.app = app;

		this.sourceStrings = this.pullSources();
		this.ts = this.pullCompiler(compiler);
	}

	//we have to collect all the code first because the compiler is not async
	//this lets us do performance measurements on compilation much easier anyway
	async pullSources() {
		let sourceStrings = new Map();
		this.types = new Map();

		let wait = [];
		let putCode = (id, code) => {
			if (sourceStrings.get(id))
				throw `Module '${id}' specified twice`;
			sourceStrings.set(id, code);
		};
		let fetchCode = (id, src) => {
			wait.push((async () => { putCode(id, await (await fetch(src)).text()); })());
		};

		for (let code of document.querySelectorAll('script[type$="/typescript"]')) {
			let type = code.type.replace(/^(.*)\/typescript$/, '$1');
			if (!this.types.has(type))
				this.types.set(type, []);
			this.types.get(type).push(code.id);
		
			if (type == this.app)
				code.remove();
			if (code.hasAttribute('src'))
				fetchCode(code.id, code.getAttribute('src'));
			else
				putCode(code.id, code.text);
		}

		await Promise.all(wait);
		return sourceStrings;
	}

	async pullCompiler(compiler) {
		this.transpiler = document.createElement('iframe');
		this.transpiler.sandbox = 'allow-scripts allow-same-origin';
		this.transpiler.style.display = 'none';
		document.body.appendChild(this.transpiler);
		let tag = this.transpiler.contentDocument.createElement('script');
		tag.text = await (await fetch(compiler)).text();
		this.transpiler.contentDocument.body.appendChild(tag);

		return this.transpiler.contentWindow.ts;
	}

	async compile(options = {}) {
		let ts = await this.ts;
		let sourceStrings = await this.sourceStrings;

		let timer = performance.now();

		let output = new Map();
		let failed = true;
		try {
			let sourceFiles = new Map();
			let host = {
				useCaseSensitiveFileNames : () => (true),
				getDefaultLibFileName     : () => ('lib.d.ts'),
				getCanonicalFileName      : (fileName) => (fileName),
				getCurrentDirectory       : () => { console.warn('asked for current directory'); return '/'; },
				getDirectories            : (path) => { console.warn('asked for directories'); throw ''; },
				getNewLine                : () => ('\n'),
				writeFile                 : (fileName, content) => { output.set(fileName, content); },
				fileExists                : (fileName) => (sourceStrings.has(fileName)),
				readFile                  : (fileName) => (sourceStrings.get(fileName)),
				resolveModuleNames        : (moduleNames, containingFile) => (
					moduleNames.map((fileName) => {
						if (host.fileExists(`${fileName}.ts`))
							return {resolvedFileName:`${fileName}.ts`};
						if (host.fileExists(`${fileName}.tsx`))
							return {resolvedFileName:`${fileName}.tsx`};
						if (host.fileExists(`${fileName}/index.d.ts`))
							return {resolvedFileName:`${fileName}/index.d.ts`};
						if (host.fileExists(`${fileName}/index.ts`))
							return {resolvedFileName:`${fileName}/index.ts`};
						if (host.fileExists(`${fileName}.d.ts`))
							return {resolvedFileName:`${fileName}.d.ts`};
					})
				),
				getSourceFile             : (fileName, languageVersion, onError) => {
					if (!sourceStrings.has(fileName))
						return undefined;
					if (!sourceFiles.has()) {
						sourceFiles.set(
							fileName,
							ts.createSourceFile(fileName, host.readFile(fileName), languageVersion)
						);
					}
					return sourceFiles.get(fileName);
				}
			};
			let program = ts.createProgram(this.types.get(this.app), options, host);
			let emit = program.emit();
			
			
			failed = emit.emitSkipped;
			for (let diagnostic of [
				...ts.getPreEmitDiagnostics(program),
				...emit.diagnostics
			]) {
				let message = ts.flattenDiagnosticMessageText(diagnostic.messageText, host.getNewLine());
				if (diagnostic.file) {
					message = {message, ...diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)};
					message = `${diagnostic.file.fileName} (${message.line + 1},${message.character + 1}): ${message.message}`;
				}
				console.warn(message);
			}
		}
		finally {
			console[(failed) ? 'error' : 'info'](`Compilation took ${((performance.now() - timer) / 1000).toFixed(3)}s`);

			for (let [id, code] of output.entries()) {
				let tag = document.createElement('script');
				tag.text = code;
				tag.id = id.replace(/[.]js$/, '');
				document.body.appendChild(tag);
			}
		}
	}

	_destroy() {
		this.transpiler.remove();
	}
}