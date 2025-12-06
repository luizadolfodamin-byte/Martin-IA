import PDFDocument from "pdfkit";

export function generatePrePedidoPdfBuffer(prePedido) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40 });
    const chunks = [];
    doc.on("data", c => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    doc.fontSize(18).text("Resumo de Pré-Pedido", { align: "center" });
    doc.moveDown();
    doc.fontSize(12).text(`Hotel: ${prePedido.hotel}`);
    doc.text(`Contato: ${prePedido.contato}`);
    if (prePedido.cnpj) doc.text(`CNPJ: ${prePedido.cnpj}`);
    doc.moveDown();
    doc.text("Itens:");
    prePedido.itens.forEach((it, i) => {
      doc.text(`${i+1}. ${it.qty} x ${it.descricao} — R$ ${it.preco.toFixed(2)} (unit)`);
    });
    doc.moveDown();
    doc.text(`Subtotal: R$ ${prePedido.subtotal.toFixed(2)}`);
    doc.text(`Frete: ${prePedido.freteDesc || "Grátis"}`);
    doc.text(`TOTAL: R$ ${prePedido.total.toFixed(2)}`);
    if (prePedido.obs) { doc.moveDown(); doc.text(`Observações: ${prePedido.obs}`); }
    doc.end();
  });
}