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
  const { printerIp, port, useSsl, paperWidthPx } = config.epson;

  if (!payload.html) {
    throw new Error("Print job payload is missing the html field.");
  }

  const htmlContent = payload.html;

  const browser = await puppeteer.launch({
    headless: config.puppeteer.headless,
    executablePath: config.puppeteer.executablePath,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      // Allow the page to reach the local-network printer
      "--disable-web-security",
    ],
  });

  try {
    const page = await browser.newPage();

    // Set viewport to receipt paper width (576px for 80mm @ 203dpi).
    // deviceScaleFactor=2 produces a crisper screenshot.
    await page.setViewport({
      width: config.puppeteer.viewportWidth,
      height: 1200,
      deviceScaleFactor: 2,
    });

    await page.setContent(htmlContent, { waitUntil: "networkidle0" });

    // --- Step A: Capture the rendered receipt as a PNG (replaces html2canvas) ---
    const screenshotBuffer = await page.screenshot({
      fullPage: true,
      type: "png",
    });
    const base64Screenshot = screenshotBuffer.toString("base64");

    // --- Step B: Inject Epson SDK into the page ---
    await page.addScriptTag({ content: EPOS_SDK_CONTENT });

    // --- Step C: Run the same printing logic as EpsonDomPrintOptions.ts ---
    // Everything inside page.evaluate() runs inside headless Chrome, so
    // window.epson.ePOSDevice, WebSocket connections etc. all work normally.
    await page.evaluate(
      async (base64, ip, epsonPort, crypto, buffer, targetWidth) => {
        function wait(ms) {
          return new Promise((r) => setTimeout(r, ms));
        }

        if (!window.epson?.ePOSDevice) {
          throw new Error(
            "Epson SDK not loaded (window.epson.ePOSDevice missing).",
          );
        }

        // ---- Build canvas from the Puppeteer screenshot ----
        const img = new Image();
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = () =>
            reject(new Error("Failed to load screenshot image."));
          img.src = `data:image/png;base64,${base64}`;
        });

        const ratio = targetWidth / img.naturalWidth;
        const finalCanvas = document.createElement("canvas");
        finalCanvas.width = targetWidth;
        finalCanvas.height = Math.max(1, Math.round(img.naturalHeight * ratio));
        const ctx = finalCanvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);
        ctx.drawImage(img, 0, 0, finalCanvas.width, finalCanvas.height);

        // ---- Connect to Epson ePOSDevice (DeviceIF, port 8008) ----
        const dev = new window.epson.ePOSDevice();

        const connectResult = await new Promise((resolve) => {
          dev.connect(ip, epsonPort, (res) => resolve(res), {
            crypto,
            buffer,
            eposprint: false,
          });
        });

        if (connectResult !== "OK" && connectResult !== "SSL_CONNECT_OK") {
          throw new Error(
            `Epson connect failed: ${connectResult} (ip=${ip} port=${epsonPort})`,
          );
        }

        // ---- Create printer device ----
        const printer = await new Promise((resolve, reject) => {
          dev.createDevice(
            "local_printer",
            dev.DEVICE_TYPE_PRINTER,
            { crypto, buffer },
            (p, code) => {
              if (code !== "OK")
                reject(new Error(`createDevice failed: ${code}`));
              else resolve(p);
            },
          );
        });

        printer.timeout = 60000;

        // ---- Send image + cut ----
        const ctx2d = finalCanvas.getContext("2d");
        printer.addImage(
          ctx2d,
          0,
          0,
          finalCanvas.width,
          finalCanvas.height,
          printer.COLOR_1,
          printer.MODE_GRAY16,
        );
        printer.addFeedLine(2);
        printer.addCut(printer.CUT_FEED);
        printer.send();

        // Give the printer time to receive the data before we disconnect
        await wait(1200);
        dev.disconnect();
      },
      base64Screenshot,
      printerIp,
      port,
      useSsl,
      false, // buffer
      paperWidthPx,
    );

    logger.info("Receipt printed", { saleId: payload.saleId, printerIp });
  } finally {
    await browser.close();
  }
}

module.exports = { printReceipt };
