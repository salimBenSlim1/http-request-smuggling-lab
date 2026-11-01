#!/usr/bin/env python3
"""
Timing-based CL.TE differential smuggling probe, run against this
repo's own lab (proxy/tcp-introspector.js or proxy/nginx.conf in front
of server-a/server-b). This implements the standard detection
methodology taught in PortSwigger's Web Security Academy material:
send a request engineered so that, *if* a front-end/back-end framing
desync exists, part of it is left unread on the connection and stalls
the next request on that same socket; a response that takes
noticeably longer than a normal baseline request is the signal.

Expected result against this repo's lab AS SHIPPED: no desync, because
server-a, server-b and the proxy all agree on Content-Length-based
framing (see ../docs/findings.md, "Scope note"). This script is meant
as a reusable harness: point it at any front end / back end pair you
control to re-run the same test, and as a worked, runnable example of
the technique itself rather than just a description of it.

Usage:
    python3 desync_probe.py [--host 127.0.0.1] [--port 8080]

Scope: localhost only, against servers you run yourself. Not a
general-purpose scanner.
"""
import argparse
import socket
import time


def send_raw(host: str, port: int, data: bytes, read_timeout: float = 5.0):
    start = time.perf_counter()
    chunks = []
    with socket.create_connection((host, port), timeout=read_timeout) as sock:
        sock.sendall(data)
        sock.settimeout(read_timeout)
        try:
            while True:
                chunk = sock.recv(4096)
                if not chunk:
                    break
                chunks.append(chunk)
        except socket.timeout:
            # Timing out waiting for a response is itself the signal
            # we're measuring for, not an error.
            pass
    elapsed = time.perf_counter() - start
    return elapsed, b"".join(chunks)


def baseline_probe(host: str, port: int):
    """An ordinary, well-formed request - the comparison point."""
    payload = (
        "POST /inspect HTTP/1.1\r\n"
        "Host: 127.0.0.1\r\n"
        "Content-Length: 5\r\n"
        "\r\n"
        "hello"
    ).encode("latin1")
    return send_raw(host, port, payload)


def cl_te_probe(host: str, port: int):
    """
    CL.TE probe: declares both Content-Length and Transfer-Encoding.
    If the component reading this trusts Content-Length (4) but the
    *next* component in the chain trusts Transfer-Encoding instead,
    the second component will wait for a chunk terminator that never
    arrives on this connection and stall.
    """
    smuggled_request = "GET /inspect HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n"
    chunk_size_hex = format(len(smuggled_request), "x")

    payload = (
        "POST /inspect HTTP/1.1\r\n"
        "Host: 127.0.0.1\r\n"
        "Content-Length: 4\r\n"
        "Transfer-Encoding: chunked\r\n"
        "\r\n"
        f"{chunk_size_hex}\r\n"
        f"{smuggled_request}"
    ).encode("latin1")

    return send_raw(host, port, payload)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()

    print(f"Baseline request to {args.host}:{args.port} ...")
    baseline_time, baseline_resp = baseline_probe(args.host, args.port)
    print(f"  elapsed={baseline_time:.3f}s  bytes={len(baseline_resp)}")

    print(f"\nCL.TE-style probe to {args.host}:{args.port} ...")
    probe_time, probe_resp = cl_te_probe(args.host, args.port)
    print(f"  elapsed={probe_time:.3f}s  bytes={len(probe_resp)}")

    print("\nVerdict:")
    if probe_time > max(baseline_time * 3, 2.0):
        print("  Probe took significantly longer than baseline - possible desync.")
        print("  This is a signal to investigate further, not proof by itself.")
    else:
        print("  No meaningful latency difference - consistent with this lab's")
        print("  current setup, where every component agrees on framing.")
        print("  See ../docs/findings.md for what a genuinely divergent backend")
        print("  pair would need to look like.")


if __name__ == "__main__":
    main()
