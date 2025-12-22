import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_ADMIN_ID = Deno.env.get("TELEGRAM_ADMIN_ID")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function sendTelegramMessage(chatId: string | number, text: string, parseMode = "HTML") {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: parseMode,
    }),
  });
  return response.json();
}

async function handleCommand(chatId: number, text: string, userId: number) {
  // Check if user is admin
  if (userId.toString() !== TELEGRAM_ADMIN_ID) {
    await sendTelegramMessage(chatId, "❌ You are not authorized to use this bot.");
    return;
  }

  const parts = text.trim().split(" ");
  const command = parts[0].toLowerCase();

  switch (command) {
    case "/start":
    case "/help":
      await sendTelegramMessage(
        chatId,
        `🔑 <b>Access Key Manager Bot</b>\n\n` +
        `Available commands:\n\n` +
        `📋 <b>/keys</b> - List all keys\n` +
        `➕ <b>/addkey [key] [days]</b> - Add new key (days=0 for lifetime)\n` +
        `❌ <b>/deletekey [key]</b> - Delete a key\n` +
        `✅ <b>/activate [key]</b> - Activate a key\n` +
        `⏸ <b>/deactivate [key]</b> - Deactivate a key\n` +
        `📊 <b>/stats</b> - Show statistics`
      );
      break;

    case "/keys":
      const { data: keys, error: keysError } = await supabase
        .from("access_keys")
        .select("*")
        .order("created_at", { ascending: false });

      if (keysError) {
        await sendTelegramMessage(chatId, `❌ Error: ${keysError.message}`);
        return;
      }

      if (!keys || keys.length === 0) {
        await sendTelegramMessage(chatId, "📭 No keys found.");
        return;
      }

      let message = "🔑 <b>Access Keys:</b>\n\n";
      for (const key of keys) {
        const status = key.is_active ? "✅" : "❌";
        const expiry = key.is_lifetime
          ? "♾ Lifetime"
          : key.expires_at
          ? `⏰ ${new Date(key.expires_at).toLocaleDateString()}`
          : "No expiry";
        message += `${status} <code>${key.key_value}</code>\n   ${expiry}\n\n`;
      }
      await sendTelegramMessage(chatId, message);
      break;

    case "/addkey":
      if (parts.length < 2) {
        await sendTelegramMessage(chatId, "❌ Usage: /addkey [key_value] [days]\nExample: /addkey MY-KEY-123 30\nUse 0 days for lifetime key.");
        return;
      }
      const newKey = parts[1];
      const days = parseInt(parts[2]) || 0;
      const isLifetime = days === 0;
      const expiresAt = isLifetime ? null : new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

      const { error: addError } = await supabase.from("access_keys").insert({
        key_value: newKey,
        is_lifetime: isLifetime,
        expires_at: expiresAt,
        is_active: true,
      });

      if (addError) {
        await sendTelegramMessage(chatId, `❌ Error: ${addError.message}`);
      } else {
        await sendTelegramMessage(
          chatId,
          `✅ Key added successfully!\n\n` +
          `🔑 Key: <code>${newKey}</code>\n` +
          `⏰ ${isLifetime ? "Lifetime" : `Expires in ${days} days`}`
        );
      }
      break;

    case "/deletekey":
      if (parts.length < 2) {
        await sendTelegramMessage(chatId, "❌ Usage: /deletekey [key_value]");
        return;
      }
      const keyToDelete = parts[1];

      const { error: deleteError } = await supabase
        .from("access_keys")
        .delete()
        .eq("key_value", keyToDelete);

      if (deleteError) {
        await sendTelegramMessage(chatId, `❌ Error: ${deleteError.message}`);
      } else {
        await sendTelegramMessage(chatId, `✅ Key <code>${keyToDelete}</code> deleted.`);
      }
      break;

    case "/activate":
      if (parts.length < 2) {
        await sendTelegramMessage(chatId, "❌ Usage: /activate [key_value]");
        return;
      }
      const keyToActivate = parts[1];

      const { error: activateError } = await supabase
        .from("access_keys")
        .update({ is_active: true })
        .eq("key_value", keyToActivate);

      if (activateError) {
        await sendTelegramMessage(chatId, `❌ Error: ${activateError.message}`);
      } else {
        await sendTelegramMessage(chatId, `✅ Key <code>${keyToActivate}</code> activated.`);
      }
      break;

    case "/deactivate":
      if (parts.length < 2) {
        await sendTelegramMessage(chatId, "❌ Usage: /deactivate [key_value]");
        return;
      }
      const keyToDeactivate = parts[1];

      const { error: deactivateError } = await supabase
        .from("access_keys")
        .update({ is_active: false })
        .eq("key_value", keyToDeactivate);

      if (deactivateError) {
        await sendTelegramMessage(chatId, `❌ Error: ${deactivateError.message}`);
      } else {
        await sendTelegramMessage(chatId, `⏸ Key <code>${keyToDeactivate}</code> deactivated.`);
      }
      break;

    case "/stats":
      const { data: allKeys, error: statsError } = await supabase
        .from("access_keys")
        .select("*");

      if (statsError) {
        await sendTelegramMessage(chatId, `❌ Error: ${statsError.message}`);
        return;
      }

      const totalKeys = allKeys?.length || 0;
      const activeKeys = allKeys?.filter((k) => k.is_active).length || 0;
      const lifetimeKeys = allKeys?.filter((k) => k.is_lifetime).length || 0;
      const expiredKeys = allKeys?.filter(
        (k) => !k.is_lifetime && k.expires_at && new Date(k.expires_at) < new Date()
      ).length || 0;

      await sendTelegramMessage(
        chatId,
        `📊 <b>Statistics</b>\n\n` +
        `📦 Total Keys: ${totalKeys}\n` +
        `✅ Active: ${activeKeys}\n` +
        `❌ Inactive: ${totalKeys - activeKeys}\n` +
        `♾ Lifetime: ${lifetimeKeys}\n` +
        `⏰ Expired: ${expiredKeys}`
      );
      break;

    default:
      await sendTelegramMessage(chatId, "❓ Unknown command. Use /help to see available commands.");
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    
    // Handle webhook setup request
    if (url.searchParams.get("setup") === "true") {
      const webhookUrl = `${SUPABASE_URL}/functions/v1/telegram-bot`;
      const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook?url=${encodeURIComponent(webhookUrl)}`;
      
      const response = await fetch(telegramUrl);
      const result = await response.json();
      
      console.log("Webhook setup result:", result);
      
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Handle Telegram update
    const text = await req.text();
    
    // If body is empty or not valid JSON, just return ok
    if (!text || text === "{}" || text === "null") {
      return new Response(JSON.stringify({ ok: true, message: "No update to process" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let update;
    try {
      update = JSON.parse(text);
    } catch {
      return new Response(JSON.stringify({ ok: true, message: "Invalid JSON, skipping" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("Received update:", JSON.stringify(update));

    if (update.message) {
      const chatId = update.message.chat.id;
      const msgText = update.message.text || "";
      const userId = update.message.from.id;

      await handleCommand(chatId, msgText, userId);
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("Error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
