/**
 * Builds a self-contained HTML receipt page from a ReceiptPrintPayload object.
 * The payload shape mirrors JewerlyApp.Domain.ValueObjects.ReceiptPrintPayload:
 *   { saleId, customerName, items: [{name, quantity, unitPrice, total}],
 *     subtotal, tax, total, paidBy, createdAt }
 */
function formatCurrency(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function buildReceiptHtml(payload) {
  const date = payload.createdAt
    ? new Date(payload.createdAt).toLocaleString()
    : new Date().toLocaleString();

  const itemRows = (payload.items || [])
    .map(
      (item) => `
      <tr>
        <td class="item-name">${escapeHtml(item.name)}</td>
        <td class="center">${item.quantity}</td>
        <td class="right">${formatCurrency(item.unitPrice)}</td>
        <td class="right">${formatCurrency(item.total)}</td>
      </tr>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Courier New', Courier, monospace;
      font-size: 12px;
      width: 576px;
      background: #fff;
      color: #000;
      padding: 10px 8px;
    }
    .center { text-align: center; }
    .right  { text-align: right; }
    .store-name { font-size: 20px; font-weight: bold; letter-spacing: 1px; }
    .tagline { font-size: 10px; margin-top: 2px; }
    .divider { border-top: 1px dashed #000; margin: 6px 0; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 11px; border-bottom: 1px solid #000; padding-bottom: 3px; }
    th.right  { text-align: right; }
    th.center { text-align: center; }
    td { padding: 2px 0; vertical-align: top; }
    .item-name { width: 50%; }
    .totals-row td { padding: 1px 0; }
    .grand-total td { font-size: 14px; font-weight: bold; padding-top: 3px; }
    .footer { margin-top: 8px; font-size: 10px; }
  </style>
</head>
<body>
  <div class="center store-name">ADI JEWELRY</div>
  <div class="center tagline">Thank you for your purchase!</div>
  <div class="divider"></div>
  <div>Sale #: ${payload.saleId}</div>
  <div>Date: ${date}</div>
  <div>Customer: ${escapeHtml(payload.customerName || "Walk-in")}</div>
  <div class="divider"></div>
  <table>
    <thead>
      <tr>
        <th>Item</th>
        <th class="center">Qty</th>
        <th class="right">Price</th>
        <th class="right">Total</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows}
    </tbody>
  </table>
  <div class="divider"></div>
  <table>
    <tr class="totals-row"><td>Subtotal</td><td class="right">${formatCurrency(payload.subtotal)}</td></tr>
    <tr class="totals-row"><td>Tax</td><td class="right">${formatCurrency(payload.tax)}</td></tr>
    <tr class="grand-total"><td>TOTAL</td><td class="right">${formatCurrency(payload.total)}</td></tr>
    <tr class="totals-row"><td>Paid By</td><td class="right">${escapeHtml(payload.paidBy || "")}</td></tr>
  </table>
  <div class="divider"></div>
  <div class="center footer">Follow us @adijewelry</div>
</body>
</html>`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

module.exports = { buildReceiptHtml };
