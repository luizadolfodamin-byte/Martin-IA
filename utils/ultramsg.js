import OpenAI from "openai";

// 🧠 Thread persistente por telefone
const conversationThreads = new Map();

// 🧺 Buffer de mensagens por telefone
const messageBuffers = new Map();

// ⏱️ Tempo de espera humano (30 segundos)
const DEBOUNCE_TIME = 30000;

export async function handleIncomingMessage(data) {
  try {
    console.log("📩 Mensagem recebida do WhatsApp:", data);

    // 🔒 Filtro de eventos inválidos / duplicados
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

    // -----------------------------------------
    // 🧠 NORMALIZAÇÃO DA MENSAGEM
    // -----------------------------------------
    let normalizedMessage = "";

    // 📩 Texto
    if (data.text?.message) {
      normalizedMessage = data.text.message.trim();
    }

    // 📇 Contato via vCard
    else if (data.vcard || data.message?.vcard) {
      const vcard = data.vcard || data.message.vcard;

      const nameMatch = vcard.match(/FN:(.*)/);
      const phoneMatch = vcard.match(/TEL;?.*:(.*)/);

      const name = nameMatch ? nameMatch[1] : "Nome não informado";
      const phone = phoneMatch ? phoneMatch[1] : "Telefone não informado";

      normalizedMessage = `Contato enviado:\nNome: ${name}\nTelefone: ${phone}`;
    }

    // 📇 Contato estruturado
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
    // 🧺 DEBOUNCE (somente agregação)
    // -----------------------------------------
    if (!messageBuffers.has(from)) {
      messageBuffers.set(from, []);
    }

    messageBuffers.get(from).push(normalizedMessage);

    // Cancela debounce anterior
    if (messageBuffers.get(from).timer) {
      clearTimeout(messageBuffers.get(from).timer);
    }

    // Cria novo debounce
    const timer = setTimeout(async () => {
      try {
        const messages = messageBuffers.get(from) || [];
        messageBuffers.delete(from);

        // 🔹 IMPORTANTE: mensagem limpa, sem rótulos
        const combinedMessage = messages.join("\n");

        console.log("🧠 Mensagem combinada enviada ao Martin:", combinedMessage);

        // -----------------------------------------
        // 🤖 OPENAI ASSISTANT (igual Playground)
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
        while (
          runStatus.status === "queued" ||
          runStatus.status === "in_progress"
        ) {
          await new Promise((r) => setTimeout(r, 1000));
          runStatus = await openai.beta.threads.runs.retrieve(
            threadId,
            run.id
          );
        }

        if (runStatus.status !== "completed") {
          console.error("❌ Run não completado:", runStatus.status);
          return;
        }

        const messagesList = await openai.beta.threads.messages.list(threadId);

        // ✅ Sempre pega a ÚLTIMA resposta do assistant
        const lastAssistantMessage = messagesList.data
          .slice()
          .reverse()
          .find((m) => m.role === "assistant");

        if (!lastAssistantMessage || !lastAssistantMessage.content?.length) {
          console.error("❌ Nenhuma resposta do assistant.");
          return;
        }

        const iaResponse = lastAssistantMessage.content
          .map((p) => p.text?.value || "")
          .join("\n")
          .trim();

        console.log("🤖 Resposta do Martin:", iaResponse);

        await sendText(instanceId, token, clientToken, from, iaResponse);

      } catch (err) {
        console.error("❌ Erro no debounce:", err);
      }
    }, DEBOUNCE_TIME);

    // Armazena timer
    messageBuffers.get(from).timer = timer;

  } catch (err) {
    console.error("❌ Erro geral:", err);
  }
}

export async function sendText(instanceId, token, clientToken, to, msg) {
  const url = `https://api.z-api.io/instances/${instanceId}/token/${token}/send-text`;

  const response = await fetch(url, {
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

  return response.json();
}
