import type { Request, Response } from "express";
import type {
  CheckoutRequestDto,
  PaymentMethod,
} from "../../dtos/checkout.dto.js";
import { checkoutService } from "../../services/checkout.service.js";
import { cartService } from "../../services/cart.service.js";

// Formato del token de idempotencia (spec §19): 32 hex [a-f0-9].
const CHECKOUT_TOKEN_PATTERN = /^[a-f0-9]{32}$/;

/**
 * @fileoverview Controller de la API del checkout (spec §19/§24): `GET` devuelve
 * el token de idempotencia + el resumen del carrito (Redis) y `POST` crea la
 * orden. Las líneas SIEMPRE salen del carrito del usuario; el body jamás
 * aporta productos. Redis se lee **fuera** de la transacción SQLite (D1).
 */

/**
 * Lee un campo del body como string (defensa en profundidad, §19.5).
 *
 * @param {unknown} body - Body parseado por Express.
 * @param {string} field - Nombre del campo.
 * @returns {string} El valor del campo, o `""` si no es string.
 */
function bodyString(body: unknown, field: string): string {
  if (typeof body !== "object" || body === null) return "";
  const value = (body as Record<string, unknown>)[field];
  return typeof value === "string" ? value : "";
}

/**
 * GET /api/checkout/confirmation/:token — JSON público (spec §19/D7).
 *
 * El token identifica la orden (nunca se expone `orders.id`).
 * Cualquier token inválido (malformado o inexistente) devuelve 404
 * de forma uniforme para evitar enumeración de tokens.
 * La respuesta mínima incluye solo los campos que el frontend
 * de confirmación necesita: id, total, status y los items con
 * nombre + cantidad + precio unitario.
 *
 * @swagger
 * /api/checkout/confirmation/{token}:
 *   get:
 *     summary: Confirmación de orden (JSON)
 *     description: Devuelve la orden y sus items por su token de checkout. Público.
 *     tags: [Checkout]
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *         description: Token de checkout de la orden (32 hex).
 *     responses:
 *       200:
 *         description: Orden encontrada con sus items.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ConfirmationView'
 *       404:
 *         description: Token malformado u orden inexistente.
 *
 * @param {Request} req - Petición Express (requiere `req.params.token`).
 * @param {Response} res - Respuesta Express.
 * @returns {Promise<void>}
 */
export const checkoutController = {
  async getConfirmation(req: Request, res: Response): Promise<void> {
    const raw = req.params.token;
    const token = Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? "");
    if (!CHECKOUT_TOKEN_PATTERN.test(token)) {
      res.status(404).json({ error: "No encontrada" });
      return;
    }

    const data = checkoutService.getOrderForConfirmation(token);
    if (!data) {
      res.status(404).json({ error: "No encontrada" });
      return;
    }

    res.json({
      order: {
        id: data.order.id,
        total: data.order.total,
        status: data.order.status,
        created_at: data.order.created_at,
      },
      items: data.items.map((item) => ({
        product_name: item.product_name,
        quantity: item.quantity,
        unit_price: item.unit_price,
      })),
    });
  },

  /**
   * Devuelve el token de idempotencia y el carrito actual (spec §19.2/§24).
   *
   * @swagger
   * /api/checkout:
   *   get:
   *     summary: Datos del checkout
   *     description: Devuelve el token de idempotencia y el resumen del carrito del usuario.
   *     tags: [Checkout]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Token de checkout + carrito.
   *       401:
   *         description: Token requerido o inválido.
   *
   * @param {Request} req - Petición Express (requiere `req.user`).
   * @param {Response} res - Respuesta Express.
   * @returns {Promise<void>}
   */
  async showCheckout(req: Request, res: Response): Promise<void> {
    const userId = req.user?.id;
    if (userId === undefined) {
      res.status(401).json({ error: "No autenticado" });
      return;
    }
    const cart = await cartService.getCartWithDetails(userId);
    res.json({ checkoutToken: checkoutService.generateCheckoutToken(), cart });
  },

  /**
   * Procesa el checkout y crea la orden (spec §19/§24).
   *
   * @swagger
   * /api/checkout:
   *   post:
   *     summary: Procesar checkout
   *     description: Crea la orden atómicamente a partir del carrito del usuario. Idempotente por checkout_token (D6).
   *     tags: [Checkout]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               firstName: { type: string }
   *               lastName: { type: string }
   *               email: { type: string }
   *               phone: { type: string }
   *               address: { type: string }
   *               city: { type: string }
   *               postalCode: { type: string }
   *               country: { type: string }
   *               paymentMethod: { type: string, enum: [transfer, cash_on_delivery, card] }
   *               checkoutToken: { type: string }
   *     responses:
   *       201:
   *         description: Orden creada; devuelve el token de confirmación.
   *       400:
   *         description: Errores de validación o stock.
   *       401:
   *         description: Token requerido o inválido.
   *
   * @param {Request} req - Petición Express.
   * @param {Response} res - Respuesta Express.
   * @returns {Promise<void>}
   */
  async submitCheckout(req: Request, res: Response): Promise<void> {
    const userId = req.user?.id;
    if (userId === undefined) {
      res.status(401).json({ error: "No autenticado" });
      return;
    }
    const body = req.body;
    const dto: CheckoutRequestDto = {
      firstName: bodyString(body, "firstName"),
      lastName: bodyString(body, "lastName"),
      email: bodyString(body, "email"),
      phone: bodyString(body, "phone"),
      address: bodyString(body, "address"),
      city: bodyString(body, "city"),
      postalCode: bodyString(body, "postalCode"),
      country: bodyString(body, "country"),
      paymentMethod: bodyString(body, "paymentMethod") as PaymentMethod,
      checkoutToken: bodyString(body, "checkoutToken"),
    };

    // Redis FUERA de la transacción SQLite (spec §24/D1-D4).
    const lines = await cartService.getLines(userId);
    const result = checkoutService.createOrder(lines, dto, userId);
    if (result.ok) {
      await cartService.clear(userId); // el carrito se vacía SOLO si la orden se creó
      res.status(201).json({ confirmationToken: result.orderToken });
      return;
    }
    res.status(400).json({ errors: result.errors });
  },
};
