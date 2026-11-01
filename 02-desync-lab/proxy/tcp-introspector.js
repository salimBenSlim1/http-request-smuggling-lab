const net = require("net");

const PROXY_PORT = 8080;

const TARGET_HOST = "127.0.0.1";
const TARGET_PORT = 3001;


/*
 * ---------------------------------------------------------
 * Pretty helpers
 * ---------------------------------------------------------
 */

function printable(buffer) {
  return buffer
    .toString("latin1")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n\n");
}


function hexDump(buffer) {
  const width = 16;

  for (let offset = 0; offset < buffer.length; offset += width) {
    const row = buffer.subarray(offset, offset + width);

    const hex = Array.from(row)
      .map(byte => byte.toString(16).padStart(2, "0"))
      .join(" ")
      .padEnd(width * 3 - 1, " ");

    const ascii = Array.from(row)
      .map(byte => {
        if (byte >= 32 && byte <= 126) {
          return String.fromCharCode(byte);
        }

        return ".";
      })
      .join("");

    console.log(
      `${offset.toString(16).padStart(8, "0")}  ${hex}  |${ascii}|`
    );
  }
}


/*
 * ---------------------------------------------------------
 * Parse HTTP headers
 * ---------------------------------------------------------
 */

function parseHeaders(buffer) {
  const headerEnd = buffer.indexOf(
    Buffer.from("\r\n\r\n")
  );

  if (headerEnd === -1) {
    return null;
  }

  const headerBytes = buffer.subarray(0, headerEnd);

  const text = headerBytes.toString("latin1");

  const lines = text.split("\r\n");

  const requestLine = lines.shift();

  const headers = {};

  for (const line of lines) {
    const separator = line.indexOf(":");

    if (separator === -1) {
      continue;
    }

    const name = line
      .slice(0, separator)
      .trim()
      .toLowerCase();

    const value = line
      .slice(separator + 1)
      .trim();

    headers[name] = value;
  }

  return {
    headerEnd,
    headerBytesEnd: headerEnd + 4,
    requestLine,
    headers
  };
}


/*
 * ---------------------------------------------------------
 * Determine HTTP request length
 * ---------------------------------------------------------
 */

function getRequestLength(buffer) {

  const parsed = parseHeaders(buffer);

  /*
   * We don't even have complete headers yet.
   */
  if (!parsed) {
    return {
      complete: false,
      reason: "waiting for more headers"
    };
  }

  const {
    headerBytesEnd,
    requestLine,
    headers
  } = parsed;


  console.log("\n--------------------------------");
  console.log("HTTP MESSAGE");
  console.log("--------------------------------");

  console.log(`Request line: ${requestLine}`);

  console.log("\nHeaders:");

  for (const [name, value] of Object.entries(headers)) {
    console.log(`  ${name}: ${value}`);
  }


  /*
   * -------------------------------------------------------
   * Content-Length
   * -------------------------------------------------------
   */

  if (headers["content-length"] !== undefined) {

    const contentLength = Number(
      headers["content-length"]
    );

    if (
      !Number.isInteger(contentLength) ||
      contentLength < 0
    ) {
      return {
        complete: false,
        reason: "invalid Content-Length"
      };
    }


    const bodyStart = headerBytesEnd;

    const bodyEnd =
      bodyStart + contentLength;


    console.log("\nFraming:");

    console.log(
      `  Header ends at byte: ${headerBytesEnd}`
    );

    console.log(
      `  Body starts at byte: ${bodyStart}`
    );

    console.log(
      `  Content-Length: ${contentLength}`
    );

    console.log(
      `  Request ends at byte: ${bodyEnd}`
    );


    /*
     * Not enough bytes yet.
     */

    if (buffer.length < bodyEnd) {

      console.log(
        `  Waiting for ${
          bodyEnd - buffer.length
        } more byte(s)...`
      );

      return {
        complete: false,
        reason: "body incomplete"
      };
    }


    /*
     * Request is complete.
     */

    return {
      complete: true,
      length: bodyEnd
    };
  }


  /*
   * -------------------------------------------------------
   * No Content-Length
   *
   * For our educational lab we assume:
   * no body -> request ends at headers.
   * -------------------------------------------------------
   */

  console.log("\nFraming:");

  console.log(
    `  No Content-Length`
  );

  console.log(
    `  Request ends at byte: ${headerBytesEnd}`
  );


  return {
    complete: true,
    length: headerBytesEnd
  };
}


/*
 * ---------------------------------------------------------
 * HTTP stream parser
 * ---------------------------------------------------------
 */

