// Função principal que recebe mensagens do webhook e responde
export async function handleIncomingMessage(data) {
  try {
    console.log("📥 Mensagem recebida do WhatsApp:", data);

    const instanceId = process.env.ZAPI_INSTANCE_ID;
    const token = process.env.ZAPI_TOKEN;

    if (!instanceId || !token) {
      console.error("❌ Variáveis Z-API não configuradas no Vercel!");
      return;
    }

    const from = data.from; // número do remetente
    const message = data.body; // texto da mensagem

    // Resposta automática inicial
    const reply =
      "Olá! 👋 Aqui é o representante virtual Martín.\nComo posso te ajudar hoje?";

    await sendText(instanceId, token, from, reply);

    console.log("📤 Resposta enviada com sucesso!");

  } catch (error) {
    console.error("❌ Erro ao processar mensagem:", error);
  }
}
