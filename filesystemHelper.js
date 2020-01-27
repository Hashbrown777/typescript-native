//allows me to run files locally
//note, chrome will need the `--allow-file-access-from-files` flag added to its runtime call
let node = document.currentScript;
if (/^file:\/\/\//.test(location.href)) {
	let path = node.getAttribute('data-root');
//	let base = document.createElement('base');
//	base.setAttribute('href',  path);
//	node.parentNode.insertBefore(base, node.nextSibling);

	let orig = fetch;
	window.fetch = (resource) => ((/^[^/:]*:/.test(resource)) ?
		orig(resource) :
		new Promise(function(resolve, reject) {
			let request = new XMLHttpRequest();

			let fail = (error) => {reject(error)};
			['error', 'abort'].forEach((event) => { request.addEventListener(event, fail); });

			let pull = (expected) => (new Promise((resolve, reject) => {
				if (
					request.responseType == expected ||
					(expected == 'text' && !request.responseType)
				)
					resolve(request.response);
				else
					reject(request.responseType);
			}));

			request.addEventListener('load', () => (resolve({
				arrayBuffer : () => (pull('arraybuffer')),
				blob        : () => (pull('blob')),
				text        : () => (pull('text')),
				json        : () => (pull('json'))
			})));
			request.open('GET', resource.replace(/^\//, path));
			request.send();
		})
	);
}