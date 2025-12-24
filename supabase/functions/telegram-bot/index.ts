import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_ADMIN_ID = Deno.env.get("TELEGRAM_ADMIN_ID")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Social Boost API
const BOOST_BASE_URL = "https://zefame-free.com/api_free.php";
const BOOST_PROXY_URL = "https://zefame-free.com/tiktok_proxy.php";
const BOOST_SERVICES = {
  TIKTOK_VIEWS: 229,
  TIKTOK_LIKES: 232,
  TIKTOK_FOLLOWERS: 228,
  TELEGRAM_VIEWS: 248,
  FACEBOOK_SHARES: 244,
};

const BOOST_HEADERS = {
  "accept": "application/json, text/javascript, */*; q=0.01",
  "accept-language": "en-US,en;q=0.9",
  "origin": "https://zefame.com",
  "referer": "https://zefame.com/",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
};

function generateBoostDeviceId(): string {
  return crypto.randomUUID();
}

function extractTikTokUsername(url: string): string | null {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/');
    for (const part of parts) {
      if (part.startsWith('@')) return part.substring(1);
    }
    return null;
  } catch { return null; }
}

async function boostCheckVideoId(tiktokUrl: string): Promise<{ success: boolean; videoId?: string; error?: string }> {
  try {
    const formData = new URLSearchParams();
    formData.append("action", "checkVideoId");
    formData.append("link", tiktokUrl);
    
    const response = await fetch(BOOST_BASE_URL, {
      method: "POST",
      headers: { ...BOOST_HEADERS, "content-type": "application/x-www-form-urlencoded" },
      body: formData.toString(),
    });
    
    const result = await response.json();
    if (result.success || result.status === 'success') {
      const videoId = result.data?.videoId || result.videoId;
      if (videoId) return { success: true, videoId };
    }
    return { success: false, error: result.message || "Video validation failed" };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

async function boostCheckService(params: Record<string, string>): Promise<boolean> {
  try {
    const searchParams = new URLSearchParams(params);
    const response = await fetch(`${BOOST_BASE_URL}?${searchParams.toString()}`, {
      method: "GET",
      headers: BOOST_HEADERS,
    });
    const result = await response.json();
    return (result.success || result.status === 'success') && (result.data?.allowed || result.available);
  } catch { return false; }
}

async function boostPlaceOrder(data: Record<string, string>): Promise<{ success: boolean; orderId?: string; error?: string }> {
  try {
    const formData = new URLSearchParams(data);
    const response = await fetch(`${BOOST_BASE_URL}?action=order`, {
      method: "POST",
      headers: { ...BOOST_HEADERS, "content-type": "application/x-www-form-urlencoded" },
      body: formData.toString(),
    });
    const result = await response.json();
    if (result.success) return { success: true, orderId: result.data?.orderId || "N/A" };
    return { success: false, error: result.message || "Order failed" };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

async function boostCheckUsername(username: string): Promise<{ success: boolean; nickname?: string; followers?: number; error?: string }> {
  try {
    const response = await fetch(`${BOOST_PROXY_URL}?username=${username}`, {
      headers: { ...BOOST_HEADERS, accept: "*/*" },
    });
    const result = await response.json();
    if (result.statusCode === 0 || result.status_code === 0 || result.userInfo) {
      return {
        success: true,
        nickname: result.userInfo?.user?.nickname || "N/A",
        followers: result.userInfo?.stats?.followerCount || 0,
      };
    }
    return { success: false, error: result.status_msg || "Username validation failed" };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

// Boost functions
async function executeTikTokViewsBoost(url: string): Promise<string> {
  const deviceId = generateBoostDeviceId();
  
  const videoCheck = await boostCheckVideoId(url);
  if (!videoCheck.success) return `❌ Step 1 Failed: ${videoCheck.error}`;
  
  const available = await boostCheckService({
    action: "check", device: deviceId, service: BOOST_SERVICES.TIKTOK_VIEWS.toString(), videoId: videoCheck.videoId!
  });
  if (!available) return "❌ Step 2 Failed: Service not available";
  
  const order = await boostPlaceOrder({
    action: "order", service: BOOST_SERVICES.TIKTOK_VIEWS.toString(), link: url, uuid: deviceId, videoId: videoCheck.videoId!
  });
  if (!order.success) return `❌ Step 3 Failed: ${order.error}`;
  
  return `✅ TikTok Views Boost Success!\n🎫 Order ID: ${order.orderId}`;
}

async function executeTikTokLikesBoost(url: string): Promise<string> {
  const deviceId = generateBoostDeviceId();
  
  const videoCheck = await boostCheckVideoId(url);
  if (!videoCheck.success) return `❌ Step 1 Failed: ${videoCheck.error}`;
  
  const available = await boostCheckService({
    action: "check", device: deviceId, service: BOOST_SERVICES.TIKTOK_LIKES.toString(), videoId: videoCheck.videoId!
  });
  if (!available) return "❌ Step 2 Failed: Service not available";
  
  const order = await boostPlaceOrder({
    action: "order", service: BOOST_SERVICES.TIKTOK_LIKES.toString(), link: url, uuid: deviceId, videoId: videoCheck.videoId!
  });
  if (!order.success) return `❌ Step 3 Failed: ${order.error}`;
  
  return `✅ TikTok Likes Boost Success!\n🎫 Order ID: ${order.orderId}`;
}

async function executeTikTokFollowersBoost(url: string): Promise<string> {
  const deviceId = generateBoostDeviceId();
  const username = extractTikTokUsername(url);
  if (!username) return "❌ Could not extract username from URL";
  
  const userCheck = await boostCheckUsername(username);
  if (!userCheck.success) return `❌ Step 1 Failed: ${userCheck.error}`;
  
  const available = await boostCheckService({
    action: "check", device: deviceId, service: BOOST_SERVICES.TIKTOK_FOLLOWERS.toString(), username
  });
  if (!available) return "❌ Step 2 Failed: Service not available";
  
  const order = await boostPlaceOrder({
    service: BOOST_SERVICES.TIKTOK_FOLLOWERS.toString(), link: url, uuid: deviceId, username
  });
  if (!order.success) return `❌ Step 3 Failed: ${order.error}`;
  
  return `✅ TikTok Followers Boost Success!\n👤 ${userCheck.nickname} (${userCheck.followers} followers)\n🎫 Order ID: ${order.orderId}`;
}

async function executeTelegramBoost(url: string): Promise<string> {
  const deviceId = generateBoostDeviceId();
  
  const available = await boostCheckService({
    action: "check", device: deviceId, service: BOOST_SERVICES.TELEGRAM_VIEWS.toString()
  });
  if (!available) return "❌ Step 1 Failed: Service not available";
  
  const order = await boostPlaceOrder({
    action: "order", service: BOOST_SERVICES.TELEGRAM_VIEWS.toString(), link: url, uuid: deviceId
  });
  if (!order.success) return `❌ Step 2 Failed: ${order.error}`;
  
  return `✅ Telegram Views Boost Success!\n🎫 Order ID: ${order.orderId}`;
}

async function executeFacebookBoost(url: string): Promise<string> {
  const deviceId = generateBoostDeviceId();
  
  const available = await boostCheckService({
    action: "check", device: deviceId, service: BOOST_SERVICES.FACEBOOK_SHARES.toString(), username: "share"
  });
  if (!available) return "❌ Step 1 Failed: Service not available";
  
  const order = await boostPlaceOrder({
    action: "order", service: BOOST_SERVICES.FACEBOOK_SHARES.toString(), link: url, uuid: deviceId, username: "share"
  });
  if (!order.success) return `❌ Step 2 Failed: ${order.error}`;
  
  return `✅ Facebook Shares Boost Success!\n🎫 Order ID: ${order.orderId}`;
}

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
        `<b>📢 Broadcast:</b>\n` +
        `/broadcast [title] | [message] - Add broadcast\n` +
        `/broadcasts - List all broadcasts\n` +
        `/removebroadcast [id] - Remove broadcast\n` +
        `/clearbroadcasts - Clear all broadcasts\n` +
        `/urgentbroadcast [title] | [msg] - Urgent broadcast\n\n` +
        `<b>🚀 Social Boost:</b>\n` +
        `/ttviews [url] - TikTok Views\n` +
        `/ttlikes [url] - TikTok Likes\n` +
        `/ttfollow [url] - TikTok Followers\n` +
        `/tgviews [url] - Telegram Views\n` +
        `/fbshares [url] - Facebook Shares\n\n` +
        `<b>🛡 Anti-DDoS Management:</b>\n` +
        `/blocked - List blocked clients\n` +
        `/unblock [client_id] - Unblock a client\n` +
        `/unblockall - Unblock all clients\n` +
        `/ratelimits - View rate limits\n` +
        `/clearratelimits - Clear rate limits\n\n` +
        `<b>📊 Real-Time Monitoring:</b>\n` +
        `/stats - Key statistics\n` +
        `/ddosstats - Live Anti-DDoS stats\n` +
        `/live - Real-time traffic summary\n` +
        `/threats - Active threat analysis\n` +
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
      const now = new Date();
      const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const last1h = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
      const last5m = new Date(now.getTime() - 5 * 60 * 1000).toISOString();

      const [blockedResult, rateResult, logs24hResult, logs1hResult, logs5mResult] = await Promise.all([
        supabase.from("blocked_clients").select("*"),
        supabase.from("rate_limits").select("*"),
        supabase.from("request_logs").select("*").gte("created_at", last24h),
        supabase.from("request_logs").select("*").gte("created_at", last1h),
        supabase.from("request_logs").select("*").gte("created_at", last5m)
      ]);

      const blockedStats = blockedResult.data || [];
      const rateStats = rateResult.data || [];
      const logs24h = logs24hResult.data || [];
      const logs1h = logs1hResult.data || [];
      const logs5m = logs5mResult.data || [];

      const activeBlocked = blockedStats.filter(b => b.is_active && new Date(b.expires_at) > now).length;
      const expiredBlocks = blockedStats.filter(b => b.is_active && new Date(b.expires_at) <= now).length;
      const activeRateLimits = rateStats.length;
      
      const blocked24h = logs24h.filter(l => l.was_blocked).length;
      const blocked1h = logs1h.filter(l => l.was_blocked).length;
      const blocked5m = logs5m.filter(l => l.was_blocked).length;

      // Calculate rates
      const reqPerMin = logs5m.length > 0 ? (logs5m.length / 5).toFixed(1) : "0";
      const blockRate = logs24h.length > 0 ? ((blocked24h / logs24h.length) * 100).toFixed(1) : "0";

      // Find top attackers
      const attackerCounts: Record<string, number> = {};
      logs1h.filter(l => l.was_blocked).forEach(l => {
        attackerCounts[l.client_id] = (attackerCounts[l.client_id] || 0) + 1;
      });
      const topAttackers = Object.entries(attackerCounts)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 3);

      let ddosMsg = `🛡 <b>Anti-DDoS Live Stats</b>\n` +
        `<i>Updated: ${now.toLocaleTimeString()}</i>\n\n` +
        `<b>🚫 Active Blocks:</b> ${activeBlocked}\n` +
        `<b>⏰ Expired Blocks:</b> ${expiredBlocks}\n` +
        `<b>⚡ Rate Limits:</b> ${activeRateLimits}\n\n` +
        `<b>📊 Traffic (Last 5 min):</b>\n` +
        `   📥 Requests: ${logs5m.length}\n` +
        `   🔴 Blocked: ${blocked5m}\n` +
        `   ⚡ Rate: ${reqPerMin}/min\n\n` +
        `<b>📈 Last Hour:</b>\n` +
        `   📥 Requests: ${logs1h.length}\n` +
        `   🔴 Blocked: ${blocked1h}\n\n` +
        `<b>📅 Last 24 Hours:</b>\n` +
        `   📥 Total: ${logs24h.length}\n` +
        `   🔴 Blocked: ${blocked24h}\n` +
        `   ✅ Allowed: ${logs24h.length - blocked24h}\n` +
        `   📊 Block Rate: ${blockRate}%`;

      if (topAttackers.length > 0) {
        ddosMsg += `\n\n<b>🎯 Top Threats (1h):</b>\n`;
        topAttackers.forEach(([id, count], i) => {
          ddosMsg += `   ${i + 1}. <code>${id.substring(0, 10)}...</code> (${count} hits)\n`;
        });
      }

      await sendTelegramMessage(chatId, ddosMsg);
      break;

    case "/live":
      const liveNow = new Date();
      const live1m = new Date(liveNow.getTime() - 60 * 1000).toISOString();
      const live5m = new Date(liveNow.getTime() - 5 * 60 * 1000).toISOString();

      const [live1mResult, live5mResult, liveBlockedResult] = await Promise.all([
        supabase.from("request_logs").select("*").gte("created_at", live1m),
        supabase.from("request_logs").select("*").gte("created_at", live5m),
        supabase.from("blocked_clients").select("*").eq("is_active", true)
      ]);

      const reqs1m = live1mResult.data || [];
      const reqs5m = live5mResult.data || [];
      const liveBlocked = (liveBlockedResult.data || []).filter(b => new Date(b.expires_at) > liveNow);

      // Group by endpoint
      const endpointStats: Record<string, { total: number; blocked: number }> = {};
      reqs5m.forEach(r => {
        if (!endpointStats[r.endpoint]) {
          endpointStats[r.endpoint] = { total: 0, blocked: 0 };
        }
        endpointStats[r.endpoint].total++;
        if (r.was_blocked) endpointStats[r.endpoint].blocked++;
      });

      let liveMsg = `📡 <b>Live Traffic Monitor</b>\n` +
        `<i>${liveNow.toLocaleTimeString()}</i>\n\n` +
        `<b>⚡ Last 1 Minute:</b>\n` +
        `   📥 Requests: ${reqs1m.length}\n` +
        `   🔴 Blocked: ${reqs1m.filter(r => r.was_blocked).length}\n\n` +
        `<b>📊 Last 5 Minutes:</b>\n` +
        `   📥 Requests: ${reqs5m.length}\n` +
        `   🔴 Blocked: ${reqs5m.filter(r => r.was_blocked).length}\n\n` +
        `<b>🚫 Active Blocks:</b> ${liveBlocked.length}\n\n`;

      if (Object.keys(endpointStats).length > 0) {
        liveMsg += `<b>📍 Endpoints (5m):</b>\n`;
        Object.entries(endpointStats)
          .sort(([,a], [,b]) => b.total - a.total)
          .slice(0, 5)
          .forEach(([endpoint, stats]) => {
            const status = stats.blocked > 0 ? "🔴" : "🟢";
            liveMsg += `   ${status} ${endpoint}: ${stats.total} (${stats.blocked} blocked)\n`;
          });
      }

      await sendTelegramMessage(chatId, liveMsg);
      break;

    case "/threats":
      const threatNow = new Date();
      const threat1h = new Date(threatNow.getTime() - 60 * 60 * 1000).toISOString();

      const [threatLogsResult, threatBlockedResult] = await Promise.all([
        supabase.from("request_logs").select("*").gte("created_at", threat1h).eq("was_blocked", true),
        supabase.from("blocked_clients").select("*").eq("is_active", true)
      ]);

      const threatLogs = threatLogsResult.data || [];
      const threatBlocked = (threatBlockedResult.data || []).filter(b => new Date(b.expires_at) > threatNow);

      if (threatLogs.length === 0 && threatBlocked.length === 0) {
        await sendTelegramMessage(chatId, `✅ <b>No Active Threats</b>\n\nSystem is operating normally.`);
        break;
      }

      // Analyze threat patterns
      const threatClients: Record<string, { count: number; endpoints: Set<string>; ips: Set<string> }> = {};
      threatLogs.forEach(log => {
        if (!threatClients[log.client_id]) {
          threatClients[log.client_id] = { count: 0, endpoints: new Set(), ips: new Set() };
        }
        threatClients[log.client_id].count++;
        threatClients[log.client_id].endpoints.add(log.endpoint);
        if (log.ip_address) threatClients[log.client_id].ips.add(log.ip_address);
      });

      const sortedThreats = Object.entries(threatClients)
        .sort(([,a], [,b]) => b.count - a.count)
        .slice(0, 5);

      let threatMsg = `⚠️ <b>Threat Analysis</b>\n` +
        `<i>${threatNow.toLocaleTimeString()}</i>\n\n` +
        `<b>🚨 Threat Level:</b> ${threatBlocked.length > 5 ? "HIGH" : threatBlocked.length > 0 ? "MEDIUM" : "LOW"}\n` +
        `<b>🚫 Active Blocks:</b> ${threatBlocked.length}\n` +
        `<b>🔴 Blocked Requests (1h):</b> ${threatLogs.length}\n\n`;

      if (sortedThreats.length > 0) {
        threatMsg += `<b>🎯 Top Threat Actors:</b>\n\n`;
        sortedThreats.forEach(([clientId, data], i) => {
          const shortId = clientId.substring(0, 12);
          const isBlocked = threatBlocked.some(b => b.client_id === clientId);
          threatMsg += `${i + 1}. <code>${shortId}...</code>\n`;
          threatMsg += `   📊 Hits: ${data.count}\n`;
          threatMsg += `   📍 Endpoints: ${data.endpoints.size}\n`;
          threatMsg += `   🌐 IPs: ${data.ips.size}\n`;
          threatMsg += `   Status: ${isBlocked ? "🔴 BLOCKED" : "⚠️ MONITORING"}\n\n`;
        });
      }

      await sendTelegramMessage(chatId, threatMsg);
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

    // Social Boost Commands
    case "/ttviews":
      if (parts.length < 2) {
        await sendTelegramMessage(chatId, "❌ Usage: /ttviews [tiktok_url]");
        return;
      }
      const ttViewsUrl = parts.slice(1).join(" ");
      if (!ttViewsUrl.includes("tiktok.com")) {
        await sendTelegramMessage(chatId, "❌ Invalid TikTok URL");
        return;
      }
      await sendTelegramMessage(chatId, "⏳ Processing TikTok Views boost...");
      const ttViewsResult = await executeTikTokViewsBoost(ttViewsUrl);
      await sendTelegramMessage(chatId, ttViewsResult);
      break;

    case "/ttlikes":
      if (parts.length < 2) {
        await sendTelegramMessage(chatId, "❌ Usage: /ttlikes [tiktok_url]");
        return;
      }
      const ttLikesUrl = parts.slice(1).join(" ");
      if (!ttLikesUrl.includes("tiktok.com")) {
        await sendTelegramMessage(chatId, "❌ Invalid TikTok URL");
        return;
      }
      await sendTelegramMessage(chatId, "⏳ Processing TikTok Likes boost...");
      const ttLikesResult = await executeTikTokLikesBoost(ttLikesUrl);
      await sendTelegramMessage(chatId, ttLikesResult);
      break;

    case "/ttfollow":
      if (parts.length < 2) {
        await sendTelegramMessage(chatId, "❌ Usage: /ttfollow [tiktok_profile_url]");
        return;
      }
      const ttFollowUrl = parts.slice(1).join(" ");
      if (!ttFollowUrl.includes("tiktok.com")) {
        await sendTelegramMessage(chatId, "❌ Invalid TikTok URL");
        return;
      }
      await sendTelegramMessage(chatId, "⏳ Processing TikTok Followers boost...");
      const ttFollowResult = await executeTikTokFollowersBoost(ttFollowUrl);
      await sendTelegramMessage(chatId, ttFollowResult);
      break;

    case "/tgviews":
      if (parts.length < 2) {
        await sendTelegramMessage(chatId, "❌ Usage: /tgviews [telegram_url]");
        return;
      }
      const tgViewsUrl = parts.slice(1).join(" ");
      if (!tgViewsUrl.includes("t.me") && !tgViewsUrl.includes("telegram.me")) {
        await sendTelegramMessage(chatId, "❌ Invalid Telegram URL");
        return;
      }
      await sendTelegramMessage(chatId, "⏳ Processing Telegram Views boost...");
      const tgViewsResult = await executeTelegramBoost(tgViewsUrl);
      await sendTelegramMessage(chatId, tgViewsResult);
      break;

    case "/fbshares":
      if (parts.length < 2) {
        await sendTelegramMessage(chatId, "❌ Usage: /fbshares [facebook_url]");
        return;
      }
      const fbSharesUrl = parts.slice(1).join(" ");
      if (!fbSharesUrl.includes("facebook.com")) {
        await sendTelegramMessage(chatId, "❌ Invalid Facebook URL");
        return;
      }
      await sendTelegramMessage(chatId, "⏳ Processing Facebook Shares boost...");
      const fbSharesResult = await executeFacebookBoost(fbSharesUrl);
      await sendTelegramMessage(chatId, fbSharesResult);
      break;

    // Broadcast Commands
    case "/broadcast":
      const broadcastContent = parts.slice(1).join(" ");
      if (!broadcastContent || !broadcastContent.includes("|")) {
        await sendTelegramMessage(chatId, "❌ Usage: /broadcast [title] | [message]\nExample: /broadcast Maintenance | Server will restart at 10PM");
        return;
      }
      const [bcTitle, ...bcMsgParts] = broadcastContent.split("|");
      const bcMessage = bcMsgParts.join("|").trim();
      
      if (!bcTitle.trim() || !bcMessage) {
        await sendTelegramMessage(chatId, "❌ Both title and message are required.");
        return;
      }

      const { error: bcAddError } = await supabase.from("broadcasts").insert({
        title: bcTitle.trim(),
        message: bcMessage,
        priority: "normal",
        created_by: userId.toString(),
      });

      if (bcAddError) {
        await sendTelegramMessage(chatId, `❌ Error: ${bcAddError.message}`);
      } else {
        await sendTelegramMessage(chatId, `✅ Broadcast added!\n\n📢 <b>${bcTitle.trim()}</b>\n${bcMessage}`);
      }
      break;

    case "/urgentbroadcast":
      const urgentContent = parts.slice(1).join(" ");
      if (!urgentContent || !urgentContent.includes("|")) {
        await sendTelegramMessage(chatId, "❌ Usage: /urgentbroadcast [title] | [message]");
        return;
      }
      const [urgentTitle, ...urgentMsgParts] = urgentContent.split("|");
      const urgentMsg = urgentMsgParts.join("|").trim();
      
      if (!urgentTitle.trim() || !urgentMsg) {
        await sendTelegramMessage(chatId, "❌ Both title and message are required.");
        return;
      }

      const { error: urgentAddError } = await supabase.from("broadcasts").insert({
        title: urgentTitle.trim(),
        message: urgentMsg,
        priority: "urgent",
        created_by: userId.toString(),
      });

      if (urgentAddError) {
        await sendTelegramMessage(chatId, `❌ Error: ${urgentAddError.message}`);
      } else {
        await sendTelegramMessage(chatId, `🚨 Urgent Broadcast added!\n\n⚠️ <b>${urgentTitle.trim()}</b>\n${urgentMsg}`);
      }
      break;

    case "/broadcasts":
      const { data: allBroadcasts, error: bcListError } = await supabase
        .from("broadcasts")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(15);

      if (bcListError) {
        await sendTelegramMessage(chatId, `❌ Error: ${bcListError.message}`);
        return;
      }

      if (!allBroadcasts || allBroadcasts.length === 0) {
        await sendTelegramMessage(chatId, "📭 No broadcasts found.");
        return;
      }

      let bcListMsg = `📢 <b>Broadcasts (${allBroadcasts.length}):</b>\n\n`;
      for (const bc of allBroadcasts) {
        const priority = bc.priority === "urgent" ? "🚨" : bc.priority === "high" ? "⚠️" : "📢";
        const status = bc.is_active ? "✅" : "❌";
        const date = new Date(bc.created_at).toLocaleDateString();
        const shortId = bc.id.substring(0, 8);
        bcListMsg += `${priority}${status} <b>${bc.title}</b>\n`;
        bcListMsg += `   ID: <code>${shortId}</code> | ${date}\n`;
        bcListMsg += `   ${bc.message.substring(0, 50)}${bc.message.length > 50 ? "..." : ""}\n\n`;
      }
      await sendTelegramMessage(chatId, bcListMsg);
      break;

    case "/removebroadcast":
      if (parts.length < 2) {
        await sendTelegramMessage(chatId, "❌ Usage: /removebroadcast [id]\nUse short ID from /broadcasts");
        return;
      }
      const bcIdToRemove = parts[1];

      const { data: removedBc, error: bcRemoveError } = await supabase
        .from("broadcasts")
        .delete()
        .ilike("id", `${bcIdToRemove}%`)
        .select();

      if (bcRemoveError) {
        await sendTelegramMessage(chatId, `❌ Error: ${bcRemoveError.message}`);
      } else if (!removedBc || removedBc.length === 0) {
        await sendTelegramMessage(chatId, `❌ Broadcast not found`);
      } else {
        await sendTelegramMessage(chatId, `✅ Removed broadcast: <b>${removedBc[0].title}</b>`);
      }
      break;

    case "/clearbroadcasts":
      const { data: clearedBc, error: bcClearError } = await supabase
        .from("broadcasts")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000")
        .select();

      if (bcClearError) {
        await sendTelegramMessage(chatId, `❌ Error: ${bcClearError.message}`);
      } else {
        const count = clearedBc?.length || 0;
        await sendTelegramMessage(chatId, `🧹 Cleared ${count} broadcast(s)`);
      }
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
