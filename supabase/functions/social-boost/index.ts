import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BASE_URL = "https://zefame-free.com/api_free.php";
const PROXY_URL = "https://zefame-free.com/tiktok_proxy.php";

const SERVICES = {
  TIKTOK_VIEWS: 229,
  TIKTOK_LIKES: 232,
  TIKTOK_FOLLOWERS: 228,
  TELEGRAM_VIEWS: 248,
  FACEBOOK_SHARES: 244,
};

const HEADERS = {
  "accept": "application/json, text/javascript, */*; q=0.01",
  "accept-language": "en-US,en;q=0.9",
  "origin": "https://zefame.com",
  "referer": "https://zefame.com/",
  "sec-ch-ua": '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "cross-site",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36"
};

function generateDeviceId(): string {
  return crypto.randomUUID();
}

// Comprehensive French to English translation
function translateMessage(message: string): string {
  if (!message) return "Unknown error";
  
  const translations: [RegExp, string][] = [
    [/Impossible d'extraire l'ID de la vid[ée]o/gi, "Could not extract video ID"],
    [/Vous avez d[ée]j[àa] utilis[ée] ce service/gi, "You have already used this service"],
    [/Attendez encore/gi, "Wait another"],
    [/Service non disponible/gi, "Service not available"],
    [/Erreur lors de la r[ée]cup[ée]ration/gi, "Error during retrieval"],
    [/Erreur interne/gi, "Internal error"],
    [/Erreur/gi, "Error"],
    [/Veuillez r[ée]essayer/gi, "Please try again"],
    [/Lien invalide/gi, "Invalid link"],
    [/Utilisateur non trouv[ée]/gi, "User not found"],
    [/Vid[ée]o non trouv[ée]e?/gi, "Video not found"],
    [/Veuillez patienter/gi, "Please wait"],
    [/avant de r[ée]utiliser/gi, "before reusing"],
    [/Trop de requ[êe]tes/gi, "Too many requests"],
    [/minute[s]?/gi, "minute(s)"],
    [/heure[s]?/gi, "hour(s)"],
    [/second[es]?/gi, "second(s)"],
    [/Commande pass[ée]e avec succ[èe]s/gi, "Order placed successfully"],
    [/Lien non valide/gi, "Invalid link"],
    [/Profil non trouv[ée]/gi, "Profile not found"],
    [/Compte priv[ée]/gi, "Private account"],
    [/Service temporairement indisponible/gi, "Service temporarily unavailable"],
    [/temporairement/gi, "temporarily"],
    [/indisponible/gi, "unavailable"],
    [/Impossible/gi, "Unable"],
    [/La vid[ée]o n'existe pas/gi, "Video does not exist"],
    [/Le profil n'existe pas/gi, "Profile does not exist"],
  ];

  let translated = message;
  for (const [pattern, replacement] of translations) {
    translated = translated.replace(pattern, replacement);
  }
  // Clean up time format
  translated = translated.replace(/(\d+)h\s*(\d+)min/g, '$1h $2m');
  return translated;
}

function extractVideoId(tiktokUrl: string): string | null {
  try {
    const url = new URL(tiktokUrl);
    const pathParts = url.pathname.split('/');
    for (let i = 0; i < pathParts.length; i++) {
      if (pathParts[i] === 'video' && i + 1 < pathParts.length) {
        return pathParts[i + 1].split('?')[0];
      }
    }
    return null;
  } catch {
    return null;
  }
}

function extractUsername(tiktokUrl: string): string | null {
  try {
    const url = new URL(tiktokUrl);
    const pathParts = url.pathname.split('/');
    for (const part of pathParts) {
      if (part.startsWith('@')) {
        return part.substring(1);
      }
    }
    return null;
  } catch {
    return null;
  }
}

function formatTimeLeft(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

// Safe fetch with timeout
async function safeFetch(url: string, options: RequestInit, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

// === API Functions ===

async function checkVideoId(tiktokUrl: string): Promise<{ success: boolean; videoId?: string; error?: string }> {
  console.log(`[Step 1] Checking video ID for: ${tiktokUrl}`);
  try {
    const formData = new URLSearchParams();
    formData.append("action", "checkVideoId");
    formData.append("link", tiktokUrl);

    const response = await safeFetch(BASE_URL, {
      method: "POST",
      headers: { ...HEADERS, "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
      body: formData.toString(),
    });

    const text = await response.text();
    console.log("checkVideoId raw:", text);
    
    let result;
    try { result = JSON.parse(text); } catch { 
      return { success: false, error: "Invalid API response" }; 
    }

    if (result.success || result.status === 'success') {
      const videoId = result.data?.videoId || result.videoId;
      if (videoId) return { success: true, videoId };
    }

    // Fallback: extract from URL directly
    const urlVideoId = extractVideoId(tiktokUrl);
    if (urlVideoId && /^\d+$/.test(urlVideoId)) {
      console.log("Using video ID from URL:", urlVideoId);
      return { success: true, videoId: urlVideoId };
    }

    return { success: false, error: translateMessage(result.message || result.error || "Failed to validate video") };
  } catch (error) {
    // Fallback: try extracting from URL
    const urlVideoId = extractVideoId(tiktokUrl);
    if (urlVideoId && /^\d+$/.test(urlVideoId)) {
      return { success: true, videoId: urlVideoId };
    }
    return { success: false, error: `Network error: ${String(error)}` };
  }
}

async function checkServiceAvailability(params: Record<string, string>): Promise<{ allowed: boolean; message?: string; timeLeft?: number }> {
  try {
    const searchParams = new URLSearchParams({ action: "check", ...params });
    const response = await safeFetch(`${BASE_URL}?${searchParams.toString()}`, {
      method: "GET",
      headers: HEADERS,
    });

    const text = await response.text();
    let result;
    try { result = JSON.parse(text); } catch {
      return { allowed: false, message: "Invalid API response" };
    }

    console.log("checkAvailability:", JSON.stringify(result));

    if (result.success || result.status === 'success') {
      const allowed = result.data?.allowed ?? result.available ?? false;
      return { allowed, message: translateMessage(result.message || result.data?.message || "") };
    }

    const message = result.message || result.data?.message || "Service not available";
    const timeLeft = result.data?.timeLeft;
    return { allowed: false, message: translateMessage(message), timeLeft };
  } catch (error) {
    return { allowed: false, message: `Network error: ${String(error)}` };
  }
}

async function placeOrder(params: URLSearchParams): Promise<{ success: boolean; orderId?: string; error?: string }> {
  try {
    const response = await safeFetch(`${BASE_URL}?action=order`, {
      method: "POST",
      headers: { ...HEADERS, "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
      body: params.toString(),
    });

    const text = await response.text();
    let result;
    try { result = JSON.parse(text); } catch {
      return { success: false, error: "Invalid API response" };
    }

    console.log("placeOrder:", JSON.stringify(result));

    if (result.success) {
      return { success: true, orderId: result.data?.orderId || "OK" };
    }
    return { success: false, error: translateMessage(result.message || "Failed to place order") };
  } catch (error) {
    return { success: false, error: `Network error: ${String(error)}` };
  }
}

async function checkUsernameProxy(username: string): Promise<{ success: boolean; nickname?: string; followers?: number; error?: string }> {
  console.log(`[Proxy] Checking username: ${username}`);
  try {
    const response = await safeFetch(`${PROXY_URL}?${new URLSearchParams({ username }).toString()}`, {
      method: "GET",
      headers: { ...HEADERS, accept: "*/*" },
    });

    const text = await response.text();
    let result;
    try { result = JSON.parse(text); } catch {
      return { success: false, error: "Invalid API response" };
    }

    if (result.statusCode === 0 || result.status_code === 0 || result.userInfo) {
      const userInfo = result.userInfo?.user || {};
      const stats = result.userInfo?.stats || {};
      return { success: true, nickname: userInfo.nickname || "N/A", followers: stats.followerCount || 0 };
    }
    return { success: false, error: translateMessage(result.status_msg || "Failed to validate username") };
  } catch (error) {
    return { success: false, error: `Network error: ${String(error)}` };
  }
}

// === Boost Functions ===

async function boostTikTokViews(tiktokUrl: string): Promise<{ success: boolean; message: string; orderId?: string }> {
  const deviceId = generateDeviceId();

  const videoCheck = await checkVideoId(tiktokUrl);
  if (!videoCheck.success || !videoCheck.videoId) {
    return { success: false, message: videoCheck.error || "Could not validate video" };
  }

  const avail = await checkServiceAvailability({ device: deviceId, service: String(SERVICES.TIKTOK_VIEWS), videoId: videoCheck.videoId });
  if (!avail.allowed) {
    const cd = avail.timeLeft ? ` (Wait ${formatTimeLeft(avail.timeLeft)})` : '';
    return { success: false, message: `${avail.message || 'Service unavailable'}${cd}` };
  }

  const form = new URLSearchParams();
  form.append("action", "order");
  form.append("service", String(SERVICES.TIKTOK_VIEWS));
  form.append("link", tiktokUrl);
  form.append("uuid", deviceId);
  form.append("videoId", videoCheck.videoId);

  const order = await placeOrder(form);
  if (!order.success) return { success: false, message: order.error || "Order failed" };
  return { success: true, message: "TikTok Views boost placed!", orderId: order.orderId };
}

async function boostTikTokLikes(tiktokUrl: string): Promise<{ success: boolean; message: string; orderId?: string }> {
  const deviceId = generateDeviceId();

  const videoCheck = await checkVideoId(tiktokUrl);
  if (!videoCheck.success || !videoCheck.videoId) {
    return { success: false, message: videoCheck.error || "Could not validate video" };
  }

  const avail = await checkServiceAvailability({ device: deviceId, service: String(SERVICES.TIKTOK_LIKES), videoId: videoCheck.videoId });
  if (!avail.allowed) {
    const cd = avail.timeLeft ? ` (Wait ${formatTimeLeft(avail.timeLeft)})` : '';
    return { success: false, message: `${avail.message || 'Service unavailable'}${cd}` };
  }

  const form = new URLSearchParams();
  form.append("action", "order");
  form.append("service", String(SERVICES.TIKTOK_LIKES));
  form.append("link", tiktokUrl);
  form.append("uuid", deviceId);
  form.append("videoId", videoCheck.videoId);

  const order = await placeOrder(form);
  if (!order.success) return { success: false, message: order.error || "Order failed" };
  return { success: true, message: "TikTok Likes boost placed!", orderId: order.orderId };
}

async function boostTikTokFollowers(tiktokUrl: string): Promise<{ success: boolean; message: string; orderId?: string; userInfo?: { nickname: string; followers: number } }> {
  const deviceId = generateDeviceId();

  const username = extractUsername(tiktokUrl);
  if (!username) {
    return { success: false, message: "Could not extract username. Use format: tiktok.com/@username" };
  }

  const userCheck = await checkUsernameProxy(username);
  if (!userCheck.success) {
    return { success: false, message: userCheck.error || "User not found" };
  }

  const avail = await checkServiceAvailability({ device: deviceId, service: String(SERVICES.TIKTOK_FOLLOWERS), username });
  if (!avail.allowed) {
    const cd = avail.timeLeft ? ` (Wait ${formatTimeLeft(avail.timeLeft)})` : '';
    return {
      success: false,
      message: `${avail.message || 'Service unavailable'}${cd}`,
      userInfo: { nickname: userCheck.nickname || "", followers: userCheck.followers || 0 }
    };
  }

  const form = new URLSearchParams();
  form.append("service", String(SERVICES.TIKTOK_FOLLOWERS));
  form.append("link", tiktokUrl);
  form.append("uuid", deviceId);
  form.append("username", username);

  const order = await placeOrder(form);
  if (!order.success) return { success: false, message: order.error || "Order failed" };
  return {
    success: true,
    message: "TikTok Followers boost placed!",
    orderId: order.orderId,
    userInfo: { nickname: userCheck.nickname || "", followers: userCheck.followers || 0 }
  };
}

async function boostTelegramViews(telegramUrl: string): Promise<{ success: boolean; message: string; orderId?: string }> {
  const deviceId = generateDeviceId();

  const avail = await checkServiceAvailability({ device: deviceId, service: String(SERVICES.TELEGRAM_VIEWS) });
  if (!avail.allowed) {
    const cd = avail.timeLeft ? ` (Wait ${formatTimeLeft(avail.timeLeft)})` : '';
    return { success: false, message: `${avail.message || 'Service unavailable'}${cd}` };
  }

  const form = new URLSearchParams();
  form.append("action", "order");
  form.append("service", String(SERVICES.TELEGRAM_VIEWS));
  form.append("link", telegramUrl);
  form.append("uuid", deviceId);

  const order = await placeOrder(form);
  if (!order.success) return { success: false, message: order.error || "Order failed" };
  return { success: true, message: "Telegram Views boost placed!", orderId: order.orderId };
}

async function boostFacebookShares(facebookUrl: string): Promise<{ success: boolean; message: string; orderId?: string }> {
  const deviceId = generateDeviceId();

  const avail = await checkServiceAvailability({ device: deviceId, service: String(SERVICES.FACEBOOK_SHARES), username: "share" });
  if (!avail.allowed) {
    const cd = avail.timeLeft ? ` (Wait ${formatTimeLeft(avail.timeLeft)})` : '';
    return { success: false, message: `${avail.message || 'Service unavailable'}${cd}` };
  }

  const form = new URLSearchParams();
  form.append("action", "order");
  form.append("service", String(SERVICES.FACEBOOK_SHARES));
  form.append("link", facebookUrl);
  form.append("uuid", deviceId);
  form.append("username", "share");

  const order = await placeOrder(form);
  if (!order.success) return { success: false, message: order.error || "Order failed" };
  return { success: true, message: "Facebook Shares boost placed!", orderId: order.orderId };
}

// === Main Handler ===

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action, url } = body;

    console.log(`Boost request: action=${action}, url=${url}`);

    if (!action || !url) {
      return new Response(JSON.stringify({ success: false, error: "Missing action or url" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Input validation
    const cleanUrl = String(url).trim();
    if (cleanUrl.length > 500) {
      return new Response(JSON.stringify({ success: false, error: "URL too long" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let result;

    switch (action) {
      case "tiktok_views":
        if (!cleanUrl.includes("tiktok.com")) {
          return new Response(JSON.stringify({ success: false, error: "Invalid TikTok URL" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        result = await boostTikTokViews(cleanUrl);
        break;
      case "tiktok_likes":
        if (!cleanUrl.includes("tiktok.com")) {
          return new Response(JSON.stringify({ success: false, error: "Invalid TikTok URL" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        result = await boostTikTokLikes(cleanUrl);
        break;
      case "tiktok_followers":
        if (!cleanUrl.includes("tiktok.com")) {
          return new Response(JSON.stringify({ success: false, error: "Invalid TikTok URL" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        result = await boostTikTokFollowers(cleanUrl);
        break;
      case "telegram_views":
        if (!cleanUrl.includes("t.me") && !cleanUrl.includes("telegram.me")) {
          return new Response(JSON.stringify({ success: false, error: "Invalid Telegram URL" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        result = await boostTelegramViews(cleanUrl);
        break;
      case "facebook_shares":
        if (!cleanUrl.includes("facebook.com") && !cleanUrl.includes("fb.com")) {
          return new Response(JSON.stringify({ success: false, error: "Invalid Facebook URL" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        result = await boostFacebookShares(cleanUrl);
        break;
      default:
        return new Response(JSON.stringify({ success: false, error: "Invalid action" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ success: false, error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
