import OpenAI from "openai";

// 🧠 Thread por telefone (memória da conversa)
const conversationThreads = new Map();

// 🧠 Estado da conversa por telefone
const conversationState = new Map();

// 🧺 Buffer de mensagens por telefone
const messageBuffers = new Map();

// ⏱️ Timers de debounce por telefone
const responseTimers = new Map();

// ⏲️ Tempo humano de espera (30s)
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

    // -----------------------------------------
    // 🧠 NORMALIZAÇÃO DA MENSAGEM
    // -----------------------------------------
    let normalizedMessage = "";

    // Texto
    if (data.text?.message) {
      normalizedMessage = data.text.message.trim();
    }

    // VCARD
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
    // 🧺 BUFFER + DEBOUNCE (SEM LOCK)
    // -----------------------------------------
    if (!messageBuffers.has(from)) {
      messageBuffers.set(from, []);
    }

    messageBuffers.get(from).push(normalizedMessage);

    // Se já existe timer, reseta
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

        const contextualMessage = `
ETAPA_ATUAL: ${state}

MENSAGENS_DO_CLIENTE:
${combinedMessage}

INSTRUÇÕES:
- Responda sempre às perguntas do cliente primeiro
- Não se reapresente se ETAPA_ATUAL != INIT
- Se perguntarem o que você vende, responda claramente
- Conduza a conversa de forma humana
- Só fale sobre compras se fizer sentido no contexto
`.trim();

        await openai.beta.threads.messages.create(threadId, {
          role: "user",
          content: contextualMessage,
        });

        const run = await openai.beta.threads.runs.create(threadId, {
          assistant_id: OPENAI_ASSISTANT_ID,
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
          return;
        }

        const messagesList = await openai.beta.threads.messages.list(threadId);
        const last = messagesList.data
          .slice()
          .reverse()
          .find((m) => m.role === "assistant");

        if (!last || !last.content?.length) {
          return;
        }

        const iaResponse = last.content
          .map((p) => p.text?.value || "")
          .join("\n")
          .trim();

        console.log("🤖 Resposta do Martin:", iaResponse);

        // -----------------------------------------
        // 🧠 ATUALIZA ESTADO (simples e seguro)
        // -----------------------------------------
        if (
          iaResponse.toLowerCase().includes("compras") &&
          state === "INIT"
        ) {
          conversationState.set(from, "WAITING_BUYER_CONFIRMATION");
        }

        if (
          iaResponse.toLowerCase().includes("nome") &&
          iaResponse.toLowerCase().includes("telefone")
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

      } catch (err) {
        console.error("❌ Erro no processamento pós-debounce:", err);
      }
    }, DEBOUNCE_TIME);

    responseTimers.set(from, timer);

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
