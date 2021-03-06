var SecureWorkerInternal = require('./build/Release/secureworker_internal');

var w = new SecureWorkerInternal('duk_enclave/duk_enclave.signed.so');
w.handlePostMessage = function (message) {
	console.log('from w:', message);
};
w.init('main.js');

/*
var SIG_HEX = 'CB28E0999B9C7715FD0A80D8E47A77079716CBBF917DD72E97566EA1C066957C86FA3BB4E26CAD5BF90B7F81899256CE7594BB1EA0C89212748BFF3B3D5B0315';
var DATA_HEX = '616263';
w.emitMessage(JSON.stringify({
	signature: SIG_HEX,
	data: DATA_HEX,
}));
*/

w.close();

/*
var s = new SecureWorkerInternal('duk_enclave/duk_enclave.signed.so').bootstrapMock(new Uint8Array([65, 66, 67]), new Uint32Array([68, 69, 70]));
console.log(new Buffer(new Uint8Array(s)));
*/
