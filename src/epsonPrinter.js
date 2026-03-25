/**
 * epsonPrinter.js
 *
 * Node.js equivalent of EpsonDomPrintOptions.ts.
 *
 * Flow:
 *  1. Build receipt HTML from payload  (receiptTemplate.js)
 *  2. Launch Puppeteer (headless Chrome)
 *  3. Render the HTML at 576px wide
 *  4. Take a full-page screenshot (PNG) — replaces html2canvas
 *  5. Inside the page, load epos-2.27.0.js
 *  6. Draw the screenshot onto a <canvas> (same resize logic as EpsonDomPrintOptions.ts)
 *  7. Run ePOSDevice.connect → createDevice → addImage → send → disconnect
 *     (identical to EpsonDomPrintOptions.ts, just executed inside Puppeteer)
 */

const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
const config = require("./config");
const logger = require("./logger");
const EPOS_SDK_PATH = path.resolve(__dirname, "../public/epos-2.27.0.js");
const EPOS_SDK_CONTENT = fs.readFileSync(EPOS_SDK_PATH, "utf8");

/**
 * @param {object} payload  ReceiptPrintPayload — { html: string }
 */
async function printReceipt(payload) {
  logger.info("printReceipt started", {
    saleId: payload.saleId,
    hasHtml: !!payload.html,
  });

  const { printerIp, port, useSsl, paperWidthPx } = config.epson;

  if (!payload.html) {
    throw new Error("Print job payload is missing the html field.");
  }

  const htmlContent = payload.html;
  logger.info("Launching Puppeteer browser", {
    headless: config.puppeteer.headless,
    executablePath: config.puppeteer.executablePath,
  });

  const browser = await puppeteer.launch({
    headless: config.puppeteer.headless,
    executablePath: config.puppeteer.executablePath,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-web-security",
      // Allow pages to connect to local-network printers (Chrome 98+ Private Network Access)
      "--disable-features=BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights",
      "--allow-running-insecure-content",
    ],
  });
  logger.info("Browser launched successfully");

  try {
    const page = await browser.newPage();
    logger.info("Page created");

    // Set viewport to receipt paper width (576px for 80mm @ 203dpi).
    // deviceScaleFactor=2 produces a crisper screenshot.
    await page.setViewport({
      width: config.puppeteer.viewportWidth,
      height: 1200,
      deviceScaleFactor: 2,
    });
    logger.info("Viewport set", {
      width: config.puppeteer.viewportWidth,
      height: 1200,
    });

    // Navigate to printer origin first so the page has an HTTP origin that
    // Chrome's Private Network Access policy allows to connect back to the printer.
    logger.info("Navigating to printer origin for network access");
    try {
      await page.goto(`http://${printerIp}:${port}/`, {
        waitUntil: "domcontentloaded",
        timeout: 5000,
      });
    } catch (_) {
      // Printer may not serve HTTP pages — that's fine, we just need the origin set
    }

    logger.info("Setting page content (HTML rendering)");
    await page.setContent(htmlContent, { waitUntil: "networkidle0" });
    logger.info("Page content set, HTML rendered");

    // --- Step A: Capture the rendered receipt as a PNG (replaces html2canvas) ---
    logger.info("Capturing screenshot");
    const screenshotBuffer = await page.screenshot({
      fullPage: true,
      type: "png",
    });
    const base64Screenshot = screenshotBuffer.toString("base64");
    logger.info("Screenshot captured", {
      bufferSize: screenshotBuffer.length,
      base64Length: base64Screenshot.length,
    });

    // --- Step B: Inject Epson SDK into the page ---
    logger.info("Injecting Epson SDK");
    await page.addScriptTag({ content: EPOS_SDK_CONTENT });
    logger.info("Epson SDK injected successfully", {
      contentLength: EPOS_SDK_CONTENT.length,
    });

    // --- Step C: Run the same printing logic as EpsonDomPrintOptions.ts ---
    // Everything inside page.evaluate() runs inside headless Chrome, so
    // window.epson.ePOSDevice, WebSocket connections etc. all work normally.
    logger.info("Starting device connection and print operation", {
      printerIp,
      port,
      paperWidthPx,
    });

    // Pass all values as inlined JSON inside a string so pkg bytecode
    // compilation does not break Puppeteer's function serialization.
    const evalScript = `
(async function() {
  var base64 = ${JSON.stringify(base64Screenshot)};
  var ip = ${JSON.stringify(printerIp)};
  var epsonPort = String(${JSON.stringify(port)});
  var useSsl = ${JSON.stringify(useSsl)};
  var targetWidth = ${JSON.stringify(paperWidthPx)};

  function wait(ms) {
    return new Promise(function(r) { setTimeout(r, ms); });
  }

  if (!window.epson || !window.epson.ePOSDevice) {
    throw new Error("Epson SDK not loaded (window.epson.ePOSDevice missing).");
  }
  console.log("[evaluate] Epson SDK loaded");

  var img = new Image();
  await new Promise(function(resolve, reject) {
    img.onload = function() {
      console.log("[evaluate] Image loaded:", img.naturalWidth, "x", img.naturalHeight);
      resolve();
    };
    img.onerror = function() { reject(new Error("Failed to load screenshot image.")); };
    img.src = "data:image/png;base64," + base64;
  });

  var ratio = targetWidth / img.naturalWidth;
  var finalCanvas = document.createElement("canvas");
  finalCanvas.width = targetWidth;
  finalCanvas.height = Math.max(1, Math.round(img.naturalHeight * ratio));
  var ctx = finalCanvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);
  ctx.drawImage(img, 0, 0, finalCanvas.width, finalCanvas.height);
  console.log("[evaluate] Canvas ready:", finalCanvas.width, "x", finalCanvas.height);

  console.log("[evaluate] Connecting to Epson at", ip + ":" + epsonPort);
  var dev = new window.epson.ePOSDevice();
  var connectResult = await new Promise(function(resolve) {
    dev.connect(ip, epsonPort, function(res) {
      console.log("[evaluate] Connect result:", res);
      resolve(res);
    }, { crypto: useSsl, buffer: false });
  });

  if (connectResult !== "OK" && connectResult !== "SSL_CONNECT_OK") {
    throw new Error("Epson connect failed: " + connectResult + " (ip=" + ip + " port=" + epsonPort + ")");
  }

  var printer = await new Promise(function(resolve, reject) {
    dev.createDevice("local_printer", dev.DEVICE_TYPE_PRINTER, { crypto: useSsl, buffer: false, reconnect: true }, function(p, code) {
      console.log("[evaluate] createDevice:", code);
      if (code !== "OK") reject(new Error("createDevice failed: " + code));
      else resolve(p);
    });
  });
  console.log("[evaluate] Printer device created");

  printer.timeout = 60000;
  var ctx2d = finalCanvas.getContext("2d");
  printer.addImage(ctx2d, 0, 0, finalCanvas.width, finalCanvas.height, printer.COLOR_1, printer.MODE_GRAY16);
  printer.addFeedLine(2);
  printer.addCut(printer.CUT_FEED);
  printer.send();
  console.log("[evaluate] Print sent");

  await wait(1200);
  dev.disconnect();
  console.log("[evaluate] Done");
})();
`;
    await page.evaluate(evalScript);
    logger.info("Print operation completed successfully", {
      saleId: payload.saleId,
    });

    logger.info("Receipt printed", { saleId: payload.saleId, printerIp });
  } catch (err) {
    logger.error("Print job failed with error", {
      saleId: payload.saleId,
      error: err.message,
      stack: err.stack,
    });
    throw err;
  } finally {
    logger.info("Closing browser");
    await browser.close();
    logger.info("Browser closed");
  }
}

module.exports = { printReceipt };
