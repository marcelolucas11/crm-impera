// Emojis do seletor (os mais usados em atendimento) e as reações rápidas do WhatsApp
export const REACOES = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

export const GRUPOS = [
  ['Rostos', '😀 😃 😄 😁 😆 😅 🤣 😂 🙂 😉 😊 😇 🥰 😍 🤩 😘 😋 😛 😜 🤪 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 😌 😔 😪 😴 😷 🤒 🥵 🥶 😵 🤯 🤠 🥳 😎 🤓 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 😤 😡 😠 🤬'],
  ['Gestos', '👍 👎 👌 🤌 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐️ 🖖 👋 🤝 🙏 👏 🙌 👐 🤲 💪 ✍️ 🫶'],
  ['Corações', '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝'],
  ['Negócios', '✅ ☑️ ✔️ ❌ ⚠️ ❗ ❓ 💯 🔥 ⭐ 🌟 ✨ 🎉 🎊 🏆 🥇 🎁 🎯 💰 💵 💸 🤑 📈 📉 📊 📌 📍 📅 📆 ⏰ ⏳ 📞 📱 💬 📩 📧 📝 📄 📎 🔗 🔒 🚀 🍀 🎰 🎟️ 🎫'],
  ['Outros', '☀️ 🌙 ⚡ 🌈 ☕ 🍕 🍔 🍺 🥂 🚗 ✈️ 🏠 🎵 🎶 ⚽ 🙈 🙉 🙊 👀 👑 💎'],
].map(([nome, lista]) => [nome, lista.split(' ')]);
