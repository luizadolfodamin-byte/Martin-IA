import OpenAI from "openai";

// 🧠 Thread por telefone (memória da conversa)
const conversationThreads = new Map();

// 🧠 Estado da conversa por telefone
const conversationState = new Map();

// 🧺 Buffer de mensagens (mensagens curtas em sequência)
const messageBuffers = new Map();

// 🔒 Lock por telefone
const processingLocks = new Set();

// ⏱️ Tempo humano de espera (30s)
const DEBOUNCE_TIME = 30000;

export async function handleIncomingMessage(data) {
  try {
    console.log("📩 Webhook recebido:", data);

    // 🔒 Filtro de eventos inválidos
    if (
      data.fromMe === true ||
      data.isStatusReply === true ||
      data.isEdit === true ||
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

    // 🔒 Evita concorrência
    if (processingLocks.has(from)) {
      console.log("🔒 Já processando este telefone.");
      return;
    }

    // -----------------------------------------
    // 🧠 NORMALIZAÇÃO DA MENSAGEM
    // -----------------------------------------
    let normalizedMessage = "";

    if (data.text?.message) {
      normalizedMessage = data.text.message.trim();
    }

    // VCARD real
    else if (data.vcard || data.message?.vcard) {
      const vcard = data.vcard || data.message.vcard;
      const name = vcard.match(/FN:(.*)/)?.[1] || "Nome não informado";
      const phone = vcard.match(/TEL;?.*:(.*)/)?.[1] || "Telefone não informado";
      normalizedMessage = `Contato enviado:\nNome: ${name}\nTelefone: ${phone}`;
    }

    if (!normalizedMessage) {
      console.warn("⚠️ Mensagem não reconhecida.");
      return;
    }

    console.log("📝 Mensagem normalizada:", normalizedMessage);

    // -----------------------------------------
    // 🧺 BUFFER DE MENSAGENS
    // -----------------------------------------
    if (!messageBuffers.has(from)) {
      messageBuffers.set(from, []);
    }

    messageBuffers.get(from).push(normalizedMessage);
    processingLocks.add(from);

    await new Promise((resolve) => setTimeout(resolve, DEBOUNCE_TIME));

    const messages = messageBuffers.get(from) || [];
    messageBuffers.delete(from);

    const combinedMessage = messages.join("\n");

    console.log("🧠 Mensagens combinadas:", combinedMessage);

    // -----------------------------------------
    // 🧠 CONTROLE DE ESTADO
    // -----------------------------------------
    if (!conversationState.has(from)) {
      conversationState.set(from, "INIT");
    }

    const state = conversationState.get(from);

    // -----------------------------------------
    // 🤖 OPENAI ASSISTANT
    // -----------------------------------------
    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

    let threadId;
    if (conversationThreads.has(from)) {
      threadId = conversationThreads.get(from);
    } else {
      const thread = await openai.beta.threads.create();
      threadId = thread.id;
      conversationThreads.set(from, threadId);
    }

    // 🔥 CONTEXTO REAL PASSADO AO AGENTE
    const contextualMessage = `
ETAPA_ATUAL: ${state}

MENSAGENS_DO_CLIENTE:
${combinedMessage}

REGRAS:
- Nunca se reapresente se ETAPA_ATUAL != INIT
- Responda exatamente às perguntas do cliente
- Se perguntarem "o que você vende", responda claramente
- Só pergunte sobre compras se fizer sentido na conversa
- Não volte etapas
`.trim();

    await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: contextualMessage,
    });

    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: OPENAI_ASSISTANT_ID,
    });

    let runStatus = run;
    while (runStatus.status === "queued" || runStatus.status === "in_progress") {
      await new Promise((r) => setTimeout(r, 1000));
      runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id);
    }

    if (runStatus.status !== "completed") {
      processingLocks.delete(from);
      return;
    }

    const messagesList = await openai.beta.threads.messages.list(threadId);
    const last = messagesList.data
      .slice()
      .reverse()
      .find((m) => m.role === "assistant");

    if (!last || !last.content?.length) {
      processingLocks.delete(from);
      return;
    }

    const iaResponse = last.content
      .map((p) => p.text?.value || "")
      .join("\n")
      .trim();

    console.log("🤖 Resposta do Martin:", iaResponse);

    // -----------------------------------------
    // 🧠 ATUALIZA ESTADO
    // -----------------------------------------
    if (iaResponse.includes("A parte de compras é com você")) {
      conversationState.set(from, "WAITING_BUYER_CONFIRMATION");
    }

    if (
      iaResponse.includes("nome") &&
      iaResponse.includes("telefone") &&
      iaResponse.includes("compras")
    ) {
      conversationState.set(from, "WAITING_BUYER_CONTACT");
    }

    // -----------------------------------------
    // 📤 ENVIA WHATSAPP
    // -----------------------------------------
    await sendText(
      ZAPI_INSTANCE_ID,
      ZAPI_TOKEN,
      ZAPI_CLIENT_TOKEN,
      from,
      iaResponse
    );

    processingLocks.delete(from);

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
  }).then((r) => r.json());
}
