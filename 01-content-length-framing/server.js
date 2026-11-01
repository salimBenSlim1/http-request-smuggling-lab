const express = require("express");

const app = express();

app.use(express.json());

const users = {
  salim: {
    password: "correct-password",
    verified: false,
    attempts: 0,
  },
};

const verificationCode = "739421";

app.post("/login", (req, res) => {
  const { username, password } = req.body;

  const user = users[username];

  if (!user || user.password !== password) {
    return res.status(401).json({
      error: "invalid credentials",
    });
  }

  res.json({
    message: "verification required",
    username,
  });
});

app.post("/verify", async (req, res) => {
  const { username, code } = req.body;
  
  const user = users[username];
  
  if (!user) {
    return res.status(404).json({
      error: "user not found",
    });
  }
 
  if (user.attempts >= 5) {
    console.log("REJECTED",user.attempts)
    return res.status(429).json({
      error: "too many attempts",
    });
  }
 console.log("ACCEPTED",user)
  await new Promise(resolve => setTimeout(resolve, 50));

  if (code === verificationCode) {
    user.verified = true;

    return res.json({
      message: "verified",
    });
  }

  user.attempts++;

  res.status(401).json({
    error: "invalid code",
    attemptsRemaining: 5 - user.attempts,
  });
});

app.get("/account", (req, res) => {
  const username = req.query.username;

  const user = users[username];

  if (!user) {
    return res.status(404).json({
      error: "user not found",
    });
  }

  if (!user.verified) {
    return res.status(403).json({
      error: "verification required",
    });
  }

  res.json({
    username,
    balance: 125000,
    secret: "BANK-ACCOUNT-SECRET",
  });
});

app.listen(3000, () => {
  console.log("Bank server running on http://127.0.0.1:3000");
});