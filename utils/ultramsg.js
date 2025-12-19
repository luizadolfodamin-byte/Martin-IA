import OpenAI from "openai";

// 🧠 Thread persistente por telefone
const conversationThreads = new Map();

// 🧺 Buffer estruturado por telefone
// { messages: [], timer: Timeout }
const messageBuffers = new Map();

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

    // -----------------------------------------
    // 🧠 NORMALIZAÇÃO DA MENSAGEM
    // -----------------------------------------
    let normalizedMessage = "";

    if (data.text?.message) {
      normalizedMessage = data.text.message.trim();
    } else if (data.vcard || data.message?.vcard) {
      const vcard = data.vcard || data.message.vcard;
      const nameMatch = vcard.match(/FN:(.*)/);
      const phoneMatch = vcard.match(/TEL;?.*:(.*)/);

      normalizedMessage = `Contato enviado:
Nome: ${nameMatch?.[1] || "Não informado"}
Telefone: ${phoneMatch?.[1] || "Não informado"}`;
    } else if (data.message?.contact || data.message?.contacts) {
      const c = data.message.contact || data.message.contacts?.[0];
      normalizedMessage = `Contato enviado:
Nome: ${c?.name || "Não informado"}
Telefone: ${c?.phone || c?.phoneNumber || "Não informado"}`;
    }

    if (!normalizedMessage) {
      console.warn("⚠️ Mensagem não reconhecida.");
      return;
    }

    console.log("📝 Mensagem normalizada:", normalizedMessage);

    // -----------------------------------------
    // 🧺 DEBOUNCE CORRETO
    // -----------------------------------------
    if (!messageBuffers.has(from)) {
      messageBuffers.set(from, { messages: [], timer: null });
    }

    const buffer = messageBuffers.get(from);
    buffer.messages.push(normalizedMessage);

    if (buffer.timer) {
      clearTimeout(buffer.timer);
    }

    buffer.timer = setTimeout(async () => {
      try {
        const combinedMessage = buffer.messages.join("\n");
        messageBuffers.delete(from);

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
        const lastAssistantMessage = messagesList.data
          .slice()
          .reverse()
          .find((m) => m.role === "assistant");

        if (!lastAssistantMessage?.content?.length) {
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
    body: JSON.stringify({ phone: to, message: msg }),
  });

  return response.json();
}
