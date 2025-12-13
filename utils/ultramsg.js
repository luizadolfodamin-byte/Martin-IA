import OpenAI from "openai";

export async function handleIncomingMessage(data) {
  try {
    console.log("📩 Mensagem recebida do WhatsApp:", data);

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
    const userMessage = data.text?.message || "";

    if (!userMessage) {
      console.warn("⚠️ Mensagem vazia recebida.");
      return;
    }

    // ================================
    // 🤖 CHAMADA CORRETA AO ASSISTANT
    // ================================

    const openai = new OpenAI({ apiKey: openaiKey });

    // 1️⃣ Criar um thread
    const thread = await openai.threads.create();
    const threadId = thread.id;

    // 2️⃣ Enviar a mensagem do usuário para o thread
    await openai.threads.messages.create(threadId, {
      role: "user",
      content: userMessage,
    });

    // 3️⃣ Criar o run do assistant
    const run = await openai.threads.runs.create(threadId, {
      assistant_id: assistantId,
    });

    // 4️⃣ Aguardar o processamento do run
    let runStatus;
    do {
      await new Promise(resolve => setTimeout(resolve, 1000));
      runStatus = await openai.threads.runs.retrieve(threadId, run.id);
      console.log("⏳ Status do run:", runStatus.status);
    } while (runStatus.status === "queued" || runStatus.status === "in_progress");

    if (runStatus.status !== "completed") {
      console.error("❌ Run não concluído:", runStatus.status);
      return;
    }

    // 5️⃣ Buscar mensagens finais do thread
    const messages = await openai.threads.messages.list(threadId);
    const lastMessage = messages.data.find(msg => msg.role === "assistant");

    if (!lastMessage || !lastMessage.content || !lastMessage.content.length) {
      console.error("❌ Nenhuma resposta do assistant encontrada.");
      return;
    }

    // 6️⃣ Extrair texto da resposta
    const iaResponse = lastMessage.content
      .map(item => item.text?.value || "")
      .join("\n")
      .trim();

    console.log("🤖 Resposta final do Martin:", iaResponse);

    // ================================
    // 📤 ENVIO DA RESPOSTA AO WHATSAPP
    // ================================

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


