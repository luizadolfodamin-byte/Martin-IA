import OpenAI from "openai";

// 🔁 Deduplicação simples
const processedMessages = new Set();

export async function handleIncomingMessage(data) {
  try {
    console.log("📩 Webhook recebido:", data);

    // 🔒 Filtros técnicos
    if (
      data.fromMe ||
      data.isStatusReply ||
      data.isEdit ||
      data.status !== "RECEIVED"
    ) {
      return;
    }

    // 🔁 Evita mensagem duplicada
    if (processedMessages.has(data.messageId)) {
      console.log("🔁 Mensagem duplicada ignorada:", data.messageId);
      return;
    }
    processedMessages.add(data.messageId);

    const {
      ZAPI_INSTANCE_ID,
      ZAPI_TOKEN,
      ZAPI_CLIENT_TOKEN,
      OPENAI_API_KEY,
    } = process.env;

    if (
      !ZAPI_INSTANCE_ID ||
      !ZAPI_TOKEN ||
      !ZAPI_CLIENT_TOKEN ||
      !OPENAI_API_KEY
    ) {
      console.error("❌ Variáveis de ambiente ausentes.");
      return;
    }

    const from = data.phone;

    // 🧠 Texto exatamente como o cliente escreveu
    const userMessage = data.text?.message?.trim();
    if (!userMessage) {
      console.warn("⚠️ Mensagem sem texto.");
      return;
    }

    console.log("📝 Mensagem do cliente:", userMessage);

    // 🤖 OpenAI — CHAT PURO (espelho do Playground)
    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: `
Você é Martin, representante comercial virtual da linha Santa Clara.
Você trabalha junto com o Luiz para facilitar o atendimento comercial via WhatsApp.

Regras simples:
- Responda SEMPRE a pergunta do cliente primeiro.
- Seja natural, humano e direto.
- Se for a primeira mensagem, apresente-se brevemente.
- Depois de responder a pergunta, se fizer sentido, confirme se a pessoa cuida das compras.
- Nunca ignore perguntas.
- Nunca volte para apresentação se o cliente já perguntou algo.
`
        },
        {
          role: "user",
          content: userMessage
        }
      ]
    });

    const assistantReply =
      response.output_text ||
      "Perfeito, só um momento que já te respondo.";

    console.log("🤖 Resposta do Martin:", assistantReply);

    // 📤 Envia exatamente o que o modelo respondeu
    await sendText(
      ZAPI_INSTANCE_ID,
      ZAPI_TOKEN,
      ZAPI_CLIENT_TOKEN,
      from,
      assistantReply
    );

  } catch (err) {
    console.error("❌ Erro geral:", err);
  }
}

export async function sendText(instanceId, token, clientToken, to, msg) {
  const url = `https://api.z-api.io/instances/${instanceId}/token/${token}/send-text`;

  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "client-token": clientToken,
    },
    body: JSON.stringify({
      phone: to,
      message: msg,
    }),
  }).then((r) => r.json());
}
