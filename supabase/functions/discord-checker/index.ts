import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DISCORD_API = "https://discord.com/api/v10";

async function fetchDiscordUser(userId: string, botToken: string): Promise<{
  success: boolean;
  user?: Record<string, unknown>;
  error?: string;
}> {
  try {
    const response = await fetch(`${DISCORD_API}/users/${userId}`, {
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      if (response.status === 404) return { success: false, error: "User not found" };
      if (response.status === 401) return { success: false, error: "Invalid bot token" };
      if (response.status === 429) {
        const retry = response.headers.get("Retry-After");
        return { success: false, error: `Rate limited. Try again in ${retry || "a few"} seconds` };
      }
      return { success: false, error: `Discord API error: ${response.status}` };
    }

    const user = await response.json();
    return { success: true, user };
  } catch (err) {
    return { success: false, error: `Network error: ${String(err)}` };
  }
}

async function fetchGuildMember(guildId: string, userId: string, botToken: string): Promise<{
  success: boolean;
  member?: Record<string, unknown>;
  error?: string;
}> {
  try {
    const response = await fetch(`${DISCORD_API}/guilds/${guildId}/members/${userId}`, {
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      if (response.status === 404) return { success: false, error: "User not in guild" };
      if (response.status === 403) return { success: false, error: "Bot lacks permissions for this guild" };
      return { success: false, error: `Guild API error: ${response.status}` };
    }

    const member = await response.json();
    return { success: true, member };
  } catch (err) {
    return { success: false, error: `Network error: ${String(err)}` };
  }
}

function formatUserFlags(flags: number): string[] {
  const flagMap: Record<number, string> = {
    1: "Discord Employee",
    2: "Partnered Server Owner",
    4: "HypeSquad Events",
    8: "Bug Hunter Level 1",
    64: "HypeSquad Bravery",
    128: "HypeSquad Brilliance",
    256: "HypeSquad Balance",
    512: "Early Supporter",
    16384: "Bug Hunter Level 2",
    65536: "Verified Bot",
    131072: "Early Verified Bot Developer",
    262144: "Discord Certified Moderator",
    4194304: "Active Developer",
  };

  const result: string[] = [];
  for (const [bit, name] of Object.entries(flagMap)) {
    if (flags & Number(bit)) result.push(name);
  }
  return result;
}

function snowflakeToDate(snowflake: string): string {
  const epoch = 1420070400000n;
  const id = BigInt(snowflake);
  const timestamp = Number((id >> 22n) + epoch);
  return new Date(timestamp).toISOString();
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const botToken = Deno.env.get("DISCORD_BOT_TOKEN");
    if (!botToken) {
      return new Response(JSON.stringify({ success: false, error: "Bot token not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { user_id, guild_id } = body;

    if (!user_id || typeof user_id !== "string") {
      return new Response(JSON.stringify({ success: false, error: "Missing or invalid user_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate user_id is numeric (snowflake)
    if (!/^\d{17,20}$/.test(user_id.trim())) {
      return new Response(JSON.stringify({ success: false, error: "Invalid user ID format. Must be a Discord snowflake (17-20 digits)" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cleanUserId = user_id.trim();
    const cleanGuildId = guild_id?.trim();

    // Fetch user info
    const userResult = await fetchDiscordUser(cleanUserId, botToken);
    if (!userResult.success || !userResult.user) {
      return new Response(JSON.stringify({ success: false, error: userResult.error }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const user = userResult.user as Record<string, unknown>;
    const createdAt = snowflakeToDate(cleanUserId);
    const flags = formatUserFlags(Number(user.public_flags || 0));
    const avatarUrl = user.avatar
      ? `https://cdn.discordapp.com/avatars/${cleanUserId}/${user.avatar}.${String(user.avatar).startsWith("a_") ? "gif" : "png"}?size=512`
      : `https://cdn.discordapp.com/embed/avatars/${Number(user.discriminator || 0) % 5}.png`;
    const bannerUrl = user.banner
      ? `https://cdn.discordapp.com/banners/${cleanUserId}/${user.banner}.${String(user.banner).startsWith("a_") ? "gif" : "png"}?size=600`
      : null;
    const avatarDecorationUrl = user.avatar_decoration_data 
      ? `https://cdn.discordapp.com/avatar-decoration-presets/${(user.avatar_decoration_data as Record<string,string>).asset}.png`
      : null;

    const result: Record<string, unknown> = {
      success: true,
      user: {
        id: user.id,
        username: user.username,
        discriminator: user.discriminator,
        global_name: user.global_name || null,
        avatar: user.avatar || null,
        avatar_url: avatarUrl,
        avatar_decoration: avatarDecorationUrl,
        banner: user.banner || null,
        banner_url: bannerUrl,
        accent_color: user.accent_color ? `#${Number(user.accent_color).toString(16).padStart(6, '0')}` : null,
        banner_color: user.banner_color || null,
        is_bot: user.bot || false,
        is_system: user.system || false,
        created_at: createdAt,
        flags,
        public_flags_raw: user.public_flags || 0,
        premium_type: user.premium_type || 0,
        has_animated_avatar: user.avatar ? String(user.avatar).startsWith("a_") : false,
        has_animated_banner: user.banner ? String(user.banner).startsWith("a_") : false,
      },
    };

    // Fetch guild member info if guild_id provided
    if (cleanGuildId && /^\d{17,20}$/.test(cleanGuildId)) {
      const memberResult = await fetchGuildMember(cleanGuildId, cleanUserId, botToken);
      if (memberResult.success && memberResult.member) {
        const member = memberResult.member as Record<string, unknown>;
        const roles = member.roles as string[] || [];
        result.member = {
          nick: member.nick || null,
          joined_at: member.joined_at || null,
          roles_count: roles.length,
          premium_since: member.premium_since || null,
          is_muted: member.mute || false,
          is_deafened: member.deaf || false,
          pending: member.pending || false,
          communication_disabled_until: member.communication_disabled_until || null,
        };
      } else {
        result.member_error = memberResult.error;
      }
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
