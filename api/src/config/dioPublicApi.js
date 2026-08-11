const DEFAULT_DIO_PUBLIC_API_KEY =
  "LKD-LOCKETDIO-AB02F55KYM55DD02MM03YY25-LKD";

function getDioPublicApiKey() {
  return (
    String(process.env.DIO_PUBLIC_API_KEY || "").trim() ||
    DEFAULT_DIO_PUBLIC_API_KEY
  );
}

module.exports = {
  DEFAULT_DIO_PUBLIC_API_KEY,
  getDioPublicApiKey,
};
