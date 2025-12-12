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

    //
    // ---- NOVA CHAMADA DO ASSISTANT ----
    //

    const payload = {
      input: [
        {
          role: "user",
          content: userMessage
        }
      ]
    };

    const resp = await fetch(
      `https://api.openai.com/v1/assistants/${assistantId}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${openaiKey}`
        },
        body: JSON.stringify(payload)
      }
    );

    if (!resp.ok) {
      const txt = await resp.text();
      console.error("❌ Erro na chamada ao Assistants:", resp.status, txt);
      return;
    }

    const dataResp = await resp.json();
    console.log("📥 Resposta Assistants (raw):", dataResp);

    // ---- EXTRAÇÃO DE RESPOSTA ----
    let iaResponse = "";

    if (dataResp.output_text) {
      iaResponse = dataResp.output_text;
    } else if (Array.isArray(dataResp.output) && dataResp.output.length) {
      iaResponse = dataResp.output
        .map(o => {
          if (o.content && Array.isArray(o.content)) {
            return o.content.map(c => c.text || c).join(" ");
          }
          return "";
        })
        .filter(Boolean)
        .join("\n");
    } else if (dataResp.message && Array.isArray(dataResp.message.content)) {
      iaResponse = dataResp.message.content.map(c => c.text || c).join(" ");
    } else {
      iaResponse = JSON.stringify(dataResp);
    }

    console.log("🤖 Resposta formatada da IA:", iaResponse);

    //
    // ---- ENVIO AO WHATSAPP ----
    //
    const result = await sendText(instanceId, token, clientToken, from, iaResponse);
    console.log("📤 Resposta enviada Z-API:", result);

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
