const net = require("net");

const socket = net.createConnection(3000, "127.0.0.1", () => {
  const request =
    "POST /one HTTP/1.1\r\n" +
    "Host: localhost:3000\r\n" +
    "Content-Length: 7\r\n" +
    "\r\n" +
    "HELLO" +

    "GET /two HTTP/1.1\r\n" +
    "Host: localhost:3000\r\n" +
    "\r\n";

  socket.write(request);
});

socket.on("data", data => {
  console.log("\nSERVER RESPONSE:");
  console.log(data.toString());
});

socket.on("end", () => {
  console.log("Connection closed");
});