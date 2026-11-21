import type { Request, Response } from "express";
import { productService } from "../../services/product.service.js";
import type { ProductDetailView } from "../../dtos/product.dto.js";

/**
 * @fileoverview Controller de lecturas de productos (spec §6.8/§6.12/§6.13).
 *
 * Orquesta llamadas a los servicios existentes y responde JSON.
 * No contiene lógica de negocio ni queries SQL — solo delega y formatea.
 * Todas las rutas son PÚBLICAS (sin authenticate), a diferencia de
 * cart/checkout/orders que sí exigen JWT.
 */

export const productsController = {
  /**
   * Lista todos los productos con orden opcional por precio.
   *
   * @swagger
   * /api/products:
   *   get:
   *     summary: Lista de productos
   *     description: Devuelve todos los productos con atributos derivados.
   *       Ordena por precio si se pasa el query `sort`.
   *     tags: [Productos]
   *     parameters:
   *       - in: query
   *         name: sort
   *         required: false
   *         schema:
   *           type: string
   *           enum: [asc, desc]
   *         description: Ordenar por precio (asc o desc).
   *     responses:
   *       200:
   *         description: Lista de productos.
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 $ref: '#/components/schemas/Product'
   *       400:
   *         description: Valor de sort inválido (no es asc ni desc).
   *
   * @param {Request} req - Objeto de solicitud de Express (evalúa `req.query.sort`).
   * @param {Response} res - Respuesta Express con JSON de productos.
   * @returns {Promise<void>}
   */
  async getProducts(req: Request, res: Response): Promise<void> {
    const sort = req.query.sort;
    if (sort !== undefined && sort !== "asc" && sort !== "desc") {
      res.status(400).json({ error: "Invalid sort" });
      return;
    }

    const products = productService.findAllWithSort(
      sort as "asc" | "desc" | undefined,
    );
    res.json(products);
  },

  /**
   * Detalle de producto con productos relacionados (spec §6.8).
   *
   * @swagger
   * /api/products/{productId}:
   *   get:
   *     summary: Detalle de producto con relacionados
   *     description: Devuelve el producto y hasta 4 productos relacionados que comparten categorías.
   *     tags: [Productos]
   *     parameters:
   *       - in: path
   *         name: productId
   *         required: true
   *         schema:
   *           type: integer
   *         description: ID numérico del producto.
   *     responses:
   *       200:
   *         description: Producto con lista de relacionados.
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ProductDetailView'
   *       400:
   *         description: ID inválido (no numérico).
   *       404:
   *         description: Producto no encontrado.
   *
   * @param {Request} req - Objeto de solicitud de Express (requiere `req.params.productId`).
   * @param {Response} res - Respuesta Express.
   * @returns {Promise<void>}
   */
  async getProductDetail(req: Request, res: Response): Promise<void> {
    const raw = req.params.productId ?? "";
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const product = productService.findById(id);
    if (!product) {
      res.status(404).json({ error: "Product not found" });
      return;
    }

    const related = productService.getRelated(id, product.categories);
    const view: ProductDetailView = { product, related };
    res.json(view);
  },
};
