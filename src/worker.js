const {
  claimNextJob,
  markStarted,
  markSucceeded,
  markFailed,
} = require("./backendClient");
const { printReceipt } = require("./epsonPrinter");
const config = require("./config");
const logger = require("./logger");

async function runWorker(signal) {
  logger.info("Print agent started", {
    storeId: config.agent.storeId,
    printerId: config.agent.printerId,
    pollIntervalMs: config.agent.pollIntervalMs,
  });

  while (!signal.aborted) {
    let job = null;

    try {
      job = await claimNextJob();
      console.log("claimed job", job);
    } catch (err) {
      logger.error("Unexpected error during claimNextJob", {
        message: err.message,
      });
    }

    if (!job) {
      await sleep(config.agent.pollIntervalMs, signal);
      continue;
    }

    logger.info("Print job claimed", {
      jobId: job.id,
      saleId: job.payload?.saleId,
    });

    try {
      await markStarted(job.id);
      console.log("marked job started", { jobId: job.id });
      await printReceipt(job.payload);
      console.log("receipt printed", { jobId: job.id });
      await markSucceeded(job.id);
      logger.info("Print job succeeded", { jobId: job.id });
    } catch (err) {
      logger.error("Print job failed", {
        jobId: job.id,
        message: err.message,
      });
      try {
        await markFailed(job.id, err.message);
      } catch (inner) {
        logger.error("Failed to report job failure", {
          jobId: job.id,
          message: inner.message,
        });
      }
    }

    await sleep(config.agent.pollIntervalMs, signal);
  }

  logger.info("Print agent stopped.");
}

function sleep(ms, signal) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    }
  });
}

module.exports = { runWorker };
