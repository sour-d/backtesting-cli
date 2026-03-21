const symbols = ["DOGEUSDT", "GALAUSDT", "DOTUSDT"];
const interval = "1";
const capital = 5;


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