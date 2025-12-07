export async function handleIncomingMessage(data) {
  try {
    console.log("📩 Mensagem recebida do WhatsApp:", data);

    const instanceId = process.env.ZAPI_INSTANCE_ID;
    const token = process.env.ZAPI_TOKEN;
    const clientToken = process.env.ZAPI_CLIENT_TOKEN;

    if (!instanceId || !token || !clientToken) {
      console.error("❌ Variáveis Z-API não configuradas no Vercel!");
      return;
    }

    const from = data.phone;
    const message = data.text?.message || "";

    const reply =
      "Olá! 👋 Aqui é o representante virtual Martín.\nComo posso te ajudar hoje?";

    const result = await sendText(instanceId, token, clientToken, from, reply);

    console.log("📤 Resposta da Z-API:", result);
    console.log("✅ Resposta enviada com sucesso!");
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
      "client-token": clientToken,   // <- AGORA NO LOCAL CORRETO!
    },
    body: JSON.stringify(body),
  });

  const result = await response.json();
  return result;
}
