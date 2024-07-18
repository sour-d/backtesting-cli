import dotenv from "dotenv";
dotenv.config();

console.log(
  `${process.env.DEFAULT_SYMBOL}_${process.env.DEFAULT_INTERVAL}_DEFAULT`
);
