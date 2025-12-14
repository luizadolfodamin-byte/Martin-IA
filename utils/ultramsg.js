import OpenAI from "openai";

// 🧠 Memória de threads por telefone
const conversationThreads = new Map();

// 🧺 Buffer de mensagens por telefone
const messageBuffers = new Map();

// 🔒 Lock para evitar concorrência
const processingLocks = new Set();

// ⏱️ Tempo de espera humano (30s)
const DEBOUNCE_TIME = 30000;

export async function handleIncomingMessage(data) {
  try {
    console.log("📩 Mensagem recebida do WhatsApp:", data);

    // 🔒 Filtro de eventos inválidos
    if (
      data.fromMe === true ||
      data.isStatusReply === true ||
      data.isEdit === true ||
      data.status !== "RECEIVED"
    ) {
      return;
    }

    const instanceId = process.env.ZAPI_INSTANCE_ID;
    const token = process.env.ZAPI_TOKEN;
    const clientToken = process.env.ZAPI_CLIENT_TOKEN;
    const openaiKey = process.env.OPENAI_API_KEY;
    const assistantId = process.env.OPENAI_ASSISTANT_ID;

    if (!instanceId || !token || !clientToken || !openaiKey || !assistantId) {
      console.error("❌ Variáveis de ambiente ausentes.");
      return;
    }

    const from = data.phone;

    // 🔒 Evita concorrência simultânea
    if (processingLocks.has(from)) {
      console.log("🔒 Já processando este telefone.");
      return;
    }

    // -----------------------------------------
    // 🧠 NORMALIZAÇÃO DA MENSAGEM
    // -----------------------------------------
    let normalizedMessage = "";

    // 📩 Texto
    if (data.text?.message) {
      normalizedMessage = data.text.message.trim();
    }

    // 📇 VCARD
    else if (data.vcard || data.message?.vcard) {
      const vcard = data.vcard || data.message.vcard;

      const nameMatch = vcard.match(/FN:(.*)/);
      const phoneMatch = vcard.match(/TEL;?.*:(.*)/);

      const name = nameMatch ? nameMatch[1] : "Nome não informado";
      const phone = phoneMatch ? phoneMatch[1] : "Telefone não informado";

      normalizedMessage = `Contato enviado:\nNome: ${name}\nTelefone: ${phone}`;
    }

    // 📇 Outros formatos de contato
    else if (data.message?.contact || data.message?.contacts) {
      const c = data.message.contact || data.message.contacts?.[0];
      const name = c?.name || "Nome não informado";
      const phone = c?.phone || c?.phoneNumber || "Telefone não informado";

      normalizedMessage = `Contato enviado:\nNome: ${name}\nTelefone: ${phone}`;
    }

    if (!normalizedMessage) {
      console.warn("⚠️ Mensagem não reconhecida.");
      return;
    }

    console.log("📝 Mensagem normalizada:", normalizedMessage);

    // -----------------------------------------
    // 🧺 BUFFER (DEBOUNCE)
    // -----------------------------------------
    if (!messageBuffers.has(from)) {
      messageBuffers.set(from, []);
    }

    messageBuffers.get(from).push(normalizedMessage);
    processingLocks.add(from);

    await new Promise((resolve) => setTimeout(resolve, DEBOUNCE_TIME));

    const messages = messageBuffers.get(from) || [];
    messageBuffers.delete(from);

    const combinedMessage = `
MENSAGENS DO CLIENTE (em ordem):

${messages.join("\n")}
`.trim();

    console.log("🧠 Mensagem combinada enviada ao Martin:", combinedMessage);

    // -----------------------------------------
    // 🤖 OPENAI ASSISTANT
    // -----------------------------------------
    const openai = new OpenAI({ apiKey: openaiKey });

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
      content: combinedMessage,
    });

    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: assistantId,
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

    // ✅ Pega a ÚLTIMA resposta do assistant
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

    await sendText(instanceId, token, clientToken, from, iaResponse);

    processingLocks.delete(from);

  } catch (err) {
    console.error("❌ Erro:", err);
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

