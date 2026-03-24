require("dotenv").config();

module.exports = {
  backend: {
    baseUrl: process.env.BACKEND_BASE_URL || "https://localhost:7171/dev/api",
    timeoutMs: parseInt(process.env.BACKEND_TIMEOUT_MS || "30000", 10),
  },
  agent: {
    storeId: process.env.STORE_ID || "store-1",
    printerId: process.env.PRINTER_ID || "front-desk",
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || "2000", 10),
  },
  epson: {
    printerIp: process.env.EPSON_PRINTER_IP || "192.168.0.19",
    port: parseInt(process.env.EPSON_PORT || "8008", 10),
    useSsl: process.env.EPSON_USE_SSL === "true",
    paperWidthPx: parseInt(process.env.EPSON_PAPER_WIDTH_PX || "576", 10),
  },
  puppeteer: {
    headless: process.env.PUPPETEER_HEADLESS !== "false",
    viewportWidth: parseInt(process.env.PUPPETEER_VIEWPORT_WIDTH || "600", 10),
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  },
};
