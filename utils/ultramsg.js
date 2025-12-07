import OpenAI from "openai";

export async function handleIncomingMessage(data) {
  try {
    console.log("📩 Mensagem recebida do WhatsApp:", data);

    const instanceId = process.env.ZAPI_INSTANCE_ID;
    const token = process.env.ZAPI_TOKEN;
    const clientToken = process.env.ZAPI_CLIENT_TOKEN;
    const openaiKey = process.env.OPENAI_API_KEY;

    if (!instanceId || !token || !clientToken) {
      console.error("❌ Variáveis Z-API não configuradas!");
      return;
    }

    if (!openaiKey) {
      console.error("❌ OPENAI_API_KEY não configurada no Vercel!");
      return;
    }

    const from = data.phone;
    const userMessage = data.text?.message || "";

    const client = new OpenAI({ apiKey: openaiKey });

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
Você é Martín, um representante comercial virtual educado, simpático, consultivo e profissional.
Seu objetivo é ajudar o cliente, tirar dúvidas e oferecer soluções comerciais quando fizer sentido.
Responda sempre de forma clara, amigável e útil.
          `,
        },
        { role: "user", content: userMessage },
      ],
      max_tokens: 250,
      temperature: 0.7,
    });

    const iaResponse = completion.choices[0].message.content;
    console.log("🤖 Resposta da IA:", iaResponse);

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
