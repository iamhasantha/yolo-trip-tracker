import PDFDocument from "pdfkit";

const COLORS = {
  ink: "#1F2A24",
  soft: "#52604F",
  line: "#D8D0BA",
  paper: "#F7F3E9",
  green: "#2F6F5E",
  gold: "#B4901E",
  rust: "#B8532B",
  white: "#FFFFFF",
};

function money(currency, amount) {
  return `${currency} ${Number(amount || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function dateTime(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(`${value}Z`));
}

function safeText(value) {
  return String(value ?? "-").replace(/[\u2010-\u2015]/g, "-");
}

export function createTripReport({ trip, members, contributions, expenses, summary, votes }) {
  const doc = new PDFDocument({ size: "A4", margins: { top: 48, right: 48, bottom: 48, left: 48 }, bufferPages: true });
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  const addPage = () => {
    doc.addPage();
    doc.fillColor(COLORS.soft).font("Helvetica").fontSize(8).text(`YOLO Trip Report  |  ${trip.code}`, 48, 25);
  };
  const ensureSpace = (height) => {
    if (doc.y + height > doc.page.height - 58) addPage();
  };
  const heading = (title) => {
    ensureSpace(42);
    doc.moveDown(0.8).fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(16).text(title, 48, doc.y, { width: pageWidth });
    doc.moveDown(0.35);
  };
  const metric = (x, y, width, label, value, color = COLORS.ink) => {
    doc.roundedRect(x, y, width, 58, 4).fillAndStroke(COLORS.paper, COLORS.line);
    doc.fillColor(COLORS.soft).font("Helvetica-Bold").fontSize(8).text(label.toUpperCase(), x + 10, y + 10, { width: width - 20 });
    doc.fillColor(color).font("Helvetica-Bold").fontSize(13).text(value, x + 10, y + 29, { width: width - 20 });
  };
  const barChart = (rows, valueKey, labelKey, color, valueFormatter) => {
    const max = Math.max(1, ...rows.map((row) => Number(row[valueKey]) || 0));
    if (!rows.length) {
      doc.fillColor(COLORS.soft).font("Helvetica-Oblique").fontSize(10).text("No data recorded.");
      return;
    }
    for (const row of rows) {
      ensureSpace(34);
      const y = doc.y;
      const value = Number(row[valueKey]) || 0;
      doc.fillColor(COLORS.ink).font("Helvetica").fontSize(9).text(safeText(row[labelKey]), 48, y, { width: 130, ellipsis: true });
      doc.roundedRect(180, y + 1, 235, 10, 3).fill(COLORS.paper);
      if (value > 0) doc.roundedRect(180, y + 1, Math.max(3, 235 * value / max), 10, 3).fill(color);
      doc.fillColor(COLORS.ink).font("Helvetica").fontSize(8.5).text(valueFormatter(value), 425, y, { width: 122, align: "right" });
      doc.y = y + 25;
    }
  };
  const table = (columns, rows) => {
    const rowHeight = 22;
    const drawHeader = () => {
      ensureSpace(rowHeight * 2);
      const y = doc.y;
      doc.rect(48, y, pageWidth, rowHeight).fill(COLORS.ink);
      let x = 48;
      for (const column of columns) {
        doc.fillColor(COLORS.white).font("Helvetica-Bold").fontSize(8).text(column.label, x + 5, y + 7, { width: column.width - 10, align: column.align || "left" });
        x += column.width;
      }
      doc.y = y + rowHeight;
    };
    drawHeader();
    if (!rows.length) {
      doc.fillColor(COLORS.soft).font("Helvetica-Oblique").fontSize(9).text("No entries recorded.", 53, doc.y + 7);
      doc.y += rowHeight;
      return;
    }
    rows.forEach((row, index) => {
      if (doc.y + rowHeight > doc.page.height - 58) {
        addPage();
        drawHeader();
      }
      const y = doc.y;
      if (index % 2 === 0) doc.rect(48, y, pageWidth, rowHeight).fill(COLORS.paper);
      let x = 48;
      for (const column of columns) {
        doc.fillColor(COLORS.ink).font("Helvetica").fontSize(8).text(safeText(column.value(row)), x + 5, y + 7, {
          width: column.width - 10,
          align: column.align || "left",
          ellipsis: true,
          lineBreak: false,
        });
        x += column.width;
      }
      doc.y = y + rowHeight;
    });
  };

  // Cover and executive summary
  doc.rect(0, 0, doc.page.width, 150).fill(COLORS.ink);
  doc.fillColor(COLORS.gold).font("Helvetica-Bold").fontSize(10).text("YOLO  /  FINAL TRIP REPORT", 48, 45, { characterSpacing: 1.2 });
  doc.fillColor(COLORS.white).font("Helvetica-Bold").fontSize(27).text(safeText(trip.name), 48, 70, { width: pageWidth });
  doc.fillColor("#D8E4DE").font("Helvetica").fontSize(10).text(`Trip code ${trip.code}  |  Completed ${dateTime(trip.completed_at)}`, 48, 116);
  doc.y = 176;

  const gap = 10;
  const metricWidth = (pageWidth - gap) / 2;
  let metricY = doc.y;
  metric(48, metricY, metricWidth, "Total contributed", money(trip.currency, summary.totalCollected), COLORS.green);
  metric(48 + metricWidth + gap, metricY, metricWidth, "Total expenses", money(trip.currency, summary.totalSpent), COLORS.rust);
  metricY += 70;
  metric(48, metricY, metricWidth, "Closing balance", money(trip.currency, summary.balance), summary.balance >= 0 ? COLORS.green : COLORS.rust);
  metric(48 + metricWidth + gap, metricY, metricWidth, "Completion vote", `${votes.length} of ${members.length} members`, COLORS.gold);
  doc.y = metricY + 62;

  heading("Contributions by member");
  barChart(summary.perMember, "contributed", "name", COLORS.green, (v) => money(trip.currency, v));

  heading("Expenses by category");
  barChart(summary.byCategory, "total", "category", COLORS.gold, (v) => money(trip.currency, v));

  heading("Completion approval");
  doc.fillColor(COLORS.soft).font("Helvetica").fontSize(9).text(
    `The trip was closed after ${votes.length} of ${members.length} members voted to complete it. The required threshold was ${Math.ceil(members.length / 2)} vote${Math.ceil(members.length / 2) === 1 ? "" : "s"}.`,
    48,
    doc.y,
    { width: pageWidth }
  );
  doc.moveDown(0.7);
  doc.fillColor(COLORS.ink).font("Helvetica").text(votes.map((vote) => vote.member_name).join(", ") || "No voters recorded.", 48, doc.y, { width: pageWidth });

  ensureSpace(90);
  heading("Member settlement breakdown");
  table([
    { label: "MEMBER", width: 155, value: (r) => r.name },
    { label: "CONTRIBUTED", width: 120, align: "right", value: (r) => money(trip.currency, r.contributed) },
    { label: "PAID DIRECTLY", width: 120, align: "right", value: (r) => money(trip.currency, r.spent) },
    { label: "TARGET SHORTFALL", width: 104, align: "right", value: (r) => money(trip.currency, r.owed) },
  ], summary.perMember);

  ensureSpace(90);
  heading("Contribution ledger");
  table([
    { label: "DATE", width: 82, value: (r) => dateTime(r.created_at).split(",")[0] },
    { label: "MEMBER", width: 120, value: (r) => r.member_name },
    { label: "NOTE", width: 177, value: (r) => r.note || "-" },
    { label: "AMOUNT", width: 120, align: "right", value: (r) => money(trip.currency, r.amount) },
  ], contributions);

  ensureSpace(90);
  heading("Expense ledger");
  table([
    { label: "DESCRIPTION", width: 160, value: (r) => r.description },
    { label: "CATEGORY", width: 90, value: (r) => r.category },
    { label: "PAID BY", width: 129, value: (r) => r.paid_by_name || "Common pot" },
    { label: "AMOUNT", width: 120, align: "right", value: (r) => money(trip.currency, r.amount) },
  ], expenses);

  const pageCount = doc.bufferedPageRange().count;
  for (let index = 0; index < pageCount; index++) {
    doc.switchToPage(index);
    const footerY = doc.page.height - doc.page.margins.bottom - 11;
    doc.fillColor(COLORS.soft).font("Helvetica").fontSize(8)
      .text(`Generated ${dateTime(new Date().toISOString().replace("T", " ").replace("Z", ""))}`, 48, footerY, { width: 300, lineBreak: false })
      .text(`Page ${index + 1} of ${pageCount}`, 400, footerY, { width: 147, align: "right", lineBreak: false });
  }
  doc.end();
  return doc;
}
