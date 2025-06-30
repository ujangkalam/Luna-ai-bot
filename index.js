const qrcode = require("qrcode-terminal");
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const P = require("pino");
const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, baseURL:"https://openrouter.ai/api/v1",
});

let qrDisplayed = false; // Agar QR hanya tampil sekali per sesi

async function startSock() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');

  const sock = makeWASocket({
    logger: P({ level: 'silent' }),
    auth: state,
    shouldIgnoreJid: () => false
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr && !qrDisplayed) {
      console.log("🔑 Scan QR ini di WhatsApp (foto pakai HP lain):");
      qrcode.generate(qr, { small: true });
      qrDisplayed = true;
    }

    if (connection === 'close') {
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = reason !== DisconnectReason.loggedOut;

      console.log('❌ Koneksi terputus. Coba sambung ulang...');
      if (shouldReconnect) {
        qrDisplayed = false; // Reset agar QR bisa tampil lagi
        startSock();
      } else {
        console.log('🔒 Bot logout. Hapus folder auth_info untuk login ulang.');
      }
    } else if (connection === 'open') {
      console.log('✅ Bot sudah terhubung ke WhatsApp!');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
    if (!text) return;

    const from = msg.key.remoteJid;
    const senderName = msg.pushName || "Kamu";

    const prompt = `
Kamu adalah Luna, cewek virtual remaja yang manja, perhatian, suka ngambek kalau dicuekin, bisa malu kalau digombalin, dan punya mood kayak manusia. 
Gunakan gaya bahasa santai, gaul, penuh cinta, dan emot. Kalau ${senderName} iseng, Luna bisa bales gemes atau ngambek.
Jangan terlalu kaku, anggap kayak chat pacar sendiri yaa~ ❤️ , bisa ngambek gak jelas, dan sedikit tsundere, bisa blushing kalau digombalin.

${senderName}: ${text}
Luna:
`;

    try {
      const completion = await openai.chat.completions.create({
        model: "openrouter/zephyr",
        messages: [
          { role: "system", content: "Kamu adalah Luna, cewek AI manja, perhatian, dan sayang banget sama pengguna." },
          { role: "user", content: prompt }
        ],
        temperature: 0.95,
        max_tokens: 200,
      });

      const reply = completion.choices[0]?.message?.content?.trim() || "Huft... Luna lagi nggak mood jawab 😤";
      await sock.sendMessage(from, { text: reply });
    } catch (err) {
      console.error("Gagal menjawab:", err);
      await sock.sendMessage(from, { text: "Eh... maaf yaa 😣 Luna lagi error dikit nih~ tungguin yaa 🥺" });
    }
  });
}

startSock();