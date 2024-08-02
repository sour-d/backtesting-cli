import readline from "readline";
import dotenv from "dotenv";
import fs from "fs";
import open from "open";

dotenv.config();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const loginUrl =
  "https://api.icicidirect.com/apiuser/login?api_key=" +
  encodeURI(process.env.API_KEY);

console.log("Login using this link -->", loginUrl);

open(loginUrl);

// Prompt the user for input
rl.question("Enter the session id: ", (sessionId) => {
  // replace the session id in the .env file
  // write the session id to the .env file

  const envContent = fs.readFileSync(".env", "utf8");
  const updatedEnvContent = envContent.replace(
    /API_SESSION=.*/,
    `API_SESSION=${sessionId}`
  );
  fs.writeFileSync(".env", updatedEnvContent);

  // Close the interface
  rl.close();
});
