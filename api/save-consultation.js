// api/save-consultation.js

const { Pool } = require("pg");

let pool;

function getPool() {
  if (!pool) {
    const connectionUrl = new URL(process.env.DATABASE_URL);

    // Configure SSL explicitly rather than through URL parameters.
    for (const parameter of [
      "sslmode",
      "sslcert",
      "sslkey",
      "sslrootcert"
    ]) {
      connectionUrl.searchParams.delete(parameter);
    }

    const certificate = process.env.DATABASE_CA_CERT;

    pool = new Pool({
      connectionString: connectionUrl.toString(),
      ssl: {
        rejectUnauthorized: true,
        ...(certificate
          ? { ca: certificate.replace(/\\n/g, "\n") }
          : {})
      },
      max: 1,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 10000,
      allowExitOnIdle: true
    });
  }

  return pool;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");

    return res.status(405).json({
      error: "Only POST requests are allowed."
    });
  }

  if (!process.env.DATABASE_URL) {
    return res.status(500).json({
      error: "The database connection is not configured."
    });
  }

  let body;

  try {
    body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body;
  } catch {
    return res.status(400).json({
      error: "Invalid JSON request."
    });
  }

  const messages = body?.messages;

  if (
    !Array.isArray(messages) ||
    messages.length === 0 ||
    messages.length > 200 ||
    !messages.every(
      (message) =>
        message &&
        ["user", "assistant"].includes(message.role) &&
        typeof message.content === "string" &&
        message.content.trim().length > 0
    )
  ) {
    return res.status(400).json({
      error: "Send between 1 and 200 valid conversation messages."
    });
  }

  const consultationText = messages
    .map((message) => {
      const speaker =
        message.role === "user" ? "You" : "Bot";

      return `${speaker}:\n${message.content}`;
    })
    .join("\n\n");

  if (Buffer.byteLength(consultationText, "utf8") > 500000) {
    return res.status(413).json({
      error: "The consultation is too large to save."
    });
  }

  try {
    // Overwrite only the "stuff" column in the row whose id is 1.
    // No new row is created, and created_at remains unchanged.
    const result = await getPool().query(
      `update public.consultations
       set stuff = $1
       where id = $2
       returning id, created_at`,
      [consultationText, 1]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        error:
          "The consultation row with id = 1 does not exist. Create that row in Supabase first."
      });
    }

    return res.status(200).json({
      success: true,
      id: result.rows[0].id,
      createdAt: result.rows[0].created_at
    });
  } catch (error) {
    // Do not log credentials or consultation content.
    console.error(
      "Consultation save failed:",
      error.code || "UNKNOWN"
    );

    return res.status(500).json({
      error:
        "Could not save the consultation. Please try again."
    });
  }
};
