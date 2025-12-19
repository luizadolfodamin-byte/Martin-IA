import OpenAI from "openai";

// 🧠 Thread por telefone
const conversationThreads = new Map();

export async function handleIncomingMessage(data) {
  try {
    console.log("📩 Webhook recebido:", data);

    if (
      data.fromMe ||
      data.isStatusReply ||
      data.isEdit ||
      data.status !== "RECEIVED"
    ) {
      return;
    }

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

    // 🧠 Normalização
    let normalizedMessage = "";
    if (data.text?.message) {
      normalizedMessage = data.text.message.trim();
    }
    if (!normalizedMessage) return;

    console.log("📝 Mensagem normalizada:", normalizedMessage);

    // 🤖 OpenAI
    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

    let threadId;
    if (conversationThreads.has(from)) {
      threadId = conversationThreads.get(from);
    } else {
      const thread = await openai.beta.threads.create();
      threadId = thread.id;
      conversationThreads.set(from, threadId);
    }

    await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: normalizedMessage,
    });

    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: OPENAI_ASSISTANT_ID,
    });

    let runStatus = run;
    while (runStatus.status === "queued" || runStatus.status === "in_progress") {
      await new Promise((r) => setTimeout(r, 1000));
      runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id);
    }

    if (runStatus.status !== "completed") return;

    const messagesList = await openai.beta.threads.messages.list(threadId);
    const last = messagesList.data.reverse().find(m => m.role === "assistant");
    if (!last?.content?.length) return;

    const iaResponse = last.content
      .map(p => p.text?.value || "")
      .join("\n");

    console.log("🤖 Resposta do Martin:", iaResponse);

    await sendText(
      ZAPI_INSTANCE_ID,
      ZAPI_TOKEN,
      ZAPI_CLIENT_TOKEN,
      from,
      iaResponse
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
    body: JSON.stringify({ phone: to, message: msg }),
  }).then(r => r.json());
}
