/**
 * Verify Bybit live trading API: fetch price, place limit order (far from market),
 * get active orders, cancel order. Uses .env BYBIT_API_KEY, BYBIT_API_SECRET.
 * Set BYBIT_TESTNET=true to use testnet (recommended for first run).
 *
 * Run: npx tsx scripts/verify-bybit-trading.ts [SYMBOL]
 * Default symbol: BTCUSDT
 */
import 'dotenv/config';
import { RestClientV5 } from 'bybit-api';

const SYMBOL = process.argv[2] ?? 'BTCUSDT';
const CATEGORY = 'linear';

async function main(): Promise<void> {
  const apiKey = process.env.BYBIT_API_KEY;
  const apiSecret = process.env.BYBIT_API_SECRET;
  const useTestnet = process.env.BYBIT_TESTNET === 'true';

  if (!apiKey || !apiSecret) {
    console.error('Missing BYBIT_API_KEY or BYBIT_API_SECRET in .env');
    process.exit(1);
  }

  const client = new RestClientV5({
    key: apiKey,
    secret: apiSecret,
    testnet: useTestnet,
  });

  if (useTestnet) {
    console.log('Using Bybit TESTNET');
  } else {
    console.log('Using Bybit MAINNET');
  }
  console.log(`Symbol: ${SYMBOL} (${CATEGORY})\n`);

  // 1. Fetch current price
  console.log('1. Fetching current price...');
  const tickerRes = await client.getTickers({ category: CATEGORY, symbol: SYMBOL });
  if (tickerRes.retCode !== 0) {
    console.error('getTickers failed:', tickerRes.retMsg);
    process.exit(1);
  }
  const list = tickerRes.result?.list;
  if (!list || list.length === 0) {
    console.error('No ticker data for', SYMBOL);
    process.exit(1);
  }
  const lastPrice = Number(list[0]!.lastPrice);
  console.log(`   lastPrice = ${lastPrice}\n`);

  // 2. Get position info (read-only)
  console.log('2. Getting position info...');
  const posRes = await client.getPositionInfo({ category: CATEGORY, symbol: SYMBOL });
  if (posRes.retCode !== 0) {
    console.error('getPositionInfo failed:', posRes.retMsg);
    process.exit(1);
  }
  const positions = posRes.result?.list ?? [];
  console.log(`   open positions for ${SYMBOL}: ${positions.length}\n`);

  // 3. Get wallet balance (read-only)
  console.log('3. Getting wallet balance...');
  const balRes = await client.getWalletBalance({ accountType: 'UNIFIED' });
  if (balRes.retCode !== 0) {
    console.error('getWalletBalance failed:', balRes.retMsg);
    process.exit(1);
  }
  const wallets = balRes.result?.list ?? [];
  console.log(`   wallet accounts: ${wallets.length}\n`);

  // 4. Place a limit order far from market (so it does not fill)
  const orderPrice = (lastPrice * 0.5).toFixed(1); // 50% of price for Buy
  const qty = '0.001';
  const orderLinkId = `verify-${Date.now()}`;

  console.log('4. Placing limit Buy order (price far below market so it stays open)...');
  console.log(`   price=${orderPrice} qty=${qty} orderLinkId=${orderLinkId}`);

  const placeRes = await client.submitOrder({
    category: CATEGORY,
    symbol: SYMBOL,
    side: 'Buy',
    orderType: 'Limit',
    qty,
    price: orderPrice,
    orderLinkId,
    timeInForce: 'GTC',
  });

  if (placeRes.retCode !== 0) {
    console.error('submitOrder failed:', placeRes.retMsg, placeRes.result);
    process.exit(1);
  }
  const orderId = placeRes.result?.orderId;
  if (!orderId) {
    console.error('No orderId in response:', placeRes.result);
    process.exit(1);
  }
  console.log(`   orderId = ${orderId} OK\n`);

  // 5. Get active orders and find our order
  console.log('5. Getting active orders...');
  const activeRes = await client.getActiveOrders({
    category: CATEGORY,
    symbol: SYMBOL,
  });
  if (activeRes.retCode !== 0) {
    console.error('getActiveOrders failed:', activeRes.retMsg);
    await cancelAndExit(client, CATEGORY, SYMBOL, orderId, orderLinkId);
  }
  const orders = activeRes.result?.list ?? [];
  const found = orders.find((o: { orderId: string }) => o.orderId === orderId);
  console.log(`   found ${orders.length} active order(s), our order present: ${!!found}\n`);

  // 6. Cancel the order
  console.log('6. Cancelling order...');
  const cancelRes = await client.cancelOrder({
    category: CATEGORY,
    symbol: SYMBOL,
    orderId,
  });
  if (cancelRes.retCode !== 0) {
    console.error('cancelOrder failed:', cancelRes.retMsg);
    process.exit(1);
  }
  console.log('   cancelOrder OK\n');

  // 7. Confirm it's gone
  console.log('7. Confirming order is cancelled...');
  const activeRes2 = await client.getActiveOrders({ category: CATEGORY, symbol: SYMBOL });
  const orders2 = activeRes2.result?.list ?? [];
  const stillThere = orders2.some((o: { orderId: string }) => o.orderId === orderId);
  console.log(`   our order still in active list: ${stillThere} (expected: false)\n`);

  console.log('All steps passed. Bybit: getTickers, getPositionInfo, getWalletBalance, submitOrder, getActiveOrders, cancelOrder OK.');
}

async function cancelAndExit(
  client: RestClientV5,
  category: string,
  symbol: string,
  orderId: string,
  orderLinkId: string,
): Promise<never> {
  await client.cancelOrder({ category, symbol, orderId }).catch(() => {});
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
