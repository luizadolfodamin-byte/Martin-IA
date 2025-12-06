import axios from "axios";

export function baseUrl(instanceId) {
  return `https://api.ultramsg.com/${instanceId}`;
}

export async function sendText(instanceId, token, to, message) {
  const url = `${baseUrl(instanceId)}/messages/chat`;
  await axios.post(url, { token, to, body: message });
}

export async function sendFileBase64(instanceId, token, to, filename, base64, caption="") {
  const url = `${baseUrl(instanceId)}/messages/file`;
  await axios.post(url, { token, to, filename, caption, file: base64 });
}