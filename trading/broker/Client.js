import { BreezeConnect } from "breezeconnect";
import dotenv from "dotenv";
dotenv.config();

const client = async () => {
  const apiKey = process.env.API_KEY;
  const apiSecret = process.env.API_SECRET;

  console.log({ apiKey, apiSecret });

  const breeze = new BreezeConnect({ appKey: apiKey });

  return await breeze
    .generateSession(apiSecret, "45299535")
    .then(function (resp) {
      return breeze;
    })
    .catch(function (err) {
      console.log(err);
    });
};

export default client;
