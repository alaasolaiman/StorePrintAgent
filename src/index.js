const path = require("path");
const dotenv = require("dotenv");

const envPath = process.pkg
  ? path.join(path.dirname(process.execPath), ".env")
  : path.resolve(__dirname, "../.env");

dotenv.config({ path: envPath });
const { runWorker } = require("./worker");
const logger = require("./logger");

const controller = new AbortController();

process.on("SIGINT", () => {
  logger.info("Received SIGINT, shutting down...");
  controller.abort();
});

process.on("SIGTERM", () => {
  logger.info("Received SIGTERM, shutting down...");
  controller.abort();
});

runWorker(controller.signal).catch((err) => {
  logger.error("Unhandled error in worker", {
    message: err.message,
    stack: err.stack,
  });
  process.exit(1);
});
