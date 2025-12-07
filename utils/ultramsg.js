export async function handleIncomingMessage(data) {
  try {
    console.log("📩 Mensagem recebida do WhatsApp:", data);

    const instanceId = process.env.ZAPI_INSTANCE_ID;
    const token = process.env.ZAPI_TOKEN;

    if (!instanceId || !token) {
      console.error("❌ Variáveis Z-API não configuradas no Vercel!");
      return;
    }

    const from = data.phone;
    const message = data.text?.message || "";

    const reply =
      "Olá! 👋 Aqui é o representante virtual Martín.\nComo posso te ajudar hoje?";

    const result = await sendText(instanceId, token, from, reply);

    console.log("📤 Resposta da Z-API:", result);
    console.log("✅ Resposta enviada com sucesso!");
  } catch (error) {
    console.error("❌ Erro ao processar mensagem:", error);
  }
}

export async function sendText(instanceId, token, to, msg) {
  const url = `https://api.z-api.io/instances/${instanceId}/token/${token}/send-text`;

  const body = {
    phone: to,
    message: msg,
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const result = await response.json();
  return result;
}

