# Findings & background

## Background: why I built this

I worked through PortSwigger's Web Security Academy material on HTTP
Request Smuggling (the CL.TE, TE.CL and TE.TE / header-obfuscation
variants). Solving the labs confirms you can reproduce a known attack
against a known-vulnerable target. It doesn't by itself prove you
understand *why* the desync happens at the protocol level, or let you
reason about a system you didn't get a pre-built lab for. So I built
my own minimal front-end/back-end pair to trace the actual framing
decision byte-by-byte, instead of relying on a payload template.

This document summarizes the mental model and the two concrete findings
the labs in this repo are built to demonstrate. It intentionally stays
at the level of general HTTP/1.1 protocol behavior — it's not a
walkthrough of any specific PortSwigger lab instance.

## The core mechanism

HTTP/1.1 allows a request to declare its body length two different ways:

- `Content-Length: N` — "the body is exactly N bytes."
- `Transfer-Encoding: chunked` — "the body is a sequence of
  self-delimited chunks, ending in a zero-length chunk."

A compliant single parser handles both. The problem is a *chain* of two
components (e.g. a reverse proxy and an application server) that each
parse the request independently, over the same TCP connection, and
don't necessarily make the same decision:

- **CL.TE** — front end uses `Content-Length`, back end uses
  `Transfer-Encoding`. The front end forwards what it thinks is one
  request; the back end sees the chunked body end early and treats the
  remaining bytes as the start of the *next* request on that
  connection.
- **TE.CL** — the reverse: front end honors `Transfer-Encoding`, back
  end honors `Content-Length` and reads too few or too many bytes.
- **TE.TE** — both components support chunked encoding, but one of them
  can be tricked (via header casing, spacing, duplicate headers, or
  similar obfuscation) into not recognizing the
  `Transfer-Encoding` header at all, which collapses the case back to
  CL.TE or TE.CL.

What all three share: **the two components end up splitting the same
byte stream into a different number of HTTP messages.** That's the
actual vulnerability — everything else (session hijacking, cache
poisoning, auth bypass) is a consequence of what you can do once a
"half" of a smuggled request lands at the front of someone else's.

## `01-content-length-framing`: isolating the decision itself

Before desync makes sense, you need to be precise about what a single
parser does with `Content-Length`. This lab sends one TCP write
containing two concatenated HTTP/1.1 requests, where the first
request's declared `Content-Length` doesn't match the bytes that
follow it, and logs exactly how many bytes the server consumed as the
body versus where request #2 actually started. This is the
"single-parser" baseline — it is *not* a smuggling vulnerability by
itself (see that lab's README for why), it's the control case that
makes the two-component lab in `02-desync-lab` legible.

## `02-desync-lab`: two components, one byte stream

This lab adds a second, independent HTTP parser in front of the
backend(s) — `proxy/tcp-introspector.js`, a small raw TCP proxy that
logs the exact byte offsets it uses to decide where one HTTP message
ends and the next begins, alongside a more realistic `nginx`
configuration (`proxy/nginx.conf`) load-balancing across two backend
instances (`server-a`, `server-b`). Running the same malformed/boundary
requests through this chain, instead of a single parser, is what
surfaces real desync: the two components can disagree about where
request #1 ends, and bytes meant to be the start of request #2 end up
mid-body of request #1 (or vice versa).

### Finding: front end forwards a header it should own, back end trusts it

While building the `nginx.conf` for this lab, I noticed (and kept, as a
deliberately documented example) a realistic variant of the same root
cause as smuggling: **a trust boundary that assumes a header is
set exclusively by the front end, when the front end actually forwards
whatever the client sent.**

- `server-a/server.js` and `server-b/server.js` both implement:

  ```js
  function requireAuth(req, res, next) {
    const internalAdmin = req.headers["x-internal-admin"];
    if (internalAdmin === "true") {
      return next(); // skip auth entirely
    }
    ...
  }
  ```

  The intent is clearly "an internal gateway sets this header after
  stripping any client-supplied copy, so if we see it, the caller is
  trusted infrastructure, not an end user."

- `proxy/nginx.conf`, however, does this:

  ```nginx
  proxy_set_header X-Internal-Admin $http_x_internal_admin;
  ```

  `$http_x_internal_admin` is nginx's variable for *the client's own*
  `X-Internal-Admin` request header. This line doesn't set a trusted
  value — it forwards whatever the client sent, verbatim. Any client
  can send `X-Internal-Admin: true` directly and reach `/admin` on
  either backend with no credentials at all.

This isn't request smuggling in the CL/TE sense — it doesn't require a
framing desync, a single ordinary request is enough. I'm including it
because it's the same *class* of bug that makes smuggling dangerous in
production: a component downstream trusts something a component
upstream was supposed to control, and nobody checked that the
upstream component actually enforces that. (In a real pipeline, this
exact pattern is often the second half of a smuggling chain — the
smuggled request injects a trusted-looking internal header rather than
reaching `/admin` directly, if direct access is otherwise blocked
upstream.) The fix is for the proxy to explicitly set the header to a
fixed value, or clear it, rather than passing through a client-derived
nginx variable:

```nginx
proxy_set_header X-Internal-Admin "";   # strip whatever the client sent
```

## `03-otp-rate-limit-race`: a different kind of HTTP-layer desync

Not every protocol-level race is about framing. `server-a`/`server-b`'s
`/verify` endpoint rate-limits OTP attempts with a classic
check-then-act pattern: read `otp_attempts`, compare to the limit,
`await` (simulating real latency), then increment. `load-test-otp.js`
exercises that endpoint concurrently rather than sequentially, which is
the load pattern that turns a correct-looking sequential check into a
TOCTOU bug: many requests can pass the "attempts < 5" check before any
of them have incremented the counter. I'm including it here because the
underlying lesson generalizes — HTTP desyncs aren't only about
`Content-Length` vs. `Transfer-Encoding`; any boundary where two
requests can race past a check-then-act control is the same shape of
problem at a different layer.

## Tooling

`02-desync-lab/desync_probe.py` implements the standard timing-based
CL.TE detection methodology as a runnable harness (Python, stdlib
only): send an ambiguous Content-Length/Transfer-Encoding request,
send a baseline request, compare latency. Run as-is against this
repo's shipped backends, it correctly reports no desync, since every
component here currently agrees on framing (see "Scope note" above).
It's there to be pointed at a genuinely divergent backend pair, and as
a concrete implementation of the technique rather than a description
of it.

`02-desync-lab/admin_header_bypass.py` is the HTTP-level proof for the
trust-boundary finding above — a single `GET /admin` with
`X-Internal-Admin: true`, scripted so the result is reproducible
rather than a one-off `curl`.

## What I'd want to add next

- A proper CL.TE/TE.CL pair of backends behind a single front end that
  actually disagree on `Transfer-Encoding` support, to reproduce a
  genuine smuggling desync end-to-end in `02-desync-lab` and get a
  positive result out of `desync_probe.py`, rather than only having
  the framing-observation tooling in place.
- HTTP/2 downgrade behavior: most production smuggling research has
  moved toward H2.CL/H2.TE issues at HTTP/2-to-HTTP/1.1 gateways,
  which is a meaningfully different attack surface from classic
  HTTP/1.1-to-HTTP/1.1 smuggling (see `01-content-length-framing`'s
  README for a short note on why).
