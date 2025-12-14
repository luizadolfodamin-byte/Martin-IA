import OpenAI from "openai";

// 🧠 Memória simples de conversas por telefone (thread por contato)
const conversationThreads = new Map();

// 🧺 Buffer de mensagens por telefone (debounce curto)
const messageBuffers = new Map();

// ⏱️ Tempo de espera síncrono (serverless safe)
const DEBOUNCE_TIME = 5000; // 5 segundos

export async function handleIncomingMessage(data) {
  try {
    console.log("📩 Mensagem recebida do WhatsApp:", data);

    // 🔒 FILTRO PARA EVITAR DUPLICIDADE / EVENTOS INVÁLIDOS
    if (
      data.fromMe === true ||
      data.isStatusReply === true ||
      data.isEdit === true ||
      data.status !== "RECEIVED"
    ) {
      console.log("⏭️ Evento ignorado.");
      return;
    }

    const instanceId = process.env.ZAPI_INSTANCE_ID;
    const token = process.env.ZAPI_TOKEN;
    const clientToken = process.env.ZAPI_CLIENT_TOKEN;
    const openaiKey = process.env.OPENAI_API_KEY;
    const assistantId = process.env.OPENAI_ASSISTANT_ID;

    if (!instanceId || !token || !clientToken) {
      console.error("❌ Variáveis Z-API não configuradas!");
      return;
    }
    if (!openaiKey) {
      console.error("❌ OPENAI_API_KEY não configurada!");
      return;
    }
    if (!assistantId) {
      console.error("❌ OPENAI_ASSISTANT_ID não configurado!");
      return;
    }

    const from = data.phone;

    // -----------------------------------------
    // 🧠 NORMALIZAÇÃO DA MENSAGEM (texto ou contato)
    // -----------------------------------------
    let normalizedMessage = "";

    // 📩 Texto
    if (data.text?.message) {
      normalizedMessage = data.text.message;
    }
    // 📇 Contato (formato direto)
    else if (data.contact) {
      normalizedMessage = `Contato enviado:
Nome: ${data.contact.name || "Não informado"}
Telefone: ${data.contact.phone || "Não informado"}`;
    }
    // 📇 Contato (lista)
    else if (Array.isArray(data.contacts) && data.contacts.length > 0) {
      const c = data.contacts[0];
      normalizedMessage = `Contato enviado:
Nome: ${c.name || "Não informado"}
Telefone: ${c.phones?.[0] || "Não informado"}`;
    }

    if (!normalizedMessage) {
      console.warn("⚠️ Mensagem vazia ou não reconhecida.");
      return;
    }

    console.log("📝 Mensagem normalizada:", normalizedMessage);

    // -----------------------------------------
    // 🧺 BUFFER + DEBOUNCE SÍNCRONO
    // -----------------------------------------
    if (!messageBuffers.has(from)) {
      messageBuffers.set(from, []);
    }

    messageBuffers.get(from).push(normalizedMessage);

    // Aguarda pequenas mensagens em sequência (comportamento humano)
    await new Promise((resolve) => setTimeout(resolve, DEBOUNCE_TIME));

    const messages = messageBuffers.get(from);
    messageBuffers.delete(from);

    if (!messages || messages.length === 0) {
      return;
    }

    const combinedMessage = messages.join("\n");
    console.log("🧠 Mensagem combinada para o Martin:", combinedMessage);

    // -----------------------------------------
    // 🤖 OPENAI ASSISTANTS (THREAD COM MEMÓRIA)
    // -----------------------------------------
    const openai = new OpenAI({ apiKey: openaiKey });

    let threadId;
    if (conversationThreads.has(from)) {
      threadId = conversationThreads.get(from);
      console.log("🧠 Reutilizando thread:", threadId);
    } else {
      const thread = await openai.beta.threads.create();
      threadId = thread.id;
      conversationThreads.set(from, threadId);
      console.log("🆕 Thread criado:", threadId);
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
      console.error("❌ Run finalizado com erro:", runStatus.status);
      return;
    }

    const list = await openai.beta.threads.messages.list(threadId);
    const last = list.data.find((m) => m.role === "assistant");

    if (!last || !last.content?.length) {
      console.error("❌ Nenhuma resposta do assistente.");
      return;
    }

    const iaResponse = last.content
      .map((p) => p.text?.value || "")
      .join("\n")
      .trim();

    console.log("🤖 Resposta final do Martin:", iaResponse);

    // -----------------------------------------
    // 📤 ENVIO AO WHATSAPP
    // -----------------------------------------
    await sendText(instanceId, token, clientToken, from, iaResponse);

  } catch (err) {
    console.error("❌ Erro ao processar mensagem:", err);
  }
}

export async function sendText(instanceId, token, clientToken, to, msg) {
  const url = `https://api.z-api.io/instances/${instanceId}/token/${token}/send-text`;

  await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "client-token": clientToken,
    },
    body: JSON.stringify({
      phone: to,
      message: msg,
    }),
  });
}

