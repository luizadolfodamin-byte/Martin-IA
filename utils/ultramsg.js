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

    // -----------------------------------------
    //  🤖 NOVA API ASSISTANTS (OPENAI 2025)
    //  usando openai.beta.threads.*
    // -----------------------------------------

    const openai = new OpenAI({ apiKey: openaiKey });

    // 1️⃣ Criar thread
    const thread = await openai.beta.threads.create();
    const threadId = thread.id;

    // 2️⃣ Enviar msg do usuário
    await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: userMessage
    });

    // 3️⃣ Criar run
    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: assistantId
    });

    // 4️⃣ Aguardar o run terminar
    let runStatus = run;

    while (runStatus.status === "queued" || runStatus.status === "in_progress") {
      console.log("⏳ Status do run:", runStatus.status);
      await new Promise(resolve => setTimeout(resolve, 1000));
      runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id);
    }

    if (runStatus.status !== "completed") {
      console.error("❌ Run finalizado com erro:", runStatus.status);
      return;
    }

    // 5️⃣ Ler a resposta final
    const messages = await openai.beta.threads.messages.list(threadId);

    const last = messages.data.find(m => m.role === "assistant");

    if (!last || !last.content?.length) {
      console.error("❌ Nenhuma resposta encontrada no Assistente.");
      return;
    }

    const iaResponse = last.content
      .map(part => part.text?.value || "")
      .join("\n")
      .trim();

    console.log("🤖 Resposta final do Martin:", iaResponse);

    // -----------------------------------------
    //  📤 ENVIAR AO WHATSAPP
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

