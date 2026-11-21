// Test de operaciones de backend B2 (spec §27): confirmación JSON,
// health check y verificación csrfOrigin con trust proxy.
// Runner: tsx (igual que test-api-products.ts). La DB NUNCA es
// dev.db: se genera una ruta temporal en os.tmpdir() y se pasa por
// DB_PATH al proceso hijo (`node --import tsx src/app.ts`), que arranca
// en un puerto libre.
// Salida: exit code 0 si todo pasa, 1 si algo falla.
import { spawn } from "node:child_process";
import BetterSqlite3 from "better-sqlite3";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");
const TEST_DB_PATH = path.join(
  os.tmpdir(),
  `api-ops-test-${process.pid}-${Date.now()}.db`,
);

const DEFAULT_DB = path.resolve(ROOT, "dev.db");
if (path.resolve(TEST_DB_PATH) === DEFAULT_DB) {
  console.error(
    "ERROR: DB_PATH resuelve a dev.db — el test exige una DB temporal.",
  );
  process.exit(1);
}

let failures = 0;
let passes = 0;

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(`ASSERTION FALLIDA: ${message}`);
}

async function check(
  name: string,
  run: () => Promise<void> | void,
): Promise<void> {
  try {
    await run();
    passes += 1;
    console.log(`  ✅ ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`  ❌ ${name}`);
    console.log(
      `     ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("no se pudo resolver el puerto libre"));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

async function waitForServer(
  baseUrl: string,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/health`, {
        redirect: "manual",
      });
      if (res.status === 200) return;
    } catch {
      /* todavía no levantó */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`el servidor no respondió en ${timeoutMs}ms`);
}

interface HttpResult {
  status: number;
  text: string;
  json: Record<string, unknown>;
}

async function api(
  baseUrl: string,
  method: string,
  pathname: string,
  options?: { headers?: Record<string, string>; body?: string },
): Promise<HttpResult> {
  const res = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: options?.headers,
    body: options?.body,
    redirect: "manual",
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* respuesta no JSON */
  }
  return { status: res.status, text, json };
}

/**
 * Inserta datos de prueba en la DB temporal para los tests de
 * confirmación: 1 usuario, 1 producto, 1 orden con token válido,
 * 1 item de orden.
 *
 * @param {BetterSqlite3.Database} db - Conexión SQLite a la DB temporal.
 * @returns {string} El token de checkout de la orden sembrada.
 */
function seedConfirmationDB(db: BetterSqlite3.Database): string {
  // Usuario
  db.prepare(
    "INSERT OR IGNORE INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)",
  ).run("Confirm Test", "confirm@test.com", "hash", "customer");

  const userRow = db
    .prepare("SELECT id FROM users WHERE email = ?")
    .get("confirm@test.com") as { id: number };
  const userId = userRow.id;

  // Producto
  db.prepare(
    "INSERT OR IGNORE INTO products (name, description, image_url, stock, price) VALUES (?, ?, NULL, ?, ?)",
  ).run("Producto Confirm", "Para confirmación", 5, 29.99);

  const productRow = db
    .prepare("SELECT id FROM products WHERE name = ?")
    .get("Producto Confirm") as { id: number };
  const productId = productRow.id;

  // Orden con token válido (32 hex)
  const token = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
  db.prepare(
    "INSERT INTO orders (user_id, status, total, checkout_token, shipping_name, shipping_email, shipping_phone, shipping_address, shipping_city, shipping_postal_code, shipping_country, payment_method) VALUES (?, 'pending', ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL)",
  ).run(userId, 29.99, token, "Confirm Test", "confirm@test.com");

  const orderRow = db
    .prepare("SELECT id FROM orders WHERE checkout_token = ?")
    .get(token) as { id: number };
  const orderId = orderRow.id;

  // Item de orden
  db.prepare(
    "INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)",
  ).run(orderId, productId, 1, 29.99);

  return token;
}

async function runSuite(baseUrl: string): Promise<void> {
  // --- Confirmation endpoint ---
  const validToken = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
  const malformedToken = "not-valid-token!";
  const unknownToken = "f0000000000000000000000000000000";

  await check(
    "C1: GET /api/checkout/confirmation/:token con token válido → 200 con order + items",
    async () => {
      const res = await api(baseUrl, "GET", `/api/checkout/confirmation/${validToken}`);
      assert(res.status === 200, `status 200 (real ${res.status})`);
      const body = res.json as Record<string, unknown>;
      assert("order" in body, "tiene order");
      assert("items" in body, "tiene items");
      assert(Array.isArray(body.items), "items es array");
      const order = body.order as Record<string, unknown>;
      assert(typeof order.id === "number", "order.id es number");
      assert(typeof order.total === "number", "order.total es number");
      assert(typeof order.status === "string", "order.status es string");
      const item = body.items[0] as Record<string, unknown>;
      assert(typeof item.product_name === "string", "item.product_name es string");
      assert(typeof item.quantity === "number", "item.quantity es number");
      assert(typeof item.unit_price === "number", "item.unit_price es number");
      // Respuesta mínima: no expone user_id, checkout_token, ni datos de envío
      assert(!("user_id" in order), "no expone user_id");
      assert(!("checkout_token" in order), "no expone checkout_token");
      assert(!("shipping_name" in order), "no expone shipping_name");
    },
  );

  await check(
    "C2: GET /api/checkout/confirmation/:token con token malformado → 404 (uniforme)",
    async () => {
      const res = await api(baseUrl, "GET", `/api/checkout/confirmation/${malformedToken}`);
      assert(res.status === 404, `status 404 (real ${res.status})`);
    },
  );

  await check(
    "C3: GET /api/checkout/confirmation/:token con token desconocido → 404 (uniforme)",
    async () => {
      const res = await api(baseUrl, "GET", `/api/checkout/confirmation/${unknownToken}`);
      assert(res.status === 404, `status 404 (real ${res.status})`);
    },
  );

  // --- Health endpoint ---
  await check(
    "H1: GET /api/health → 200 {status:'ok'}",
    async () => {
      const res = await api(baseUrl, "GET", "/api/health");
      assert(res.status === 200, `status 200 (real ${res.status})`);
      const body = res.json as Record<string, unknown>;
      assert(body.status === "ok", "status es 'ok'");
      // Respuesta mínima: solo status, sin dependencias
      const keys = Object.keys(body);
      assert(keys.length === 1, "solo tiene la key status");
    },
  );

  // --- csrfOrigin proxy behavior ---
  await check(
    "CS1: POST /api/checkout con Origin matching proxy host + X-Forwarded-Proto → NOT 403 (pasa csrfOrigin)",
    async () => {
      // Con trust proxy=1, req.get("host") usa X-Forwarded-Host.
      // Enviar X-Forwarded-Host y Origin con el mismo host → csrfOrigin
      // deja pasar (mismo host). El endpoint exige JWT, así que
      // esperamos 401 (no autenticado), NO 403 (no bloqueado por csrf).
      const port = baseUrl.split(":")[2]?.replace("/", "") ?? "3000";
      const host = `localhost:${port}`;
      const res = await api(baseUrl, "POST", "/api/checkout", {
        headers: {
          "Content-Type": "application/json",
          Origin: `http://${host}`,
          "X-Forwarded-Host": host,
          "X-Forwarded-Proto": "https",
        },
        body: JSON.stringify({
          firstName: "Test",
          lastName: "User",
          email: "test@test.com",
          phone: "12345678",
          address: "Addr",
          city: "City",
          postalCode: "12345",
          country: "AR",
          paymentMethod: "transfer",
          checkoutToken: validToken,
        }),
      });
      // No 403 (csrfOrigin no bloquea porque Origin coincide con X-Forwarded-Host)
      assert(res.status !== 403, `no debe ser 403 (real ${res.status})`);
      // Esperamos 401 porque no hay JWT válido
      assert(res.status === 401, `status 401 (real ${res.status})`);
    },
  );

  await check(
    "CS2: POST /api/checkout con Origin extranjero → 403 (csrfOrigin bloquea)",
    async () => {
      const res = await api(baseUrl, "POST", "/api/checkout", {
        headers: {
          "Content-Type": "application/json",
          Origin: "https://evil.example",
        },
        body: JSON.stringify({
          firstName: "Test",
          lastName: "User",
          email: "test@test.com",
          phone: "12345678",
          address: "Addr",
          city: "City",
          postalCode: "12345",
          country: "AR",
          paymentMethod: "transfer",
          checkoutToken: validToken,
        }),
      });
      assert(res.status === 403, `status 403 (real ${res.status})`);
      const body = res.json as Record<string, unknown>;
      assert(
        JSON.stringify(body) === JSON.stringify({ error: "Origen no permitido" }),
        "mensaje de origen",
      );
    },
  );

  await check(
    "CS3: GET / (página SSR) sigue devolviendo 200 HTML — cambio aditivo",
    async () => {
      const res = await api(baseUrl, "GET", "/");
      assert(res.status === 200, `status 200 (real ${res.status})`);
      assert(
        res.text.includes("<!DOCTYPE html>") || res.text.includes("<html"),
        "respuesta es HTML",
      );
    },
  );
}

async function main(): Promise<void> {
  console.log("Test de operaciones de backend B2 (spec §27)\n");
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`→ Levantando app (puerto ${port}, DB ${TEST_DB_PATH})…`);

  const server = spawn(
    process.execPath,
    ["--import", "tsx", path.join(ROOT, "src", "app.ts")],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        DB_PATH: TEST_DB_PATH,
        PORT: String(port),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  server.stdout.on("data", () => {});
  server.stderr.on("data", () => {});

  try {
    await waitForServer(baseUrl);

    // Seedear la DB temporal antes de correr los tests
    const db = new BetterSqlite3(TEST_DB_PATH);
    seedConfirmationDB(db);
    db.close();

    await runSuite(baseUrl);
  } finally {
    server.kill("SIGKILL");
    await new Promise((r) => setTimeout(r, 300));
    for (const suffix of ["", "-wal", "-shm"]) {
      fs.rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
    }
  }

  console.log(`\nResultado: ${passes} OK, ${failures} fallidos`);
  if (failures > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
