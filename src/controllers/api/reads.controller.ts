import type { Request, Response } from "express";
import { categoryService } from "../../services/category.service.js";
import { productService } from "../../services/product.service.js";
import { promoService } from "../../services/promo.service.js";
import { normalizeId } from "../../utils/normalizeId.js";
import type { HomeView } from "../../dtos/home.dto.js";
import type { CategoryView } from "../../dtos/home.dto.js";

/**
 * @fileoverview Controller de lecturas del home y categorías (spec §6.6/§6.6b/§6.7/§6.9).
 *
 * Orquesta llamadas a los servicios existentes y responde JSON.
 * No contiene lógica de negocio ni queries SQL — solo delega y formatea.
 * Todas las rutas son PÚBLICAS (sin authenticate), a diferencia de
 * cart/checkout/orders que sí exigen JWT.
 */

export const readsController = {
  /**
   * Devuelve los datos del home: banners, productos sugeridos y más pedidos.
   *
   * @swagger
   * /api/home:
   *   get:
   *     summary: Datos del home
   *     description: Devuelve banners promocionales, productos sugeridos y los más pedidos.
   *     tags: [Lecturas]
   *     responses:
   *       200:
   *         description: Datos del home con tres arrays.
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/HomeView'
   *
   * @param {Request} _req - Objeto de solicitud de Express (no utilizado).
   * @param {Response} res - Respuesta Express con JSON del home.
   * @returns {Promise<void>}
   */
  async getHome(_req: Request, res: Response): Promise<void> {
    const view: HomeView = {
      banners: promoService.getActiveBanners(), // spec §6.6b
      suggested: productService.getSuggested(), // spec §6.6
      mostOrdered: productService.getMostOrdered(), // spec §6.7
    };
    res.json(view);
  },

  /**
   * Lista todas las categorías disponibles.
   *
   * @swagger
   * /api/categories:
   *   get:
   *     summary: Lista de categorías
   *     description: Devuelve todas las categorías con id, nombre y descripción.
   *     tags: [Lecturas]
   *     responses:
   *       200:
   *         description: Lista de categorías.
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 $ref: '#/components/schemas/Category'
   *
   * @param {Request} _req - Objeto de solicitud de Express (no utilizado).
   * @param {Response} res - Respuesta Express con JSON de categorías.
   * @returns {Promise<void>}
   */
  async listCategories(_req: Request, res: Response): Promise<void> {
    res.json(categoryService.findAll());
  },

  /**
   * Devuelve una categoría con sus productos asociados.
   *
   * @swagger
   * /api/categories/{categoryId}:
   *   get:
   *     summary: Detalle de categoría con productos
   *     description: Devuelve la categoría y todos sus productos por su ID.
   *     tags: [Lecturas]
   *     parameters:
   *       - in: path
   *         name: categoryId
   *         required: true
   *         schema:
   *           type: integer
   *         description: ID numérico de la categoría.
   *     responses:
   *       200:
   *         description: Categoría con sus productos.
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/CategoryView'
   *       400:
   *         description: ID inválido (no numérico).
   *       404:
   *         description: Categoría no encontrada.
   *
   * @param {Request} req - Objeto de solicitud de Express (requiere `req.params.categoryId`).
   * @param {Response} res - Respuesta Express.
   * @returns {Promise<void>}
   */
  async getCategory(req: Request, res: Response): Promise<void> {
    // §6.9: el helper puro normalizeId valida el formato (number | null);
    // la existencia en DB se resuelve recién acá, contra el repository.
    const param = req.params.categoryId ?? "";
    const raw = Array.isArray(param) ? (param[0] ?? "") : param;
    const id = normalizeId(raw);
    if (id === null) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const category = categoryService.findById(id);
    if (!category) {
      res.status(404).json({ error: "Category not found" });
      return;
    }

    const view: CategoryView = {
      category,
      products: productService.findByCategory(id),
    };
    res.json(view);
  },
};
