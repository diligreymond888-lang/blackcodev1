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
  const command = parts[0].toLowerCase().replace("@", "").split("@")[0]; // Handle @bot suffix

  console.log(`Processing command: ${command} with parts:`, parts);

  switch (command) {
    case "/start":
    case "/help":
      await sendTelegramMessage(
        chatId,
        `🔑 <b>Website Manager Bot</b>\n\n` +
        `<b>📋 Key Management:</b>\n` +
        `/keys - List all keys\n` +
        `/addkey [key] [days] - Add key (0=lifetime)\n` +
        `/deletekey [key] - Delete a key\n` +
        `/activate [key] - Activate key\n` +
        `/deactivate [key] - Deactivate key\n` +
        `/resetkey [key] - Reset key usage\n` +
        `/findkey [key] - Find key details\n` +
        `/expiredkeys - List expired keys\n` +
        `/cleanexpired - Delete expired keys\n\n` +
        `<b>🛡 Anti-DDoS Management:</b>\n` +
        `/blocked - List blocked clients\n` +
        `/unblock [client_id] - Unblock a client\n` +
        `/unblockall - Unblock all clients\n` +
        `/ratelimits - View rate limits\n` +
        `/clearratelimits - Clear rate limits\n\n` +
        `<b>📊 Monitoring:</b>\n` +
        `/stats - Key statistics\n` +
        `/ddosstats - Anti-DDoS stats\n` +
        `/recentlogs [count] - Recent requests\n` +
        `/blockedlogs [count] - Blocked requests`
      );
      break;

    case "/keys":
      const { data: keys, error: keysError } = await supabase
        .from("access_keys")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);

      if (keysError) {
        await sendTelegramMessage(chatId, `❌ Error: ${keysError.message}`);
        return;
      }

      if (!keys || keys.length === 0) {
        await sendTelegramMessage(chatId, "📭 No keys found.");
        return;
      }

      let message = `🔑 <b>Access Keys (${keys.length}):</b>\n\n`;
      for (const key of keys) {
        const activeStatus = key.is_active ? "✅" : "❌";
        const usedStatus = key.is_used ? "🔴" : "🟢";
        const expiry = key.is_lifetime
          ? "♾"
          : key.expires_at
          ? new Date(key.expires_at).toLocaleDateString()
          : "—";
        message += `${activeStatus}${usedStatus} <code>${key.key_value}</code> | ${expiry}\n`;
      }
      await sendTelegramMessage(chatId, message);
      break;

    case "/addkey":
      if (parts.length < 2) {
        await sendTelegramMessage(chatId, "❌ Usage: /addkey [key] [days]\nExample: /addkey KEY123 30\n0 days = lifetime");
        return;
      }
      const newKey = parts[1];
      const days = parseInt(parts[2]) || 0;
      const isLifetime = days === 0;
      const expiresAt = isLifetime ? null : new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

      // Check if key already exists
      const { data: existingKey } = await supabase
        .from("access_keys")
        .select("key_value")
        .eq("key_value", newKey)
        .single();

      if (existingKey) {
        await sendTelegramMessage(chatId, `❌ Key <code>${newKey}</code> already exists!`);
        return;
      }

      const { error: addError } = await supabase.from("access_keys").insert({
        key_value: newKey,
        is_lifetime: isLifetime,
        expires_at: expiresAt,
        is_active: true,
        is_used: false,
        used_at: null,
      });

      if (addError) {
        await sendTelegramMessage(chatId, `❌ Error: ${addError.message}`);
      } else {
        await sendTelegramMessage(
          chatId,
          `✅ Key added!\n\n🔑 <code>${newKey}</code>\n⏰ ${isLifetime ? "Lifetime" : `${days} days`}`
        );
      }
      break;

    case "/deletekey":
      if (parts.length < 2) {
        await sendTelegramMessage(chatId, "❌ Usage: /deletekey [key]");
        return;
      }
      const keyToDelete = parts[1];

      const { data: deletedKey, error: deleteError } = await supabase
        .from("access_keys")
        .delete()
        .eq("key_value", keyToDelete)
        .select()
        .single();

      if (deleteError || !deletedKey) {
        await sendTelegramMessage(chatId, `❌ Key not found or error: ${deleteError?.message || "Not found"}`);
      } else {
        await sendTelegramMessage(chatId, `✅ Deleted: <code>${keyToDelete}</code>`);
      }
      break;

    case "/activate":
      if (parts.length < 2) {
        await sendTelegramMessage(chatId, "❌ Usage: /activate [key]");
        return;
      }
      const keyToActivate = parts[1];

      const { data: activatedKey, error: activateError } = await supabase
        .from("access_keys")
        .update({ is_active: true })
        .eq("key_value", keyToActivate)
        .select()
        .single();

      if (activateError || !activatedKey) {
        await sendTelegramMessage(chatId, `❌ Key not found`);
      } else {
        await sendTelegramMessage(chatId, `✅ Activated: <code>${keyToActivate}</code>`);
      }
      break;

    case "/deactivate":
      if (parts.length < 2) {
        await sendTelegramMessage(chatId, "❌ Usage: /deactivate [key]");
        return;
      }
      const keyToDeactivate = parts[1];

      const { data: deactivatedKey, error: deactivateError } = await supabase
        .from("access_keys")
        .update({ is_active: false })
        .eq("key_value", keyToDeactivate)
        .select()
        .single();

      if (deactivateError || !deactivatedKey) {
        await sendTelegramMessage(chatId, `❌ Key not found`);
      } else {
        await sendTelegramMessage(chatId, `⏸ Deactivated: <code>${keyToDeactivate}</code>`);
      }
      break;

    case "/resetkey":
      if (parts.length < 2) {
        await sendTelegramMessage(chatId, "❌ Usage: /resetkey [key]");
        return;
      }
      const keyToReset = parts[1];

      const { data: resetKey, error: resetError } = await supabase
        .from("access_keys")
        .update({ is_used: false, used_at: null })
        .eq("key_value", keyToReset)
        .select()
        .single();

      if (resetError || !resetKey) {
        await sendTelegramMessage(chatId, `❌ Key not found`);
      } else {
        await sendTelegramMessage(chatId, `🔄 Reset: <code>${keyToReset}</code>`);
      }
      break;

    case "/findkey":
      if (parts.length < 2) {
        await sendTelegramMessage(chatId, "❌ Usage: /findkey [key]");
        return;
      }
      const keyToFind = parts[1];

      const { data: foundKey, error: findError } = await supabase
        .from("access_keys")
        .select("*")
        .eq("key_value", keyToFind)
        .single();

      if (findError || !foundKey) {
        await sendTelegramMessage(chatId, `❌ Key not found`);
      } else {
        const status = foundKey.is_active ? "✅ Active" : "❌ Inactive";
        const usage = foundKey.is_used ? "🔴 Used" : "🟢 Available";
        const expiry = foundKey.is_lifetime 
          ? "♾ Lifetime" 
          : foundKey.expires_at 
          ? `⏰ ${new Date(foundKey.expires_at).toLocaleString()}`
          : "—";
        const usedAt = foundKey.used_at ? `📅 ${new Date(foundKey.used_at).toLocaleString()}` : "—";
        const created = new Date(foundKey.created_at).toLocaleString();

        await sendTelegramMessage(
          chatId,
          `🔍 <b>Key Details</b>\n\n` +
          `🔑 Key: <code>${foundKey.key_value}</code>\n` +
          `📌 Status: ${status}\n` +
          `📊 Usage: ${usage}\n` +
          `⏰ Expires: ${expiry}\n` +
          `📅 Used At: ${usedAt}\n` +
          `🕐 Created: ${created}`
        );
      }
      break;

    case "/expiredkeys":
      const { data: expiredKeys, error: expiredError } = await supabase
        .from("access_keys")
        .select("*")
        .eq("is_lifetime", false)
        .lt("expires_at", new Date().toISOString())
        .order("expires_at", { ascending: false });

      if (expiredError) {
        await sendTelegramMessage(chatId, `❌ Error: ${expiredError.message}`);
        return;
      }

      if (!expiredKeys || expiredKeys.length === 0) {
        await sendTelegramMessage(chatId, "✅ No expired keys found.");
        return;
      }

      let expiredMsg = `⏰ <b>Expired Keys (${expiredKeys.length}):</b>\n\n`;
      for (const key of expiredKeys.slice(0, 15)) {
        const expired = new Date(key.expires_at).toLocaleDateString();
        expiredMsg += `<code>${key.key_value}</code> | ${expired}\n`;
      }
      if (expiredKeys.length > 15) {
        expiredMsg += `\n... and ${expiredKeys.length - 15} more`;
      }
      await sendTelegramMessage(chatId, expiredMsg);
      break;

    case "/cleanexpired":
      const { data: deletedExpired, error: cleanError } = await supabase
        .from("access_keys")
        .delete()
        .eq("is_lifetime", false)
        .lt("expires_at", new Date().toISOString())
        .select();

      if (cleanError) {
        await sendTelegramMessage(chatId, `❌ Error: ${cleanError.message}`);
      } else {
        const count = deletedExpired?.length || 0;
        await sendTelegramMessage(chatId, `🧹 Cleaned ${count} expired keys`);
      }
      break;

    case "/blocked":
      const { data: blockedClients, error: blockedError } = await supabase
        .from("blocked_clients")
        .select("*")
        .eq("is_active", true)
        .order("blocked_at", { ascending: false })
        .limit(20);

      if (blockedError) {
        await sendTelegramMessage(chatId, `❌ Error: ${blockedError.message}`);
        return;
      }

      if (!blockedClients || blockedClients.length === 0) {
        await sendTelegramMessage(chatId, "✅ No blocked clients.");
        return;
      }

      let blockedMsg = `🚫 <b>Blocked Clients (${blockedClients.length}):</b>\n\n`;
      for (const client of blockedClients) {
        const expires = new Date(client.expires_at).toLocaleString();
        const shortId = client.client_id.substring(0, 16) + "...";
        blockedMsg += `🔴 <code>${shortId}</code>\n   📊 ${client.request_count} reqs | ⏰ ${expires}\n\n`;
      }
      await sendTelegramMessage(chatId, blockedMsg);
      break;

    case "/unblock":
      if (parts.length < 2) {
        await sendTelegramMessage(chatId, "❌ Usage: /unblock [client_id]\nUse full or partial ID");
        return;
      }
      const clientToUnblock = parts[1];

      const { data: unblockedClient, error: unblockError } = await supabase
        .from("blocked_clients")
        .update({ is_active: false })
        .ilike("client_id", `%${clientToUnblock}%`)
        .select();

      if (unblockError) {
        await sendTelegramMessage(chatId, `❌ Error: ${unblockError.message}`);
      } else if (!unblockedClient || unblockedClient.length === 0) {
        await sendTelegramMessage(chatId, `❌ No matching blocked client found`);
      } else {
        await sendTelegramMessage(chatId, `✅ Unblocked ${unblockedClient.length} client(s)`);
      }
      break;

    case "/unblockall":
      const { data: allUnblocked, error: unblockAllError } = await supabase
        .from("blocked_clients")
        .update({ is_active: false })
        .eq("is_active", true)
        .select();

      if (unblockAllError) {
        await sendTelegramMessage(chatId, `❌ Error: ${unblockAllError.message}`);
      } else {
        const count = allUnblocked?.length || 0;
        await sendTelegramMessage(chatId, `✅ Unblocked ${count} client(s)`);
      }
      break;

    case "/ratelimits":
      const { data: rateLimits, error: rateLimitsError } = await supabase
        .from("rate_limits")
        .select("*")
        .order("request_count", { ascending: false })
        .limit(15);

      if (rateLimitsError) {
        await sendTelegramMessage(chatId, `❌ Error: ${rateLimitsError.message}`);
        return;
      }

      if (!rateLimits || rateLimits.length === 0) {
        await sendTelegramMessage(chatId, "✅ No active rate limits.");
        return;
      }

      let rateMsg = `📊 <b>Rate Limits (Top 15):</b>\n\n`;
      for (const limit of rateLimits) {
        const shortId = limit.client_id.substring(0, 12) + "...";
        rateMsg += `<code>${shortId}</code>\n   📍 ${limit.endpoint} | 📊 ${limit.request_count} reqs\n`;
      }
      await sendTelegramMessage(chatId, rateMsg);
      break;

    case "/clearratelimits":
      const { error: clearRateError } = await supabase
        .from("rate_limits")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000"); // Delete all

      if (clearRateError) {
        await sendTelegramMessage(chatId, `❌ Error: ${clearRateError.message}`);
      } else {
        await sendTelegramMessage(chatId, `✅ Cleared all rate limits`);
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
      const usedKeys = allKeys?.filter((k) => k.is_used).length || 0;
      const availableKeys = allKeys?.filter((k) => k.is_active && !k.is_used).length || 0;
      const lifetimeKeys = allKeys?.filter((k) => k.is_lifetime).length || 0;
      const expiredCount = allKeys?.filter(
        (k) => !k.is_lifetime && k.expires_at && new Date(k.expires_at) < new Date()
      ).length || 0;

      await sendTelegramMessage(
        chatId,
        `📊 <b>Key Statistics</b>\n\n` +
        `📦 Total: ${totalKeys}\n` +
        `✅ Active: ${activeKeys}\n` +
        `❌ Inactive: ${totalKeys - activeKeys}\n` +
        `🟢 Available: ${availableKeys}\n` +
        `🔴 Used: ${usedKeys}\n` +
        `♾ Lifetime: ${lifetimeKeys}\n` +
        `⏰ Expired: ${expiredCount}`
      );
      break;

    case "/ddosstats":
      const { data: blockedStats } = await supabase
        .from("blocked_clients")
        .select("*");
      
      const { data: rateStats } = await supabase
        .from("rate_limits")
        .select("*");
      
      const { data: logStats } = await supabase
        .from("request_logs")
        .select("*")
        .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

      const activeBlocked = blockedStats?.filter(b => b.is_active).length || 0;
      const totalBlocked = blockedStats?.length || 0;
      const activeRateLimits = rateStats?.length || 0;
      const totalRequests24h = logStats?.length || 0;
      const blockedRequests24h = logStats?.filter(l => l.was_blocked).length || 0;

      await sendTelegramMessage(
        chatId,
        `🛡 <b>Anti-DDoS Statistics</b>\n\n` +
        `🚫 Active Blocks: ${activeBlocked}\n` +
        `📊 Total Blocks: ${totalBlocked}\n` +
        `⏱ Active Rate Limits: ${activeRateLimits}\n\n` +
        `<b>Last 24 Hours:</b>\n` +
        `📥 Total Requests: ${totalRequests24h}\n` +
        `🔴 Blocked: ${blockedRequests24h}\n` +
        `✅ Allowed: ${totalRequests24h - blockedRequests24h}`
      );
      break;

    case "/recentlogs":
      const logCount = parseInt(parts[1]) || 10;
      const { data: recentLogs, error: recentLogsError } = await supabase
        .from("request_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(Math.min(logCount, 20));

      if (recentLogsError) {
        await sendTelegramMessage(chatId, `❌ Error: ${recentLogsError.message}`);
        return;
      }

      if (!recentLogs || recentLogs.length === 0) {
        await sendTelegramMessage(chatId, "📭 No recent logs.");
        return;
      }

      let logsMsg = `📋 <b>Recent Logs (${recentLogs.length}):</b>\n\n`;
      for (const log of recentLogs) {
        const time = new Date(log.created_at).toLocaleTimeString();
        const status = log.was_blocked ? "🔴" : "🟢";
        const shortId = log.client_id.substring(0, 8) + "...";
        logsMsg += `${status} ${time} | <code>${shortId}</code> | ${log.endpoint}\n`;
      }
      await sendTelegramMessage(chatId, logsMsg);
      break;

    case "/blockedlogs":
      const blockedLogCount = parseInt(parts[1]) || 10;
      const { data: blockedLogs, error: blockedLogsError } = await supabase
        .from("request_logs")
        .select("*")
        .eq("was_blocked", true)
        .order("created_at", { ascending: false })
        .limit(Math.min(blockedLogCount, 20));

      if (blockedLogsError) {
        await sendTelegramMessage(chatId, `❌ Error: ${blockedLogsError.message}`);
        return;
      }

      if (!blockedLogs || blockedLogs.length === 0) {
        await sendTelegramMessage(chatId, "✅ No blocked requests.");
        return;
      }

      let blockedLogsMsg = `🔴 <b>Blocked Logs (${blockedLogs.length}):</b>\n\n`;
      for (const log of blockedLogs) {
        const time = new Date(log.created_at).toLocaleString();
        const shortId = log.client_id.substring(0, 8) + "...";
        blockedLogsMsg += `<code>${shortId}</code>\n   📍 ${log.endpoint} | ${time}\n`;
      }
      await sendTelegramMessage(chatId, blockedLogsMsg);
      break;

    default:
      await sendTelegramMessage(chatId, "❓ Unknown command. Use /help for commands.");
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
