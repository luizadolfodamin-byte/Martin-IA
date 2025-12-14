
import OpenAI from "openai";

// 🧠 Memória simples de conversas por telefone
const conversationThreads = new Map();

// 🧺 Buffer de mensagens por telefone (debounce)
const messageBuffers = new Map();

// ⏱️ Timers de resposta por telefone
const responseTimers = new Map();

// ⏲️ Tempo de espera antes de responder (ms)
const DEBOUNCE_TIME = 30000; // 30 segundos

export async function handleIncomingMessage(data) {
  try {
    console.log("📩 Mensagem recebida do WhatsApp:", data);

    // 🔒 FILTRO PARA EVITAR RESPOSTA DUPLICADA / EVENTOS INVÁLIDOS
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
    // 🧠 NORMALIZAÇÃO DA MENSAGEM (texto/contato)
    // -----------------------------------------
    let normalizedMessage = "";

    // 📩 Texto
    if (data.text?.message) {
      normalizedMessage = data.text.message;
    }
    // 📇 Contato (formato direto)
    else if (data.contact) {
      const name = data.contact.name || "Nome não informado";
      const phone = data.contact.phone || "Telefone não informado";
      normalizedMessage = `Contato enviado:\nNome: ${name}\nTelefone: ${phone}`;
    }
    // 📇 Contato (lista)
    else if (Array.isArray(data.contacts) && data.contacts.length > 0) {
      const c = data.contacts[0];
      const name = c.name || "Nome não informado";
      const phone =
        Array.isArray(c.phones) && c.phones.length > 0
          ? c.phones[0]
          : "Telefone não informado";
      normalizedMessage = `Contato enviado:\nNome: ${name}\nTelefone: ${phone}`;
    }

    if (!normalizedMessage) {
      console.warn("⚠️ Mensagem vazia ou não reconhecida.");
      return;
    }

    console.log("📝 Mensagem normalizada:", normalizedMessage);

    // -----------------------------------------
    // 🧺 DEBOUNCE: acumula mensagens do cliente
    // -----------------------------------------
    if (!messageBuffers.has(from)) {
      messageBuffers.set(from, []);
    }

    messageBuffers.get(from).push(normalizedMessage);

    // Se já existe um timer, reinicia
    if (responseTimers.has(from)) {
      clearTimeout(responseTimers.get(from));
    }

    // Cria novo timer
    const timer = setTimeout(async () => {
      try {
        const messages = messageBuffers.get(from) || [];
        messageBuffers.delete(from);
        responseTimers.delete(from);

        const combinedMessage = messages.join("\n");
        console.log("🧠 Mensagem combinada para o Martin:", combinedMessage);

        // -----------------------------------------
        // 🤖 OPENAI ASSISTANTS (THREAD COM MEMÓRIA)
        // -----------------------------------------
        const openai = new OpenAI({ apiKey: openaiKey });

        // 🔁 Recupera ou cria thread por telefone
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

        // Envia mensagem combinada
        await openai.beta.threads.messages.create(threadId, {
          role: "user",
          content: combinedMessage,
        });

        // Cria run
        const run = await openai.beta.threads.runs.create(threadId, {
          assistant_id: assistantId,
        });

        // Aguarda run
        let runStatus = run;
        while (
          runStatus.status === "queued" ||
          runStatus.status === "in_progress"
        ) {
          console.log("⏳ Status do run:", runStatus.status);
          await new Promise((resolve) => setTimeout(resolve, 1000));
          runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id);
        }

        if (runStatus.status !== "completed") {
          console.error("❌ Run finalizado com erro:", runStatus.status);
          return;
        }

        // Lê resposta final
        const messagesList = await openai.beta.threads.messages.list(threadId);
        const last = messagesList.data.find(
          (m) => m.role === "assistant"
        );

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
        // 📤 ENVIO AO WHATSAPP
        // -----------------------------------------
        const result = await sendText(
          instanceId,
          token,
          clientToken,
          from,
          iaResponse
        );

        console.log("📤 Resposta enviada via Z-API:", result);
      } catch (err) {
        console.error("❌ Erro no processamento pós-debounce:", err);
      }
    }, DEBOUNCE_TIME);

    responseTimers.set(from, timer);
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
