import { NextApiRequest, NextApiResponse } from "next";
import { handleIncomingMessage } from "../utils/ultramsg";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const data = req.body;
    console.log("📩 Webhook recebido:", data);

    await handleIncomingMessage(data);

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Erro no webhook:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
