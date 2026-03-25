const symbols = ["SOLUSDT", "AVAXUSDT", "XRPUSDT"];
const interval = "240";
const capital = 10;


symbols.forEach(symbol => {
  fetch(`https://auto-trader-uocd.onrender.com/api/deployments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      symbol,
      strategyId: "mav2",
      capital,
      klineInterval: interval,
    }),
  });
});