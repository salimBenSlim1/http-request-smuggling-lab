const net = require("net");

const socket = new net.Socket();

socket.connect(8080, "127.0.0.1", () => {
  console.log("TCP connected");

  const request =
  "POST /inspect HTTP/1.1\r\n" +
  "Host: 127.0.0.1\r\n" +
  "Connection: keep-alive\r\n" +
  "Content-Length:5\r\n"+
  "\r\n" +
  "hello"
  

  console.log("SENDING:");
  console.log(JSON.stringify(request));

  socket.write(request);
});

socket.on("data", (data) => {
  console.log("SERVER SENT:");
  console.log(data.toString());
});

socket.on("end", () => {
  console.log("Server closed connection");
});

socket.on("error", (err) => {
  console.error("Socket error:", err.message);
});