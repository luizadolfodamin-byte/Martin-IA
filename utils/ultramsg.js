import OpenAI from "openai";

// 🧠 Memória simples de conversas por telefone
// (suficiente para esta fase; depois pode virar Redis/DB)
const conversationThreads = new Map();

export async function handleIncomingMessage(data) {
  try {
    console.log("📩 Mensagem recebida do WhatsApp:", data);

    // 🔒 FILTRO PARA EVITAR RESPOSTA DUPLICADA
    if (
      data.fromMe === true ||
      data.isStatusReply === true ||
      data.isEdit === true ||
      data.status !== "RECEIVED"
    ) {
      console.log("⏭️ Evento ignorado para evitar duplicidade.");
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
    // 🧠 NORMALIZAÇÃO DA MENSAGEM DO USUÁRIO
    // (texto OU contato)
    // -----------------------------------------

    let userMessage = "";

    // 📩 Texto normal
    if (data.text?.message) {
      userMessage = data.text.message;
    }

    // 📇 Contato enviado (formato direto)
    else if (data.contact) {
      const name = data.contact.name || "Nome não informado";
      const phone = data.contact.phone || "Telefone não informado";

      userMessage = `Contato enviado:
Nome: ${name}
Telefone: ${phone}`;
    }

    // 📇 Contato enviado (lista de contatos)
    else if (Array.isArray(data.contacts) && data.contacts.length > 0) {
      const c = data.contacts[0];
      const name = c.name || "Nome não informado";
      const phone =
        Array.isArray(c.phones) && c.phones.length > 0
          ? c.phones[0]
          : "Telefone não informado";

      userMessage = `Contato enviado:
Nome: ${name}
Telefone: ${phone}`;
    }

    if (!userMessage) {
      console.warn("⚠️ Mensagem vazia ou não reconhecida.");
      return;
    }

    console.log("📝 Mensagem normalizada para o Martin:", userMessage);

    // -----------------------------------------
    // 🤖 OPENAI ASSISTANTS (THREAD COM MEMÓRIA)
    // -----------------------------------------

    const openai = new OpenAI({ apiKey: openaiKey });

    // 🔁 Recupera ou cria thread por telefone
    let threadId;

    if (conversationThreads.has(from)) {
      threadId = conversationThreads.get(from);
      console.log("🧠 Reutilizando thread existente:", threadId);
    } else {
      const thread = await openai.beta.threads.create();
      threadId = thread.id;
      conversationThreads.set(from, threadId);
      console.log("🆕 Thread criado para o telefone:", threadId);
    }

    // 1️⃣ Enviar mensagem do usuário ao thread
    await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: userMessage,
    });

    // 2️⃣ Criar run do assistant
    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: assistantId,
    });

    // 3️⃣ Aguardar o run terminar
    let runStatus = run;

    while (runStatus.status === "queued" || runStatus.status === "in_progress") {
      console.log("⏳ Status do run:", runStatus.status);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id);
    }

    if (runStatus.status !== "completed") {
      console.error("❌ Run finalizado com erro:", runStatus.status);
      return;
    }

    // 4️⃣ Ler a resposta final do assistant
    const messages = await openai.beta.threads.messages.list(threadId);
    const last = messages.data.find((m) => m.role === "assistant");

    if (!last || !last.content?.length) {
      console.error("❌ Nenhuma resposta encontrada no Assistente.");
      return;
    }

    const iaResponse = last.content
      .map((part) => part.text?.value || "")
      .join("\n")
      .trim();

    console.log("🤖 Resposta final do Martin:", iaResponse);

    // -----------------------------------------
    // 📤 ENVIAR AO WHATSAPP
    // -----------------------------------------

    const result = await sendText(
      instanceId,
      token,
      clientToken,
      from,
      iaResponse
    );

    console.log("📤 Resposta enviada via Z-API:", result);
  } catch (error) {
    console.error("❌ Erro ao processar mensagem:", error);
  }
}

export async function sendText(instanceId, token, clientToken, to, msg) {
  const url = `https://api.z-api.io/instances/${instanceId}/token/${token}/send-text`;

  const body = {
    phone: to,
    message: msg,
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "client-token": clientToken,
    },
    body: JSON.stringify(body),
  });

  return await response.json();
}

