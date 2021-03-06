var trumpet = require('trumpet');
var zlib = require('zlib');

module.exports = function harmonBinary(reqSelectors, resSelectors, options) {
  var _reqSelectors = reqSelectors || [];
  var _resSelectors = resSelectors || [];

  var _htmlOnly     = false;
  // default to a maximum time out of 60 seconds. Interval runs every 10 milliseconds. (6000 * 10 ms = 60 seconds)
  var _maxTimeout    =  6000;

  if (typeof options === 'object') {
    _htmlOnly       = (typeof options.htmlOnly === 'undefined') ? _htmlOnly : options.htmlOnly;
    _maxTimeout     = (typeof options.maxTimeout === 'undefined') ? _maxTimeout : options.maxTimeout;
  } else if (typeof options === 'boolean') { // backward compatibility
    _htmlOnly       = options;
  }
  var _endEmittedInterval;

  function prepareRequestSelectors(req, res) {
    var tr = trumpet();

    prepareSelectors(tr, _reqSelectors, req, res);

    req.on('data', function(data) {
      tr.write(data);
    });
  }

  function prepareResponseSelectors(req, res) {
    var tr          = trumpet();
    var _write      = res.write;
    var _end        = res.end;
    var _writeHead  = res.writeHead;
    var gunzip      = zlib.Gunzip();

    prepareSelectors(tr, _resSelectors, req, res);

    // Assume response is binary by default
    res.isHtml = false;

    // Assume response is uncompressed by default
    res.isGziped = false;

    res.writeHead = function () {
      var code = arguments[0];
      var headers = (arguments.length > 2) ? arguments[2] : arguments[1]; // writeHead supports (statusCode, headers) as well as (statusCode, statusMessage, headers)

      var contentType = this.getHeader('content-type');
      var contentEncoding = this.getHeader('content-encoding');

      /* Sniff out the content-type header.
       * If the response is HTML, we're safe to modify it.
       */
      if (!_htmlOnly || ((typeof contentType != 'undefined') && (contentType.indexOf('text/html') == 0))) {
        res.isHtml = true;

        // Strip off the content length since it will change.
        res.removeHeader('Content-Length');

        if (headers) {
          delete headers['content-length'];
        }
      }

      /* Sniff out the content-type header.
       * If the response is Gziped, we're have to gunzip content before and ungzip content after.
       */
      if (res.isHtml && contentEncoding && contentEncoding.toLowerCase() == 'gzip') {
          res.isGziped = true;

          // Strip off the content encoding since it will change.
          res.removeHeader('Content-Encoding');

          if (headers) {
              delete headers['content-encoding'];
          }
     }

      _writeHead.apply(res, arguments);
    };

    res.write = function (data, encoding) {
      // Only run data through trumpet if we have HTML
      if (res.isHtml) {
        if (res.isGziped) {
          gunzip.write(data);
        } else {
          tr.write(data, encoding);
        }
      } else {
        _write.apply(res, arguments);
      }
    };

    tr.on('data', function (buf) {
      _write.call(res, buf);
    });

    gunzip.on('data', function (buf) {
      tr.write(buf);
    });

    res.end = function (data, encoding) {
      if (res.isGziped) {
        gunzip.end(data);
      } else {
        tr.end(data, encoding);
      }
    };

    gunzip.on('end', function (data) {
      tr.end(data);
    });

    tr.on('end', function () {
      _end.call(res);
    });

    tr.on('finish', () => {
      let intervalCount = 0;
      _endEmittedInterval = setInterval(() => {
        try {
            intervalCount += 1;
            // make sure read and write are completed after finish
            if (tr._writableState.ended === true && tr._tokenize._readableState.endEmitted === true) {
                clearInterval(_endEmittedInterval);
                _end.call(res);
            } else if (intervalCount >= _maxTimeout) {
                clearInterval(_endEmittedInterval);
                _end.call(res);
            }
        } catch (err) {
            clearInterval(_endEmittedInterval);
            _end.call(res);
        }
        }, 10);
      });
  }

  function prepareSelectors(tr, selectors, req, res) {
    for (var i = 0; i < selectors.length; i++) {
      (function (callback, req, res) {
        var callbackInvoker  = function(element) {
          callback(element, req, res);
        };

        tr.selectAll(selectors[i].query, callbackInvoker);
      })(selectors[i].func, req, res);
    }
  }

  return function harmonBinary(req, res, next) {
    var ignore = false;

    if (_htmlOnly) {
      var lowercaseUrl = req.url.toLowerCase();

      if ((lowercaseUrl.indexOf('.js', req.url.length - 3) !== -1) ||
          (lowercaseUrl.indexOf('.css', req.url.length - 4) !== -1)) {
        ignore = true;
      }
    }

    if (!ignore) {
      if (_reqSelectors.length) {
        prepareRequestSelectors(req, res);
      }

      if (_resSelectors.length) {
        prepareResponseSelectors(req, res);
      }
    }

    next();
  };
};
