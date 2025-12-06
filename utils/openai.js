import axios from "axios";
export async function callOpenAI(messages, openaiKey) {
  const resp = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    { model: "gpt-4.1-turbo", messages, temperature: 0.2, max_tokens: 800 },
    { headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" } }
  );
  return resp.data.choices[0].message.content;
}