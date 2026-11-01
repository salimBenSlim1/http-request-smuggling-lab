# Lab 3 — Racing a check-then-act rate limit

Not a `Content-Length`/`Transfer-Encoding` issue — a different flavor of
HTTP-layer desync: a rate limit implemented as a sequential
check-then-act (read the counter, compare, `await`, then increment) is
only safe against *sequential* callers. `load-test-otp.js` drives the
`/verify` endpoint of [`../01-content-length-framing/server.js`](../01-content-length-framing/server.js)
(port `3000`) with up to 100 concurrent in-flight requests, trying every
6-digit OTP candidate in a fixed range, which is the load shape that can
push multiple requests past the "`attempts < 5`" check before any of
them has recorded an attempt.

## Why this belongs in an HTTP-smuggling-adjacent repo

Request smuggling is a desync between two components about how many
*requests* exist in a byte stream. A check-then-act race is a desync
between two requests about the *order* their side effects land in. The
underlying lesson — "a control that's correct for one request at a time
silently stops being correct under concurrency" — is the same shape of
problem, just at a different layer, and worth having the muscle memory
for both.

## Run

Requires `../01-content-length-framing/server.js` running first (no
database setup needed — it keeps state in memory):

```bash
cd ../01-content-length-framing && node server.js   # terminal 1, :3000

cd ../03-otp-rate-limit-race
node load-test-otp.js           # terminal 2, Node version
# or
python3 load_test_otp.py --total 5000 --concurrency 50   # Python version
```

Both scripts hit the same endpoint the same way; the Python version
takes `--total`/`--concurrency` flags (default `900000`/`100`, matching
the Node version's constants) so you can run a smaller pass without
editing the file.

It reports which status codes came back for each candidate outside
`200`, plus overall throughput. On a vulnerable (sequential
check-then-act) implementation, you should be able to observe more
than 5 distinct OTP attempts being accepted for processing against a
single session despite the stated 5-attempt limit — i.e., `429 Too Many
Attempts` not firing as early as the single-threaded logic implies it
should.

## Scope

Targets `127.0.0.1` only, against the lab backend in this repo, with
the seeded test account. Not a general-purpose brute-force tool.
