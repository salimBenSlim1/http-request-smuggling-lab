# Lab 4 — HTTP/2 downgrade smuggling (H2.CL)

A working, locally-reproduced H2.CL-style desync at an HTTP/2-to-HTTP/1.1
downgrade gateway — the attack surface most current smuggling research
(H2.CL, H2.TE at H2-to-H1.1 gateways) actually targets, as opposed to
classic HTTP/1.1-to-HTTP/1.1 smuggling (see
[`../01-content-length-framing`](../01-content-length-framing)).

## Layout

```
04-http2-downgrade/
├── backend.js         # HTTP/1.1 backend, parses its own TCP stream (same style as lab 2)
├── gateway.js          # h2c -> HTTP/1.1 downgrade gateway, VULNERABLE by default, SAFE_MODE=1 to fix it
└── attack_client.js    # HTTP/2 client sending the attacker + "victim" requests
```

No `package.json` here — everything uses Node's core `http2` and `net`
modules only.

## Run

```bash
node backend.js                 # terminal 1, :3101
node gateway.js                 # terminal 2, h2c on :8443, vulnerable mode
node attack_client.js           # terminal 3
```

Watch **`backend.js`'s** terminal (not the attack client's output) —
that's where the actual corruption shows up.

## The bug

HTTP/2 doesn't need a `Content-Length` header at all: a request body's
length is defined by its DATA frames and the `END_STREAM` flag, which
is explicit, frame-length-prefixed binary framing — there's no
`Content-Length`-vs-`Transfer-Encoding` textual ambiguity the way
HTTP/1.1 has it. The ambiguity gets reintroduced at the point where a
gateway translates an HTTP/2 request back into HTTP/1.1, because
HTTP/1.1 *does* need an explicit length, and the gateway has to compute
one.

`gateway.js`'s default mode gets this wrong in a specific, realistic
way: it starts forwarding a request to the backend as soon as the
*first* DATA chunk arrives, treating that chunk's size as the whole
body's `Content-Length` — instead of waiting for `END_STREAM` to know
the true total. Any DATA that arrives afterward on the same HTTP/2
stream gets relayed to the backend as raw extra bytes, once the
(already-too-short) request has already been sent. Because the gateway
also reuses a single pooled TCP connection to the backend (standing in
for what any real reverse proxy does for performance), those extra
bytes don't just corrupt the current request — they sit on the backend
connection as the start of whichever request the gateway forwards
next, from any client.

`attack_client.js` demonstrates exactly that: an "attacker" request
whose body arrives in two separate DATA writes (5 bytes, then the
unterminated start of a forged HTTP/1.1 request line), followed by a
completely ordinary "victim" request on a separate HTTP/2 connection.
Run it against the lab as shipped and `backend.js`'s log shows the
victim's request never gets parsed as its own request at all — its
request line is silently absorbed as a bogus header line, and its body
ends up attached underneath the attacker's forged request instead:

```
[backend] connection #1 - request #1
  request line: "POST /attacker-echo HTTP/1.1"
  content-length header: 5
  body: "AAAAA"

[backend] connection #1 - request #2
  request line: "GET /smuggled-by-h2 HTTP/1.1"
  content-length header: 5
  body: "hello"
```

That second entry is the victim's `POST /victim-path` request with a
5-byte body of `"hello"` — but the backend thinks it's a `GET
/smuggled-by-h2` request the attacker made up. In a real deployment
this is response-queue poisoning: whatever response the backend sends
for that merged request goes to the wrong party, and an attacker who
controls the forged request line and headers can redirect, with
enough iteration, to places like internal-only endpoints or another
user's session.

## The fix

```bash
SAFE_MODE=1 node gateway.js
```

`SAFE_MODE` buffers the entire HTTP/2 request body (waits for
`END_STREAM`) before computing `Content-Length` and forwarding
anything. Re-run `attack_client.js` against it and `backend.js` reports
two clean, correctly separated, correctly attributed requests instead:

```
[backend] connection #1 - request #1
  request line: "POST /attacker-echo HTTP/1.1"
  content-length header: 74
  body: "AAAAAGET /smuggled-by-h2 HTTP/1.1\r\nX-Injected-By: h2-downgrade-smuggling\r\n"

[backend] connection #1 - request #2
  request line: "POST /victim-path HTTP/1.1"
  content-length header: 5
  body: "hello"
```

The attacker's forged text is now just inert body data on their own
request — it never gets reinterpreted as HTTP framing, because the
gateway only ever declares a `Content-Length` that matches the bytes
it actually forwards.

## Why this isn't "lie about the Content-Length header" like lab 1/2

An earlier version of this lab tried to reproduce H2.CL by having the
*client* send a `content-length` header that didn't match its actual
HTTP/2 DATA frames. Node's `http2` client/server implementation
validates that itself and resets the stream
(`NGHTTP2_PROTOCOL_ERROR`) before the mismatch ever reaches
application code — correct, spec-compliant behavior (RFC 9113 §8.1.2.6
calls a declared `content-length` that disagrees with the actual DATA
frame total a malformed message). That's also an accurate reflection
of why that specific H2.CL variant is rare against modern, compliant
HTTP/2 stacks: the protocol itself, done correctly, closes it. The
version reproduced in this lab — a gateway that starts forwarding
before it has the full picture — is the more realistic failure mode,
and it isn't something the HTTP/2 layer can catch on the gateway's
behalf, since nothing in the spec requires a gateway to buffer
anything before it forwards.

## Scope

Targets `127.0.0.1` only, between servers in this repo. Not a
general-purpose HTTP/2 smuggling tool, and this is one specific,
narrow implementation bug — not a claim about any particular
production reverse proxy or CDN.
