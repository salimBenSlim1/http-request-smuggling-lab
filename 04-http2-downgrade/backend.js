'use strict';

/**
 * A deliberately simple HTTP/1.1 backend, structured the same way as
 * ../02-desync-lab/proxy/tcp-introspector.js: it parses requests off a
 * raw TCP stream itself, rather than using Node's http module, so that
 * leftover bytes after one "complete" request are visible as exactly
 * what they are - the start of whatever the parser treats as the next
 * request on that connection.
 *
 * This is the thing being protected: it has no idea whether the bytes
 * in front of it came from one HTTP/2 stream or several. All it sees
 * is a TCP byte stream and Content-Length headers.
 */

const net = require('net');

const PORT = Number(process.env.PORT) || 3101;

function parseHeaders(buffer) {
  const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'));
  if (headerEnd === -1) return null;

  const text = buffer.subarray(0, headerEnd).toString('latin1');
  const lines = text.split('\r\n');
  const requestLine = lines.shift();

  const headers = {};
  for (const line of lines) {
    const sep = line.indexOf(':');
    if (sep === -1) continue;
    headers[line.slice(0, sep).trim().toLowerCase()] = line.slice(sep + 1).trim();
  }

  return { headerBytesEnd: headerEnd + 4, requestLine, headers };
}

function getRequestLength(buffer) {
  const parsed = parseHeaders(buffer);
  if (!parsed) return { complete: false };

  const raw = parsed.headers['content-length'];
  const contentLength = raw === undefined ? 0 : Number(raw);
  if (!Number.isFinite(contentLength) || contentLength < 0) return { complete: false };

  const bodyEnd = parsed.headerBytesEnd + contentLength;
  if (buffer.length < bodyEnd) return { complete: false };

  return { complete: true, length: bodyEnd, parsed };
}

let connectionCounter = 0;
let requestCounter = 0;

const server = net.createServer(socket => {
  connectionCounter += 1;
  const connId = connectionCounter;
  let buffer = Buffer.alloc(0);

  console.log(`\n[backend] connection #${connId} opened`);

  socket.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);

    while (true) {
      const result = getRequestLength(buffer);
      if (!result.complete) break;

      requestCounter += 1;
      const { parsed, length } = result;
      const body = buffer.subarray(parsed.headerBytesEnd, length).toString('latin1');

      console.log(`\n[backend] connection #${connId} - request #${requestCounter}`);
      console.log(`  request line: ${JSON.stringify(parsed.requestLine)}`);
      console.log(`  content-length header: ${parsed.headers['content-length']}`);
      console.log(`  body: ${JSON.stringify(body)}`);

      const payload = JSON.stringify({
        requestNumber: requestCounter,
        requestLine: parsed.requestLine,
        body,
      });

      socket.write(
        'HTTP/1.1 200 OK\r\n' +
          'Content-Type: application/json\r\n' +
          `Content-Length: ${Buffer.byteLength(payload)}\r\n` +
          'Connection: keep-alive\r\n' +
          '\r\n' +
          payload
      );

      buffer = buffer.subarray(length);

      if (buffer.length > 0) {
        console.log(
          `  \u26A0\uFE0F  ${buffer.length} leftover byte(s) remain on connection #${connId} - ` +
            'will be parsed as the start of the NEXT request:'
        );
        console.log('    ' + JSON.stringify(buffer.toString('latin1')));
      }
    }
  });

  socket.on('error', err => console.log(`[backend] connection #${connId} error: ${err.message}`));
  socket.on('close', () => console.log(`[backend] connection #${connId} closed`));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[backend] HTTP/1.1 backend listening on 127.0.0.1:${PORT}`);
});
