var vm = require('vm');
var Promise = require('promise-polyfill');
var WebCrypto = require('node-webcrypto-ossl');
var MessagePort = require('./message-port');

var SecureWorker = function SecureWorker(contentKey) {
  var self = this;

  if (!(self instanceof SecureWorker)) {
    return new SecureWorker.apply(null, arguments);
  }

  self.createdCallback(contentKey);
};

SecureWorker.prototype.createdCallback = function createdCallback(contentKey) {
  var self = this;

  self._eventsFromOutside = new MessagePort();
  self._eventsFromInside = new MessagePort();

  var code = this.constructor._resolveContentKey(contentKey);
  var sandbox = this.constructor._sandboxContext(self, contentKey);

  self._context = vm.createContext(sandbox);
  self._vmGlobalContext = vm.runInContext('this', self._context);

  vm.runInContext(code, self._context, {
    filename: contentKey,
    displayErrors: true
  });
};

SecureWorker.prototype.onMessage = function onMessage(listener) {
  var self = this;

  self._eventsFromInside.addListener('message', listener);
  self._eventsFromInside.start();

  return listener;
};

SecureWorker.prototype.removeOnMessage = function removeOnMessage(listener) {
  var self = this;

  self._eventsFromInside.removeListener('message', listener);
};

SecureWorker.prototype.postMessage = function postMessage(message) {
  var self = this;

  // We want to simulate asynchronous messaging.
  setImmediate(function () {
    self._eventsFromOutside.emit('message', message);
  });
};

SecureWorker.prototype.terminate = function terminate() {
  var self = this;

  // TODO: Is there a way to implement this using "vm"? If there are no timers it should be possible?
  // A noop in this mock implementation.
};

var GLOBAL_PROPERTIES = [
  'NaN',
  'Infinity',
  'undefined',
  'Object',
  'Function',
  'Array',
  'String',
  'Boolean',
  'Number',
  'Date',
  'RegExp',
  'Error',
  'EvalError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'TypeError',
  'URIError',
  'Math',
  'JSON',
  //'Duktape',
  //'Proxy',
  'Buffer',
  'ArrayBuffer',
  'DataView',
  'Int8Array',
  'Uint8Array',
  'Uint8ClampedArray',
  'Int16Array',
  'Uint16Array',
  'Int32Array',
  'Uint32Array',
  'Float32Array',
  'Float64Array',
  'eval',
  'parseInt',
  'parseFloat',
  'isNaN',
  'isFinite',
  'decodeURI',
  'decodeURIComponent',
  'encodeURI',
  'encodeURIComponent',
  'escape',
  'unescape',
  //'print',
  //'alert',
  //'require'
  // TODO: Remove. Only for debugging. Not available in Duktape.
  'console'
];


GLOBAL_PROPERTIES = GLOBAL_PROPERTIES.filter(function (property, i, array) {
  if (!global.hasOwnProperty(property)) {
    throw new Error("Missing property in global context: " + property);
  }

  try {
    // We check if it already exists in the empty context provided by the vm module.
    vm.runInNewContext(property);
  }
  catch (error) {
    // It does not, we have to copy it over from outside the global context.
   return true;
  }

  // It does exist, we do not have to and also should not (to not override things like Array
  // which then become different from [].constructor) copy from the outside global context.
  return false;
});

