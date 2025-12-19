import OpenAI from "openai";

// 🧠 Thread fixa por telefone (espelho do Playground)
const conversationThreads = new Map();

// 🔁 Deduplicação simples por messageId
const processedMessages = new Set();

export async function handleIncomingMessage(data) {
  try {
    console.log("📩 Webhook recebido:", data);

    // 🔒 Filtros técnicos (não cognitivos)
    if (
      data.fromMe ||
      data.isStatusReply ||
      data.isEdit ||
      data.status !== "RECEIVED"
    ) {
      return;
    }

    // 🔁 Deduplicação por messageId
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
      OPENAI_ASSISTANT_ID,
    } = process.env;

    if (
      !ZAPI_INSTANCE_ID ||
      !ZAPI_TOKEN ||
      !ZAPI_CLIENT_TOKEN ||
      !OPENAI_API_KEY ||
      !OPENAI_ASSISTANT_ID
    ) {
      console.error("❌ Variáveis de ambiente ausentes.");
      return;
    }

    const from = data.phone;

    // 🧠 Texto CRU do cliente (espelho do Playground)
    const userMessage = data.text?.message?.trim();
    if (!userMessage) {
      console.warn("⚠️ Mensagem sem texto.");
      return;
    }

    console.log("📝 Mensagem do cliente:", userMessage);

    // 🤖 OpenAI
    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

    // 🔗 Thread fixa por telefone
    let threadId;
    if (conversationThreads.has(from)) {
      threadId = conversationThreads.get(from);
    } else {
      const thread = await openai.beta.threads.create();
      threadId = thread.id;
      conversationThreads.set(from, threadId);
      console.log("🆕 Thread criada:", threadId);
    }

    // 📤 Envia exatamente o que o cliente escreveu
    await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: userMessage,
    });

    // ▶️ Executa o Assistant
    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: OPENAI_ASSISTANT_ID,
    });

    // ⏳ Aguarda processamento
    let runStatus = run;
    while (runStatus.status === "queued" || runStatus.status === "in_progress") {
      await new Promise((r) => setTimeout(r, 1000));
      runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id);
    }

    if (runStatus.status !== "completed") {
      console.error("❌ Run não finalizado:", runStatus.status);
      return;
    }

    // 📥 Última resposta do Assistant
    const messages = await openai.beta.threads.messages.list(threadId);
    const lastAssistantMessage = messages.data
      .slice()
      .reverse()
      .find((m) => m.role === "assistant");

    if (!lastAssistantMessage?.content?.length) {
      console.error("❌ Nenhuma resposta do Assistant.");
      return;
    }

    const assistantReply = lastAssistantMessage.content
      .map((p) => p.text?.value || "")
      .join("\n")
      .trim();

    console.log("🤖 Resposta do Martin:", assistantReply);

    // 📲 Envia exatamente a resposta do Assistant
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