function createHttpParser(connectionId) {

  let buffer = Buffer.alloc(0);

  let requestNumber = 0;


  function feed(chunk) {

    console.log("\n\n================================");
    console.log("TCP DATA ARRIVED");
    console.log("================================");

    console.log(
      `Connection: ${connectionId}`
    );

    console.log(
      `Chunk size: ${chunk.length} bytes`
    );

    console.log("\nChunk:");

    console.log(
      printable(chunk)
    );


    /*
     * Append the new TCP bytes.
     */

    buffer = Buffer.concat([
      buffer,
      chunk
    ]);


    console.log("\n--------------------------------");
    console.log("ACCUMULATOR");
    console.log("--------------------------------");

    console.log(
      `Buffer size: ${buffer.length} bytes`
    );


    /*
     * Try to extract as many HTTP requests
     * as possible from the buffer.
     */

    while (buffer.length > 0) {

      const result =
        getRequestLength(buffer);


      /*
       * Not enough bytes yet.
       */

      if (!result.complete) {

        console.log(
          `\nParser status: ${result.reason}`
        );

        console.log(
          "Keeping bytes in accumulator..."
        );

        break;
      }


      /*
       * We found one complete HTTP request.
       */

      requestNumber++;

      const request =
        buffer.subarray(
          0,
          result.length
        );


      console.log("\n\n================================");
      console.log(
        `REQUEST #${requestNumber} COMPLETE`
      );
      console.log("================================");


      console.log(
        `Request length: ${request.length} bytes`
      );

      console.log(
        `Request occupies bytes: 0 → ${result.length}`
      );


      console.log("\nREQUEST:");

      console.log(
        printable(request)
      );


      /*
       * Remove the request from the accumulator.
       */

      buffer =
        buffer.subarray(result.length);


      console.log("\n--------------------------------");

      console.log(
        `Accumulator remaining: ${buffer.length} bytes`
      );


      /*
       * If bytes remain, they might be
       * another HTTP request.
       */

      if (buffer.length > 0) {

        console.log(
          "\n⚠️ BYTES REMAIN AFTER REQUEST"
        );

        console.log(
          "These bytes may contain another HTTP message."
        );

        console.log("\nRemaining bytes:");

        console.log(
          printable(buffer)
        );
      }
    }
  }


  function getRemaining() {
    return buffer;
  }


  return {
    feed,
    getRemaining
  };
}


/*
 * ---------------------------------------------------------
 * TCP proxy
 * ---------------------------------------------------------
 */

let connectionCounter = 0;


const server = net.createServer(clientSocket => {

  connectionCounter++;

  const connectionId =
    connectionCounter;


  console.log("\n\n");
  console.log("################################");
  console.log(
    `NEW CONNECTION #${connectionId}`
  );
  console.log("################################");


  /*
   * Create our HTTP accumulator/parser
   * for this TCP connection.
   */

  const parser =
    createHttpParser(connectionId);


  /*
   * Connect to Node.
   */

  const upstream =
    net.createConnection(
      {
        host: TARGET_HOST,
        port: TARGET_PORT
      },
      () => {

        console.log(
          `Connected to Node ${TARGET_HOST}:${TARGET_PORT}`
        );

      }
    );


  /*
   * -------------------------------------------------------
   * CLIENT → PROXY
   * -------------------------------------------------------
   */

  clientSocket.on("data", chunk => {

    parser.feed(chunk);

    /*
     * Important:
     *
     * We are NOT modifying the bytes.
     *
     * We simply inspect them,
     * then forward them unchanged.
     */

    upstream.write(chunk);

  });


  /*
   * -------------------------------------------------------
   * NODE → PROXY
   * -------------------------------------------------------
   */

  upstream.on("data", chunk => {

    console.log("\n\n================================");
    console.log("NODE → PROXY");
    console.log("================================");

    console.log(
      `Received ${chunk.length} bytes`
    );

    console.log("\nRAW:");

    console.log(
      printable(chunk)
    );


    clientSocket.write(chunk);

  });


  /*
   * -------------------------------------------------------
   * Connection cleanup
   * -------------------------------------------------------
   */

  clientSocket.on("end", () => {

    console.log(
      `Client #${connectionId} disconnected`
    );

    upstream.end();

  });


  upstream.on("end", () => {

    console.log(
      `Node closed connection #${connectionId}`
    );

    clientSocket.end();

  });


  clientSocket.on("error", err => {

    console.error(
      "Client error:",
      err.message
    );

    upstream.destroy();

  });


  upstream.on("error", err => {

    console.error(
      "Upstream error:",
      err.message
    );

    clientSocket.destroy();

  });

});


server.listen(
  PROXY_PORT,
  "127.0.0.1",
  () => {

    console.log(
      `TCP microscope listening on 127.0.0.1:${PROXY_PORT}`
    );

    console.log(
      `Forwarding to ${TARGET_HOST}:${TARGET_PORT}`
    );

  }
);