// Class method for this mock implementation to allow specifying sandbox context.
SecureWorker._sandboxContext = function _sandboxContext(secureWorker, contentKey) {
  var beingImportedScripts = [];
  var alreadyImportedScripts = [contentKey];

  var crypto = new WebCrypto();

  var sandbox = {
    // Our internal trusted API.
    SecureWorker: {
      ready: Promise.resolve(),

      getName: function getName() {
        return contentKey;
      },

      // Callbacks are called only after SecureWorker.ready resolves.
      onMessage: function onMessage(listener) {
        secureWorker._eventsFromOutside.addListener('message', listener);

        sandbox.SecureWorker.ready.then(function () {
          secureWorker._eventsFromOutside.start();
        });

        return listener;
      },

      removeOnMessage: function removeOnMessage(listener) {
        secureWorker._eventsFromOutside.removeListener('message', listener);
      },

      postMessage: function postMessage(message) {
        // We want to simulate asynchronous messaging.
        setImmediate(function () {
          secureWorker._eventsFromInside.emit('message', message);
        });
      },

      close: function close() {
        secureWorker.terminate();
      },

      // In trusted environment on the server, SecureWorker.importScripts assures that
      // the script is loaded only once for a given content key.
      importScripts: function importScripts(/* args */) {
        for (var i = 0; i < arguments.length; i++) {
          var contentKey = arguments[i];

          if (alreadyImportedScripts.indexOf(contentKey) !== -1) continue;
          if (beingImportedScripts.indexOf(contentKey) !== -1) continue;
          beingImportedScripts.push(contentKey);

          try {
            var code = SecureWorker._resolveContentKey(contentKey);

            vm.runInContext(code, secureWorker._context, {
              filename: contentKey,
              displayErrors: true
            });

            // Successfully imported.
            alreadyImportedScripts.push(contentKey);
          }
          finally {
            var index;
            while ((index = beingImportedScripts.indexOf(contentKey)) !== -1) {
              beingImportedScripts.splice(index, 1);
            }
          }
        }
      },

      monotonicCounters: {
        // Returns an object {uuid:arraybuffer, value:number}.
        create: function create() {
          return SecureWorker._createMonotonicCounter(secureWorker._vmGlobalContext);
        },

        destroy: function destroy(counterId) {
          SecureWorker._destroyMonotonicCounter(secureWorker._vmGlobalContext, counterId);
        },

        // Returns the number.
        read: function read(counterId) {
          return SecureWorker._readMonotonicCounter(secureWorker._vmGlobalContext, counterId);
        },

        // Returns the number.
        increment: function increment(counterId) {
          return SecureWorker._incrementMonotonicCounter(secureWorker._vmGlobalContext, counterId);
        }
      },

      // Returns an object {currentTime:arraybuffer, timeSourceNonce:arraybuffer}.
      getTrustedTime: function getTrustedTime() {
        return SecureWorker._getTrustedTime(secureWorker._vmGlobalContext);
      },

      // Returns the report as arraybuffer. reportData is 64 bytes of extra information, arraybuffer.
      getReport: function getReport(reportData) {
        return SecureWorker._getReport(secureWorker._vmGlobalContext, reportData);
      }
    },

    Promise: Promise,

    crypto: crypto,

    nextTick: process.nextTick,

    setImmediate: process.nextTick
  };

  sandbox.Promise._setImmediateFn(process.nextTick);

  sandbox.self = sandbox;

  sandbox.global = sandbox;

  for (var i = 0; i < GLOBAL_PROPERTIES.length; i++) {
    var property = GLOBAL_PROPERTIES[i];

    sandbox[property] = global[property];
  }

  return sandbox;
};

// Extracts report data (64 bytes of extra information) from a report.
// Inputs and outputs are an arraybuffer.
SecureWorker.getReportData = function getReportData(report) {
  return SecureWorker._getReportData(report)
};

// Converts a report (something which can be checked locally) to a quote (something which
// can be checked remotely). Report should come from this machine.
// Inputs and outputs are an arraybuffer.
SecureWorker.getQuote = function getQuote(report) {
  return SecureWorker._getQuote(report)
};

// Extracts report data (64 bytes of extra information) from a quote.
// Inputs and outputs are an arraybuffer.
SecureWorker.getQuoteData = function getQuoteData(quote) {
  return SecureWorker._getQuoteData(quote)
};

// Do a remote attestation of a given quote. Quote can come from this or some other machine.
// Returns a signed remote attestation statement on successful remote attestation.
// Inputs and outputs are an arraybuffer.
SecureWorker.getRemoteAttestation = function getRemoteAttestation(quote) {
  return SecureWorker._getRemoteAttestation(quote)
};

// Validates a signed remote attestation statement for a given quote.
// Input is an arraybuffer, output is true or false.
SecureWorker.validateRemoteAttestation = function validateRemoteAttestation(quote, attestation) {
  return SecureWorker._validateRemoteAttestation(attestation)
};

// Class methods for this mock implementation which can and should be overridden by the user of the library.
SecureWorker._resolveContentKey = function _resolveContentKey() {
  throw new Error("Not implemented.");
};

SecureWorker._createMonotonicCounter = function _createMonotonicCounter(context) {
  throw new context.Error("Not implemented.");
};

SecureWorker._destroyMonotonicCounter = function _destroyMonotonicCounter(context) {
  throw new context.Error("Not implemented.");
};

SecureWorker._readMonotonicCounter = function _readMonotonicCounter(context) {
  throw new context.Error("Not implemented.");
};

SecureWorker._incrementMonotonicCounter = function _incrementMonotonicCounter(context) {
  throw new context.Error("Not implemented.");
};

SecureWorker._getTrustedTime = function _getTrustedTime(context) {
  throw new context.Error("Not implemented.");
};

SecureWorker._getReport = function _getReport(context, reportData) {
  throw new context.Error("Not implemented.");
};

SecureWorker._getReportData = function _getReportData(report) {
  throw new Error("Not implemented.");
};

SecureWorker._getQuote = function _getQuote(report) {
  throw new Error("Not implemented.");
};

SecureWorker._getQuoteData = function _getQuoteData(quote) {
  throw new Error("Not implemented.");
};

SecureWorker._getRemoteAttestation = function _getRemoteAttestation(quote) {
  throw new Error("Not implemented.");
};

SecureWorker._validateRemoteAttestation = function _validateRemoteAttestation(quote, attestation) {
  throw new Error("Not implemented.");
};

module.exports = SecureWorker;
