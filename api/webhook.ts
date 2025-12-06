import { Buffer } from "buffer";
import { callOpenAI } from "../utils/openai.js";
import { sendText, sendFileBase64 } from "../utils/ultramsg.js";
import { generatePrePedidoPdfBuffer } from "../utils/pdf.js";

const OPENAI_KEY = process.env.OPENAI_KEY;
const ULTRAMSG_INSTANCE = process.env.ULTRAMSG_INSTANCE;
const ULTRAMSG_TOKEN = process.env.ULTRAMSG_TOKEN;
const ADMIN_PHONE = process.env.ADMIN_PHONE || "";

function safePhone(raw) {
  return raw ? raw.replace(/\D/g, "") : null;
}

export default async function handler(req, res) {
  try {
    const body = req.body || {};
    const from = safePhone(body.from || body.messages?.[0]?.from);
    const text = (body.body || body.messages?.[0]?.body || "").trim();
    if (!from || !text) return res.status(200).send("no-content");

    const prompt = `
Você é MARTÍN, representante comercial da Erva-Mate Pura Folha — Tipo Exportação.
Se o cliente demonstrar intenção de fechar pedido, responda:
"VOU_GERAR_PRE_PEDIDO"
E logo depois retorne APENAS um JSON contendo:
{ "hotel":"", "contact":"", "qty":40, "unitPrice":20, "cnpj":"", "obs":"" }
Se não houver intenção clara de fechar pedido, responda comercialmente.
Mensagem: "${text}"
`;

    const aiResp = await callOpenAI(
      [{ role:"system",content:"Você é MARTÍN."}, { role:"user",content:prompt }],
      OPENAI_KEY
    );

    const wants = aiResp.includes("VOU_GERAR_PRE_PEDIDO");
    let parsed=null;

    if (wants) {
      const jsonMatch = aiResp.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try { parsed = JSON.parse(jsonMatch[0]); } catch {}
      }
      if (!parsed) parsed = { qty:40, unitPrice:20 };

      const itens=[{ descricao:"Erva-Mate Pura Folha — 500g", qty:parsed.qty, preco:parsed.unitPrice }];
      const subtotal = itens.reduce((s,it)=>s+it.qty*it.preco,0);
      const total=subtotal;

      const prePedido = {
        hotel: parsed.hotel || "Hotel",
        contato: parsed.contact || from,
        cnpj: parsed.cnpj || "",
        itens,
        subtotal,
        freteDesc:"Grátis",
        total,
        obs: parsed.obs || ""
      };

      const pdfBuffer = await generatePrePedidoPdfBuffer(prePedido);
      const base64 = pdfBuffer.toString("base64");
      await sendFileBase64(ULTRAMSG_INSTANCE, ULTRAMSG_TOKEN, from, `prepedido.pdf`, base64, "Seu pré-pedido");

      if (ADMIN_PHONE) {
        await sendText(ULTRAMSG_INSTANCE, ULTRAMSG_TOKEN, ADMIN_PHONE, `Pré-pedido gerado para ${from}`);
      }

      return res.status(200).json({ ok:true });
    }

    await sendText(ULTRAMSG_INSTANCE, ULTRAMSG_TOKEN, from, aiResp);
    return res.status(200).json({ ok:true });

  } catch (err) {
    console.error(err);
    return res.status(500).send("error");
  }
}
