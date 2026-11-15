import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type TableTier = "normal" | "classic" | "vip";

const tiers: Record<TableTier, string> = {
  normal: "Normal",
  classic: "Classic",
  vip: "VIP",
};

type ReservationRequest = {
  name: string;
  email: string;
  phone: string;
  date: string;
  time: string;
  guests: number;
  tier: TableTier;
};

function isValidDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isReservationRequest(value: unknown): value is ReservationRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Record<string, unknown>;

  return typeof request.name === "string"
    && request.name.trim().length > 0
    && request.name.length <= 120
    && typeof request.email === "string"
    && request.email.length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(request.email)
    && typeof request.phone === "string"
    && request.phone.trim().length > 0
    && request.phone.length <= 40
    && typeof request.date === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(request.date)
    && isValidDate(request.date)
    && typeof request.time === "string"
    && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(request.time)
    && Number.isInteger(request.guests)
    && (request.guests as number) >= 1
    && (request.guests as number) <= 100
    && typeof request.tier === "string"
    && Object.hasOwn(tiers, request.tier);
}

async function sendCustomerEmail(
  request: ReservationRequest,
  status: "received" | "full",
  priceKes: number,
) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("RESEND_FROM_EMAIL");

  if (!apiKey || !from) {
    console.error("Email service is not configured.");
    return false;
  }

  const tierName = tiers[request.tier];
  const subject = status === "received"
    ? "Your MyRestaurant reservation was received"
    : "Your MyRestaurant table is unavailable";
  const message = status === "received"
    ? `Hello ${request.name},\n\nYour reservation has been received:\n${tierName} table - KSh ${priceKes.toLocaleString("en-KE")}\nDate: ${request.date}\nTime: ${request.time}\nGuests: ${request.guests}\n\nWe look forward to welcoming you.\nMyRestaurant`
    : `Hello ${request.name},\n\nSorry, all ${tierName} tables are booked for ${request.date} at ${request.time}. No reservation was made. Please choose another time or table type.\n\nMyRestaurant`;

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [request.email],
        subject,
        text: message,
      }),
    });

    if (!response.ok) {
      console.error("Email provider rejected the message:", response.status);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Email delivery failed:", error);
    return false;
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "Request body must be valid JSON." }, 400);
  }

  if (!isReservationRequest(payload)) {
    return jsonResponse({ error: "Please provide valid reservation details." }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  let serviceRoleKey: string | undefined;
  try {
    const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}") as Record<string, unknown>;
    if (typeof secretKeys.default === "string") {
      serviceRoleKey = secretKeys.default;
    }
  } catch (error) {
    console.error("Supabase secret key configuration is invalid:", error);
  }

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Supabase URL or server secret key is not available.");
    return jsonResponse({ error: "Reservation service is not configured." }, 503);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await supabase.rpc("create_table_reservation", {
    p_customer_name: payload.name.trim(),
    p_customer_email: payload.email.trim(),
    p_phone_number: payload.phone.trim(),
    p_reservation_date: payload.date,
    p_reservation_time: payload.time,
    p_guests: payload.guests,
    p_table_tier: payload.tier,
  });

  if (error) {
    console.error("Reservation database operation failed:", error.message);
    return jsonResponse({ error: "We couldn't check or save the reservation. Please try again." }, 500);
  }

  const result = data as {
    status?: string;
    reservationId?: string;
    tier?: TableTier;
    priceKes?: number;
  };

  if (result.status === "unconfigured") {
    return jsonResponse({ error: "Table availability has not been configured yet." }, 503);
  }

  if (result.status !== "received" && result.status !== "full") {
    console.error("Reservation database returned an unexpected status.");
    return jsonResponse({ error: "We couldn't confirm the reservation status. Please try again." }, 500);
  }

  const priceKes = result.priceKes ?? (
    payload.tier === "normal" ? 1000 : payload.tier === "classic" ? 2500 : 3500
  );
  const emailSent = await sendCustomerEmail(payload, result.status, priceKes);

  return jsonResponse({
    status: result.status,
    tier: payload.tier,
    priceKes,
    emailSent,
    ...(result.reservationId ? { reservationId: result.reservationId } : {}),
  });
});
