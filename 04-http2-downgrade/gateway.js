'use strict';

/**
 * A minimal HTTP/2 (cleartext, "h2c") -> HTTP/1.1 downgrade gateway.
 *
 * It accepts HTTP/2 requests and re-encodes each one as an HTTP/1.1
 * request, forwarded over a *single, reused* TCP connection to the
 * backend - standing in for the connection pooling any real reverse
 * proxy does for performance. That reuse is what turns a per-request
 * downgrade bug into cross-request smuggling: once one downgraded
 * request leaves extra bytes sitting on the backend connection, the
 * next request forwarded on that same connection - from any client -
 * inherits them as an unwanted prefix.
 *
 * On the bug itself: an earlier version of this file tried to
 * reproduce H2.CL smuggling by having the *client* declare a
 * `content-length` header that didn't match its actual DATA frames.
 * Node's http2 implementation validates that for you and resets the
 * stream (NGHTTP2_PROTOCOL_ERROR) before the mismatch ever reaches
 * this code - which is good, spec-compliant behavior, and also an
 * accurate reflection of why that particular H2.CL variant is rare
 * against modern, compliant stacks.
 *
 * The bug reproduced here instead lives on the gateway side, which is
 * where real H2.CL/H2.TE issues at downgrade points generally do:
 * VULNERABLE mode starts forwarding a request to the backend as soon
 * as the *first* DATA chunk arrives, using that chunk's size as the
 * downstream Content-Length - instead of waiting for END_STREAM to
 * know the true total body size. Any later DATA chunks on the same
 * HTTP/2 stream are relayed to the backend as raw, un-framed extra
 * bytes once forwarding has already started, exactly the same way a
 * naive "start streaming before you've buffered everything" proxy
 * implementation would.
 *
 * SAFE_MODE=1 buffers the complete body (waits for END_STREAM) before
 * computing Content-Length and forwarding anything, which is correct.
 *
 * See ./README.md for how to run the matching attack script and
 * ../docs/findings.md for the general H2.CL/H2.TE background.
 */

const http2 = require('http2');
const net = require('net');

const LISTEN_PORT = Number(process.env.GATEWAY_PORT) || 8443;
const BACKEND_HOST = process.env.BACKEND_HOST || '127.0.0.1';
const BACKEND_PORT = Number(process.env.BACKEND_PORT) || 3101;
const SAFE_MODE = process.env.SAFE_MODE === '1';

let backendSocket = null;

function getBackendSocket() {
  if (backendSocket && !backendSocket.destroyed) {
    return Promise.resolve(backendSocket);
  }

  return new Promise((resolve, reject) => {
    const sock = net.createConnection(BACKEND_PORT, BACKEND_HOST, () => {
      backendSocket = sock;
      resolve(sock);
    });
    sock.once('error', reject);
    sock.on('data', chunk => {
      console.log(`[gateway] <- backend: ${chunk.length} byte(s)`);
    });
    sock.on('close', () => {
      if (backendSocket === sock) backendSocket = null;
    });
  });
}

function buildHeaders(method, path, authority, contentLength) {
  return (
    `${method} ${path} HTTP/1.1\r\n` +
    `Host: ${authority}\r\n` +
    `Content-Length: ${contentLength}\r\n` +
    'Connection: keep-alive\r\n' +
    '\r\n'
  );
}

const server = http2.createServer();

server.on('stream', (stream, headers) => {
  const method = headers[':method'] || 'GET';
  const path = headers[':path'] || '/';
  const authority = headers[':authority'] || BACKEND_HOST;

  if (SAFE_MODE) {
    const chunks = [];
    stream.on('data', chunk => chunks.push(chunk));

    stream.on('end', async () => {
      const body = Buffer.concat(chunks);

      console.log(`\n[gateway] HTTP/2 stream: ${method} ${path}`);
      console.log('  mode: SAFE (buffers full body before forwarding)');
      console.log(`  total DATA bytes received: ${body.length}`);

      const h1Request = Buffer.concat([
        Buffer.from(buildHeaders(method, path, authority, body.length), 'latin1'),
        body,
      ]);

      try {
        const sock = await getBackendSocket();
        sock.write(h1Request);
      } catch (err) {
        stream.respond({ ':status': 502 });
        stream.end(`gateway could not reach backend: ${err.message}\n`);
        return;
      }

      stream.respond({ ':status': 200, 'content-type': 'text/plain' });
      stream.end(`forwarded ${body.length} byte(s)\n`);
    });
  } else {
    let started = false;

    stream.on('data', async chunk => {
      try {
        const sock = await getBackendSocket();

        if (!started) {
          started = true;
          console.log(`\n[gateway] HTTP/2 stream: ${method} ${path}`);
          console.log('  mode: VULNERABLE (forwards after first DATA chunk only)');
          console.log(`  first chunk size: ${chunk.length} byte(s) - used as Content-Length`);

          const h1Request = Buffer.concat([
            Buffer.from(buildHeaders(method, path, authority, chunk.length), 'latin1'),
            chunk,
          ]);
          sock.write(h1Request);
        } else {
          console.log(
            `  additional DATA chunk after forwarding started: ${chunk.length} byte(s) - ` +
              're-sent raw, uncounted by the Content-Length already sent'
          );
          sock.write(chunk);
        }
      } catch (err) {
        stream.destroy(err);
      }
    });

    stream.on('end', () => {
      stream.respond({ ':status': 200, 'content-type': 'text/plain' });
      stream.end('forwarded (see gateway/backend logs for details)\n');
    });
  }

  stream.on('error', () => {});
});

server.listen(LISTEN_PORT, '127.0.0.1', () => {
  console.log(
    `[gateway] h2c gateway listening on 127.0.0.1:${LISTEN_PORT} ` +
      `(SAFE_MODE=${SAFE_MODE ? 'on' : 'off'})`
  );
  console.log(`[gateway] downgrading to HTTP/1.1 backend at ${BACKEND_HOST}:${BACKEND_PORT}`);
});
