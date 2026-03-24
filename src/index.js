require("dotenv").config();
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
