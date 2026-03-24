const axios = require("axios");
const https = require("https");
const config = require("./config");
const logger = require("./logger");

// Skip TLS cert validation for local dev (self-signed certs)
const client = axios.create({
  baseURL: config.backend.baseUrl,
  timeout: config.backend.timeoutMs,
  httpsAgent: new https.Agent({ rejectUnauthorized: false }),
});

/**
 * Claims the next pending print job for this store/printer.
 * Returns the PrintJobDto object, or null if none available.
 */
async function claimNextJob() {
  try {
    console.log("config.agent",config.agent)
    const res = await client.post("PrintJobs/ClaimNextPrintJob", {
      storeId: config.agent.storeId,
      printerId: config.agent.printerId,
    });
    return res.data?.data ?? null;
  } catch (err) {
    logger.error("ClaimNextPrintJob failed", { message: err.message });
    return null;
  }
}

async function markStarted(jobId) {
  await client.post("PrintJobs/MarkPrintJobStarted", { printJobId: jobId });
}

async function markSucceeded(jobId) {
  await client.post("PrintJobs/MarkPrintJobSucceeded", { printJobId: jobId });
}

async function markFailed(jobId, reason) {
  await client.post("PrintJobs/MarkPrintJobFailed", {
    jobId: jobId,
    failureReason: String(reason).substring(0, 400),
  });
}

module.exports = { claimNextJob, markStarted, markSucceeded, markFailed };
