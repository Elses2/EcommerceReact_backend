// Test de productos API: listado con sort, detalle + related, búsqueda (spec §6.8/§6.12/§6.13, B1b).
// Runner: tsx (igual que test-auth / test-cart). La DB NUNCA es
// dev.db: se genera una ruta temporal en os.tmpdir() y se pasa por
// DB_PATH al proceso hijo (`node --import tsx src/app.ts`), que arranca
// en un puerto libre. Se verifica que las rutas de página (SSR) siguen
// funcionando para probar que el cambio es verdaderamente aditivo.
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
  `api-products-test-${process.pid}-${Date.now()}.db`,
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
      const res = await fetch(`${baseUrl}/api/ruta-inexistente`, {
        redirect: "manual",
      });
      if (res.status > 0) return;
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
): Promise<HttpResult> {
  const res = await fetch(`${baseUrl}${pathname}`, {
    method,
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
 * Inserta datos de prueba en la DB temporal para los tests.
 * Usa la misma semilla que scripts/seed.ts (3 categorías + 4 productos + joins).
 *
 * @param {BetterSqlite3.Database} db - Conexión SQLite a la DB temporal.
 */
function seedTestDB(db: BetterSqlite3.Database): void {
  db.prepare(
    "INSERT OR IGNORE INTO categories (name, description) VALUES (?, ?)",
  ).run("Periféricos", "Dispositivos de entrada y sonido");
  db.prepare(
    "INSERT OR IGNORE INTO categories (name, description) VALUES (?, ?)",
  ).run("Monitores", "Pantallas para trabajo y gaming");
  db.prepare(
    "INSERT OR IGNORE INTO categories (name, description) VALUES (?, ?)",
  ).run("Audio", "Auriculares y sonido inmersivo");

  db.prepare(
    "INSERT OR IGNORE INTO products (name, description, image_url, stock, price) VALUES (?, ?, NULL, ?, ?)",
  ).run("Teclado Mecánico", "Teclado mecánico RGB", 10, 89.99);
  db.prepare(
    "INSERT OR IGNORE INTO products (name, description, image_url, stock, price) VALUES (?, ?, NULL, ?, ?)",
  ).run("Mouse Gamer", "Mouse gamer 16000 DPI", 25, 49.5);
  db.prepare(
    "INSERT OR IGNORE INTO products (name, description, image_url, stock, price) VALUES (?, ?, NULL, ?, ?)",
  ).run('Monitor 24"', "Monitor 24 pulgadas 144Hz", 7, 199.0);
  db.prepare(
    "INSERT OR IGNORE INTO products (name, description, image_url, stock, price) VALUES (?, ?, NULL, ?, ?)",
  ).run("Headset", "Headset 7.1 con micrófono", 0, 59.9);

  const rows = db
    .prepare("SELECT id, name FROM categories")
    .all() as Array<{ id: number; name: string }>;
  const productRows = db
    .prepare("SELECT id, name FROM products")
    .all() as Array<{ id: number; name: string }>;

  const catMap = new Map(rows.map((r) => [r.name, r.id]));
  const prodMap = new Map(productRows.map((r) => [r.name, r.id]));

  const joins: [number, number][] = [
    [prodMap.get("Teclado Mecánica")!, catMap.get("Periféricos")!],
    [prodMap.get("Mouse Gamer")!, catMap.get("Periféricos")!],
    [prodMap.get('Monitor 24"')!, catMap.get("Monitores")!],
    [prodMap.get('Monitor 24"')!, catMap.get("Periféricos")!],
    [prodMap.get("Headset")!, catMap.get("Audio")!],
  ];
  for (const [productId, categoryId] of joins) {
    db.prepare(
      "INSERT OR IGNORE INTO product_categories (product_id, category_id) VALUES (?, ?)",
    ).run(productId, categoryId);
  }
}

async function runSuite(baseUrl: string): Promise<void> {
  await check("P1: GET /api/products devuelve 200 con array de productos", async () => {
    const res = await api(baseUrl, "GET", "/api/products");
    assert(res.status === 200, `status 200 (real ${res.status})`);
    const body = res.json as unknown[];
    assert(Array.isArray(body), "response es array");
    assert(body.length >= 4, "al menos 4 productos");
  });

  await check("P2: GET /api/products sort=asc ordena por precio ascendente", async () => {
    const res = await api(baseUrl, "GET", "/api/products?sort=asc");
    assert(res.status === 200, `status 200 (real ${res.status})`);
    const body = res.json as Record<string, unknown>[];
    for (let i = 1; i < body.length; i++) {
      const prev = (body[i - 1] as Record<string, unknown>).price as number;
      const curr = (body[i] as Record<string, unknown>).price as number;
      assert(prev <= curr, `precio ascendente: ${prev} <= ${curr}`);
    }
  });

  await check("P3: GET /api/products sort=desc ordena por precio descendente", async () => {
    const res = await api(baseUrl, "GET", "/api/products?sort=desc");
    assert(res.status === 200, `status 200 (real ${res.status})`);
    const body = res.json as Record<string, unknown>[];
    for (let i = 1; i < body.length; i++) {
      const prev = (body[i - 1] as Record<string, unknown>).price as number;
      const curr = (body[i] as Record<string, unknown>).price as number;
      assert(prev >= curr, `precio descendente: ${prev} >= ${curr}`);
    }
  });

  await check("P4: GET /api/products sort=invalid → 400", async () => {
    const res = await api(baseUrl, "GET", "/api/products?sort=invalid");
    assert(res.status === 400, `status 400 (real ${res.status})`);
  });

  await check("P5: GET /api/products/:id devuelve product + related para id válido", async () => {
    const res = await api(baseUrl, "GET", "/api/products/1");
    assert(res.status === 200, `status 200 (real ${res.status})`);
    const body = res.json as Record<string, unknown>;
    assert("product" in body, "tiene product");
    assert("related" in body, "tiene related");
    assert(Array.isArray(body.related), "related es array");
    assert(typeof body.product.id === "number", "product.id es number");
  });

  await check("P6: GET /api/products/:id con id inexistente → 404", async () => {
    const res = await api(baseUrl, "GET", "/api/products/99999");
    assert(res.status === 404, `status 404 (real ${res.status})`);
  });

  await check("P7: GET /api/products/:id con id no numérico → 400", async () => {
    const res = await api(baseUrl, "GET", "/api/products/abc");
    assert(res.status === 400, `status 400 (real ${res.status})`);
  });

  await check("P8: GET /api/products/:id con id negativo → 400", async () => {
    const res = await api(baseUrl, "GET", "/api/products/-1");
    assert(res.status === 400, `status 400 (real ${res.status})`);
  });

  await check("P9: GET /api/search?q= devuelve resultados que coinciden", async () => {
    const res = await api(baseUrl, "GET", "/api/search?q=Mouse");
    assert(res.status === 200, `status 200 (real ${res.status})`);
    const body = res.json as unknown[];
    assert(Array.isArray(body), "response es array");
    assert(body.length > 0, "hay resultados");
    const names = body.map((p) => (p as Record<string, unknown>).name as string);
    assert(names.some((n) => n.includes("Mouse")), "incluye Mouse");
  });

  await check("P10: GET /api/search sin q devuelve array vacío", async () => {
    const res = await api(baseUrl, "GET", "/api/search");
    assert(res.status === 200, `status 200 (real ${res.status})`);
    const body = res.json as unknown[];
    assert(Array.isArray(body), "response es array");
    assert(body.length === 0, "array vacío sin query");
  });

  await check("P11: GET / (página SSR) sigue devolviendo 200 HTML — cambio aditivo", async () => {
    const res = await api(baseUrl, "GET", "/");
    assert(res.status === 200, `status 200 (real ${res.status})`);
    assert(
      res.text.includes("<!DOCTYPE html>") || res.text.includes("<html"),
      "respuesta es HTML",
    );
  });
}

async function main(): Promise<void> {
  console.log("Test de productos API (spec §6.8/§6.12/§6.13, B1b)\n");
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
    seedTestDB(db);
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
