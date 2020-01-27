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

	static normalisePath = (path) => ((/^([^/:]*:|\.\/{proto_[^}]*}\/)/.test(path)) ?
		path.replace(
			/^([^:]*):\/\/([^/:]+)(:?(\d+|))\/([^?]*(\.(ts|js|tsx|d\.ts)))(\?.*|)$/,
			'./{proto_$1}/$2/{port_$4}/$5/{query_$8}$6'
		) :
		path
			.split('/')
			.reduce((parts, part) => {
				switch (part) {
				case '':
				case '.':
					if (parts.length < 1)
						parts.push(part);
					break;
				case '..':
					switch (parts[parts.length - 1]) {
					case '..':
					case undefined:
						parts.push(part);
						break;
					case '':
						throw '';
					case '.':
						parts.pop();
						parts.push(part);
						break;
					default:
						parts.pop();
					}
					break;
				default:
					if (parts.length < 1)
						parts.push('.');
					parts.push(part);
				}
				return parts;
			}, [])
			.join('/')
	);

	//we have to collect all the code first because the compiler is not async
	//this lets us do performance measurements on compilation much easier anyway
	async pullSources() {
		let sourceStrings = new Map();
		this.types = new Map();
		this.nodes = new Map();

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

			let id = TypeScript.normalisePath(code.id || code.getAttribute('src'));
			this.nodes.set(id.replace(/[.](ts|js|tsx)$/, ''), code);
			this.types.get(type).push(id);

			if (code.hasAttribute('src'))
				fetchCode(id, code.getAttribute('src'));
			else
				putCode(id, code.text);
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

	async compile({
		options = {},
		warning = console.warn,
		normalisePath = TypeScript.normalisePath,
		output  = (id, code) => {
			id = normalisePath(id.replace(/[.]js$/, ''));
			let original = this.nodes.get(id);

			let tag = document.createElement('script');
			tag.text = code;
			tag.id = id;
			if (original)
				original.replaceWith(tag);
			else
				document.body.append(tag);
		},
		alias = (fileName, folder) => ((/^([^/:]*:|\.\/{proto_[^}]*}\/)/.test(fileName)) ?
			[fileName] :
			[
				...((folder = folder && folder.match(/^(.*\/)[^/]+$/)) ? alias(folder[1] + fileName) : []),
				...((/[.](ts|tsx|js)$/.test(fileName)) ?
					[fileName] :
					[
						`${fileName}.ts`,
						`${fileName}.tsx`,
						`${fileName}.d.ts`,
						`${fileName}/index.d.ts`,
						`${fileName}/index.ts`,
						`${fileName}/index.tsx`,
						`${fileName}.js`,
						`${fileName}.min.js`
					]
				)
			]
		)
	}) {
		let ts = await this.ts;
		let sourceStrings = await this.sourceStrings;

		let timer = performance.now();
let attempted = new Set();

		let failed = true;
		try {
			let sourceFiles = new Map();
			let host = {
				useCaseSensitiveFileNames : () => (true),
				getDefaultLibFileName     : () => ('lib.d.ts'),
				getCanonicalFileName      : normalisePath,
				getCurrentDirectory       : () => ('./'),
				getDirectories            : (path) => { throw 'unsupported'; },
				getNewLine                : () => ('\n'),
				writeFile                 : (id, code) => { setTimeout(output.bind(null, id, code), 1); },
				fileExists                : (fileName) => (sourceStrings.has(host.getCanonicalFileName(fileName))),
				readFile                  : (fileName) => (sourceStrings.get(host.getCanonicalFileName(fileName))),
				resolveModuleNames        : (moduleNames, containingFile) => {
					containingFile = host.getCanonicalFileName(containingFile);
					return moduleNames.map((fileName) => ({
						resolvedFileName : alias(
							host.getCanonicalFileName(fileName),
							containingFile
						)
							.reduce((match, url) => {
								url = host.getCanonicalFileName(url);
								if (match)
									;
								else if (host.fileExists(url))
									match = url;
//								else
else if (!attempted.has(url)) {
	attempted.add(url);
									//apparently it doesn't matter if the compiler isnt async
									//but I'd really like to find another way to do this for
									//when we dont have the prefab'd list
									let request = new XMLHttpRequest();
									let decode = url.match(/^\.\/{proto_([^}]*)}\/([^/]+)\/{port_([^}]*)}\/(.*)\/{query_(.*)}($|\.)/);
									if (decode) {
										decode = `${decode[1]}://${decode[2]}${decode[3] && (':' + decode[3])}/${decode[4]}${decode[5] && ('?' + decode[5])}`;
									}

									request.open('GET', decode || url, false);
									try {
										request.send();
										if (request.status == 200)
											sourceStrings.set(match = url, request.responseText);
									}
									catch (e) { }
								}
								return match;
							}, null)
					}));
				},
				getSourceFile             : (fileName, languageVersion, onError) => {
					if (!host.fileExists(fileName))
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
				warning(message);
			}
		}
		finally {
			console[(failed) ? 'error' : 'info'](`Compilation took ${((performance.now() - timer) / 1000).toFixed(3)}s`);
		}
	}

	_destroy() {
		this.transpiler.remove();
	}
}