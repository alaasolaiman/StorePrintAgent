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

    // Set viewport to exact paper width (576px for 80mm @ 203dpi).
    // deviceScaleFactor=4 matches the original frontend html2canvas scale:4,
    // capturing at 2304px and downscaling to 576px (4:1) for sharp MODE_GRAY16 dithering.
    await page.setViewport({
      width: paperWidthPx,
      height: 1200,
      deviceScaleFactor: 4,
    });
    logger.info("Viewport set", {
      width: paperWidthPx,
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

    // Inject <base> tag so relative image/asset URLs in the backend HTML
    // resolve to the backend origin instead of the printer IP.
    const backendOrigin = new URL(config.backend.baseUrl).origin;
    let htmlToRender = htmlContent;
    if (!htmlContent.includes("<base ")) {
      htmlToRender = htmlContent.includes("<head>")
        ? htmlContent.replace("<head>", `<head><base href="${backendOrigin}/">`)
        : `<base href="${backendOrigin}/">${htmlContent}`;
    }

    logger.info("Setting page content (HTML rendering)", { backendOrigin });
    await page.setContent(htmlToRender, {
      waitUntil: "networkidle0",
      timeout: 30000,
    });
    logger.info("Page content set, HTML rendered");

    // Mirror the old frontend flow: it toggled the receipt into a dedicated
    // thermal-print mode before calling html2canvas. Without this class the
    // DOM keeps preview styling (lighter colors, borders, shadows, scrollable
    // table body, color logo treatment), so the printed result cannot match.
    await page.evaluate(`
      (function() {
        var receipt = document.querySelector(".receipt-container");
        if (receipt) {
          receipt.classList.add("thermal-print");
        }

        var logoImg = document.querySelector(".receipt-logo img");
        if (logoImg) {
          logoImg.style.filter = "grayscale(1) contrast(2.8) brightness(0.28)";
        }

        var qrSvgs = document.querySelectorAll(".qr-section svg");
        for (var s = 0; s < qrSvgs.length; s += 1) {
          qrSvgs[s].style.background = "#ffffff";
          qrSvgs[s].style.shapeRendering = "crispEdges";

          var nodes = qrSvgs[s].querySelectorAll("path, rect, circle, line, polygon, polyline");
          for (var i = 0; i < nodes.length; i += 1) {
            var fill = nodes[i].getAttribute("fill");
            if (fill && fill.toLowerCase() !== "none" && fill.toLowerCase() !== "#ffffff" && fill.toLowerCase() !== "white") {
              nodes[i].setAttribute("fill", "#000000");
            }

            var stroke = nodes[i].getAttribute("stroke");
            if (stroke && stroke.toLowerCase() !== "none" && stroke.toLowerCase() !== "#ffffff" && stroke.toLowerCase() !== "white") {
              nodes[i].setAttribute("stroke", "#000000");
            }
          }
        }
      })();
    `);

    // Force pure white background so the thermal printer receives high-contrast
    // black-on-white pixels instead of gray/off-white from the page styling.
    await page.addStyleTag({
      content: `
        html, body {
          margin: 0 !important;
          padding: 0 !important;
          background: #ffffff !important;
          color: #000000 !important;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }

        body {
          width: ${paperWidthPx}px !important;
        }

        .modal,
        .modal-dialog,
        .modal-content,
        .modal-body {
          margin: 0 !important;
          padding: 0 !important;
          max-width: none !important;
          width: auto !important;
          border: 0 !important;
          box-shadow: none !important;
          background: #ffffff !important;
        }

        .modal-header,
        .modal-footer,
        button {
          display: none !important;
        }

        .receipt-container,
        .receipt-container * {
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }

        .receipt-container {
          width: ${paperWidthPx}px !important;
          max-width: ${paperWidthPx}px !important;
          margin: 0 !important;
          padding: 30px 15px !important;
          background: #ffffff !important;
          color: #000000 !important;
          border: none !important;
          border-radius: 0 !important;
          box-shadow: none !important;
          text-shadow: none !important;
          font-size: 14px !important;
          font-weight: 600 !important;
        }

        .receipt-container .receipt-header,
        .receipt-container .receipt-discount,
        .receipt-container .receipt-footer,
        .receipt-container .payment-breakdown .summary-item {
          border-color: #000000 !important;
        }

        .receipt-container .receipt-details {
          font-weight: 700 !important;
          font-size: 17px !important;
        }

        .receipt-container .receipt-subtitle,
        .receipt-container .social-item,
        .receipt-container .qr-label,
        .receipt-container h1,
        .receipt-container h2,
        .receipt-container h3,
        .receipt-container h4,
        .receipt-container h5,
        .receipt-container h6,
        .receipt-container strong,
        .receipt-container span,
        .receipt-container div,
        .receipt-container td,
        .receipt-container th {
          color: #000000 !important;
          opacity: 1 !important;
        }

        .receipt-container .receipt-logo img {
          filter: grayscale(1) contrast(2.8) brightness(0.28) !important;
          image-rendering: -webkit-optimize-contrast !important;
          image-rendering: crisp-edges !important;
        }

        .receipt-container .qr-section svg,
        .receipt-container .qr-section canvas,
        .receipt-container .qr-section img {
          background: #ffffff !important;
          image-rendering: pixelated !important;
          image-rendering: crisp-edges !important;
        }

        .receipt-container .table-wrapper {
          border: none !important;
          border-radius: 0 !important;
        }

        .receipt-container .receipt-table {
          width: 100% !important;
          table-layout: fixed !important;
          border-collapse: collapse !important;
        }

        .receipt-container .receipt-table thead {
          display: table-header-group !important;
          width: auto !important;
          table-layout: fixed !important;
        }

        .receipt-container .receipt-table thead tr,
        .receipt-container .receipt-table tbody tr {
          display: table-row !important;
        }

        .receipt-container .receipt-table .table-body-scrollable {
          display: table-row-group !important;
          max-height: none !important;
          overflow: visible !important;
        }

        .receipt-container .receipt-table th {
          background: #ffffff !important;
          white-space: nowrap !important;
          word-break: normal !important;
          overflow-wrap: normal !important;
        }

        .receipt-container .receipt-table th,
        .receipt-container .receipt-table td {
          font-size: 15px !important;
          font-weight: 700 !important;
          border-bottom: 1px solid #000000 !important;
        }

        .receipt-container .receipt-table td {
          white-space: normal !important;
          word-break: break-word !important;
          overflow-wrap: anywhere !important;
        }

        .receipt-container .receipt-table th:nth-child(2),
        .receipt-container .receipt-table td:nth-child(2) {
          white-space: nowrap !important;
          word-break: normal !important;
          overflow-wrap: normal !important;
        }

        .receipt-container .receipt-total {
          background: #ffffff !important;
          padding: 20px !important;
        }

        .table-body-scrollable::-webkit-scrollbar {
          display: none !important;
        }
      `,
    });

    // --- Step A: Capture the rendered receipt as a PNG (replaces html2canvas) ---
    logger.info("Capturing screenshot");
    const screenshotBuffer = await page.screenshot({
      fullPage: true,
      type: "png",
      omitBackground: false,
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
  // MODE_GRAY16 matches the original frontend (html2canvas scale:4 + MODE_GRAY16).
  // At 4x resolution the dithering pattern is fine enough to look sharp on thermal paper.
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
